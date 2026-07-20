from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any, Literal, TypedDict

import pydantic_ai.models
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from pydantic import TypeAdapter, ValidationError
from pydantic_ai import DeferredToolRequests, DeferredToolResults
from pydantic_ai.messages import ModelMessagesTypeAdapter

from .agents import AgentBundle, AgentDeps, baseline_brief
from .models import (
    AgentInvocationRecord,
    ContractRef,
    CreateRunRequest,
    EnrichmentResultV1,
    FaultInjection,
    HandoffEnvelope,
    ModelClaim,
    PendingApproval,
    PydanticEvidence,
    RunEvent,
    RunMetrics,
    RunRecord,
    ThreatAssessmentV1,
    ThreatBriefV1,
    ThreatIndicatorsV1,
    stable_hash,
    utc_now,
)
from .provenance import assess_claim, citation_integrity, citation_support, make_envelope
from .scenarios.registry import SCENARIO_REGISTRY
from .scenarios.runner import RegisteredScenarioRunner
from .store import RuntimeStore
from .workflows import register_scenario_contracts, threat_workflow_spec, validate_workflow

RUNTIME_BUILD_HASH = stable_hash({"runtime": "reagent", "version": "0.1.0"})


class GraphState(TypedDict, total=False):
    input: dict[str, Any]
    enrichment: dict[str, Any]
    enrichment_envelope: dict[str, Any]
    assessment: dict[str, Any]
    assessment_envelope: dict[str, Any]
    brief: dict[str, Any]
    publisher_messages: list[dict[str, Any]]
    pending_call: dict[str, Any]
    approval_id: str
    decision: bool
    edge_fault_applied: bool
    terminal_note: str


class RuntimeEngine:
    def __init__(self, data_dir: str | Path | None = None) -> None:
        root = Path(data_dir or os.getenv("REAGENT_DATA_DIR", Path(__file__).parents[1] / ".data"))
        root.mkdir(parents=True, exist_ok=True)
        self.store = RuntimeStore(root / "runs.sqlite3")
        self._checkpoint_connection = sqlite3.connect(
            root / "checkpoints.sqlite3", check_same_thread=False
        )
        self._checkpointer = SqliteSaver(self._checkpoint_connection)
        self._checkpointer.setup()
        self._graphs: dict[str, Any] = {}
        self._bundles: dict[str, AgentBundle] = {}
        self._records: dict[str, RunRecord] = {}
        register_scenario_contracts(SCENARIO_REGISTRY)
        self.scenario_runner = RegisteredScenarioRunner(
            self.store,
            SCENARIO_REGISTRY,
            RUNTIME_BUILD_HASH,
        )

    def create_run(
        self,
        request: CreateRunRequest,
        *,
        operation: Literal[
            "execute", "fixture_replay", "checkpoint_fork", "candidate_rerun"
        ] = "execute",
        compared_to_run_id: str | None = None,
    ) -> RunRecord:
        if request.scenario_id != "threat-analyst":
            return self.scenario_runner.create_run(
                request,
                operation=operation,
                compared_to_run_id=compared_to_run_id,
            )
        if request.run_mode == "live":
            model_name = os.getenv("REAGENT_LIVE_MODEL")
            if not model_name:
                raise ValueError(
                    "Live mode is optional and requires REAGENT_LIVE_MODEL. "
                    "Fixture mode is fully local."
                )
            raise ValueError(
                "Live provider execution is deliberately disabled until a provider-specific "
                "fixture policy "
                f"is configured for {model_name}."
            )

        pydantic_ai.models.ALLOW_MODEL_REQUESTS = False
        fault_plan = request.fault_plan or [
            FaultInjection(case="false_claim", hook="model_response")
        ]
        run_id = str(uuid.uuid4())
        trace_id = str(uuid.uuid4())
        spec = threat_workflow_spec(request.variant)
        validation = validate_workflow(spec)
        if not validation.valid or not validation.workflow_hash:
            raise ValueError(f"Registered workflow failed validation: {validation.errors}")
        config_hash = stable_hash(
            {
                "workflow": validation.workflow_hash,
                "variant": request.variant,
                "contracts": [
                    "ThreatIndicatorsV1@1",
                    "EnrichmentResultV1@1",
                    "ThreatAssessmentV1@1",
                    "ThreatBriefV1@1",
                ],
                "models": "function-model-fixtures-v1",
                "faults": [fault.model_dump(mode="json") for fault in fault_plan],
                "runtime": RUNTIME_BUILD_HASH,
            }
        )
        validated_input = ThreatIndicatorsV1.model_validate(
            request.input
            or {
                "indicators": ["198.51.100.42"],
                "source_ids": ["src-telemetry", "src-advisory"],
                "required_constraint_ids": ["constraint-human-approval"],
            }
        )
        record = RunRecord(
            run_id=run_id,
            trace_id=trace_id,
            scenario_id=request.scenario_id,
            variant=request.variant,
            run_mode=request.run_mode,
            terminal_status="running",
            runtime_build_hash=RUNTIME_BUILD_HASH,
            workflow_hash=validation.workflow_hash,
            config_hash=config_hash,
            input=validated_input.model_dump(mode="json"),
            fault_plan=fault_plan,
            fixture_preset=request.fixture_preset,
            operation=operation,
            compared_to_run_id=compared_to_run_id,
        )
        self._records[run_id] = record
        self.store.save_run(record)
        graph = self._build_graph(record)
        config = {"configurable": {"thread_id": run_id}}
        started = time.perf_counter()
        try:
            result = graph.invoke({"input": record.input}, config=config)
            elapsed = (time.perf_counter() - started) * 1000
            if result.get("__interrupt__"):
                record.terminal_status = "paused"
                self._sync_checkpoint(record, graph, config)
                self._update_duration(record, elapsed)
            else:
                self._finalize(record, result, elapsed)
        except Exception as exc:
            record.terminal_status = "failed"
            record.failure_reason = f"{type(exc).__name__}: {exc}"
            record.ended_at = utc_now()
            self._event(record, None, "run_finished", metadata={"status": "failed"})
        self.store.save_run(record)
        return record

    def resume_run(
        self,
        run_id: str,
        *,
        approval_id: str,
        decision: Literal["approved", "denied"],
        idempotency_key: str,
    ) -> RunRecord:
        record = self._records.get(run_id) or self.store.get_run(run_id)
        if not record:
            raise KeyError(run_id)
        if record.terminal_status != "paused":
            raise ValueError("Only a paused run can be resumed.")
        pending = next(
            (item for item in record.pending_approvals if item.approval_id == approval_id), None
        )
        if not pending:
            raise ValueError("Pending approval is not part of this run.")
        resolved = self.store.resolve_approval(
            approval_id=approval_id,
            run_id=run_id,
            config_hash=record.config_hash,
            args=pending.arguments,
            decision=decision,
            idempotency_key=idempotency_key,
        )
        for index, item in enumerate(record.pending_approvals):
            if item.approval_id == approval_id:
                record.pending_approvals[index] = resolved
        graph = self._graphs.get(run_id) or self._build_graph(record)
        self._records[run_id] = record
        config = {"configurable": {"thread_id": run_id}}
        started = time.perf_counter()
        try:
            result = graph.invoke(Command(resume=decision == "approved"), config=config)
            elapsed = (time.perf_counter() - started) * 1000
            self._finalize(record, result, elapsed, resumed=True)
        except Exception as exc:
            record.terminal_status = "failed"
            record.failure_reason = f"{type(exc).__name__}: {exc}"
            record.ended_at = utc_now()
            self._event(record, None, "run_finished", metadata={"status": "failed"})
        self.store.save_run(record)
        return record

    def fixture_replay(self, run_id: str) -> RunRecord:
        original = self.store.get_run(run_id)
        if not original:
            raise KeyError(run_id)
        request = CreateRunRequest(
            scenario_id=original.scenario_id,
            variant=original.variant,
            run_mode="fixture",
            input=original.input,
            fault_plan=original.fault_plan,
            fixture_preset=original.fixture_preset,
        )
        replay = self.create_run(
            request, operation="fixture_replay", compared_to_run_id=original.run_id
        )
        if original.terminal_status == "succeeded" and replay.terminal_status == "paused":
            original_approval = (
                original.pending_approvals[0] if original.pending_approvals else None
            )
            decision: Literal["approved", "denied"] = (
                "denied"
                if original_approval and original_approval.status == "denied"
                else "approved"
            )
            replay_approval = replay.pending_approvals[0]
            replay = self.resume_run(
                replay.run_id,
                approval_id=replay_approval.approval_id,
                decision=decision,
                idempotency_key=f"fixture-replay-{uuid.uuid4()}",
            )
        replay.external_requests = 0
        replay.replay_comparison = {
            "semantic_trace_match": replay.semantic_trace_hash == original.semantic_trace_hash,
            "original_semantic_trace_hash": original.semantic_trace_hash,
            "replay_semantic_trace_hash": replay.semantic_trace_hash,
            "external_requests": replay.external_requests,
            "volatile_fields_excluded": [
                "run_id",
                "trace_id",
                "event_id",
                "timestamps",
                "durations",
            ],
        }
        self.store.save_run(replay)
        return replay

    def checkpoint_fork(
        self,
        run_id: str,
        input_override: dict[str, Any],
        checkpoint_id: str | None = None,
    ) -> RunRecord:
        original = self._records.get(run_id) or self.store.get_run(run_id)
        if not original:
            raise KeyError(run_id)
        if original.scenario_id != "threat-analyst":
            raise ValueError(
                "Checkpoint forks are currently available only for the approval-enabled "
                "Threat Analyst graph. Use candidate rerun for this scenario."
            )
        source_graph = self._graphs.get(run_id) or self._build_graph(original)
        history = list(source_graph.get_state_history({"configurable": {"thread_id": run_id}}))
        safe_predecessors = {
            "enricher": "input",
            "edge_validator": "enricher",
            "analyst": "edge_validator",
            "factuality": "analyst",
            "reviewer": "factuality",
            "publisher": "reviewer",
        }
        if checkpoint_id:
            snapshot = next(
                (
                    item
                    for item in history
                    if item.config.get("configurable", {}).get("checkpoint_id") == checkpoint_id
                ),
                None,
            )
            if snapshot is None:
                raise ValueError("The checkpoint does not belong to this run.")
        else:
            snapshot = next(
                (
                    item
                    for item in history
                    if len(item.next) == 1 and item.next[0] in safe_predecessors
                ),
                None,
            )
        if snapshot is None or len(snapshot.next) != 1:
            raise ValueError("No single-path checkpoint is available to fork.")
        next_node = snapshot.next[0]
        if next_node not in safe_predecessors:
            raise ValueError(
                "This checkpoint is approval-bound or terminal; fork from an earlier checkpoint."
            )

        fork_id = str(uuid.uuid4())
        fork_trace_id = str(uuid.uuid4())
        fork_record = RunRecord(
            run_id=fork_id,
            trace_id=fork_trace_id,
            scenario_id=original.scenario_id,
            variant=original.variant,
            run_mode=original.run_mode,
            terminal_status="running",
            runtime_build_hash=original.runtime_build_hash,
            fixture_set_version=original.fixture_set_version,
            workflow_hash=original.workflow_hash,
            config_hash=original.config_hash,
            input={**original.input, **input_override},
            fault_plan=original.fault_plan,
            operation="checkpoint_fork",
            compared_to_run_id=original.run_id,
            fixture_preset=original.fixture_preset,
        )
        fork_state = self._replace_identity(
            dict(snapshot.values),
            old_run_id=original.run_id,
            new_run_id=fork_id,
            old_trace_id=original.trace_id,
            new_trace_id=fork_trace_id,
        )
        fork_state["input"] = fork_record.input
        self._records[fork_id] = fork_record
        self.store.save_run(fork_record)
        fork_graph = self._build_graph(fork_record)
        fork_config = {"configurable": {"thread_id": fork_id}}
        fork_graph.update_state(
            fork_config,
            fork_state,
            as_node=safe_predecessors[next_node],
        )
        started = time.perf_counter()
        try:
            result = fork_graph.invoke(None, config=fork_config)
            elapsed = (time.perf_counter() - started) * 1000
            if result.get("__interrupt__"):
                fork_record.terminal_status = "paused"
                self._sync_checkpoint(fork_record, fork_graph, fork_config)
                self._update_duration(fork_record, elapsed)
            else:
                self._finalize(fork_record, result, elapsed)
        except Exception as exc:
            fork_record.terminal_status = "failed"
            fork_record.failure_reason = f"{type(exc).__name__}: {exc}"
            fork_record.ended_at = utc_now()
            self._event(
                fork_record,
                None,
                "run_finished",
                metadata={"status": "failed"},
            )
        self.store.save_run(fork_record)
        return fork_record

    def candidate_rerun(
        self,
        run_id: str,
        *,
        variant: Literal["baseline", "hardened"] | None,
        input_override: dict[str, Any],
        fault_plan: list[FaultInjection] | None,
    ) -> RunRecord:
        original = self.store.get_run(run_id)
        if not original:
            raise KeyError(run_id)
        request = CreateRunRequest(
            scenario_id=original.scenario_id,
            variant=variant or original.variant,
            run_mode=original.run_mode,
            input={**original.input, **input_override},
            fault_plan=fault_plan if fault_plan is not None else original.fault_plan,
            fixture_preset=original.fixture_preset,
        )
        return self.create_run(
            request,
            operation="candidate_rerun",
            compared_to_run_id=original.run_id,
        )

    @staticmethod
    def _replace_identity(
        value: Any,
        *,
        old_run_id: str,
        new_run_id: str,
        old_trace_id: str,
        new_trace_id: str,
    ) -> Any:
        if isinstance(value, dict):
            return {
                key: RuntimeEngine._replace_identity(
                    item,
                    old_run_id=old_run_id,
                    new_run_id=new_run_id,
                    old_trace_id=old_trace_id,
                    new_trace_id=new_trace_id,
                )
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [
                RuntimeEngine._replace_identity(
                    item,
                    old_run_id=old_run_id,
                    new_run_id=new_run_id,
                    old_trace_id=old_trace_id,
                    new_trace_id=new_trace_id,
                )
                for item in value
            ]
        if value == old_run_id:
            return new_run_id
        if value == old_trace_id:
            return new_trace_id
        return value

    def _build_graph(self, record: RunRecord) -> Any:
        bundle = AgentBundle(
            record.run_id,
            lambda run_id, body: self.store.publish_once(run_id, "publish-critical-alert-1", body),
        )
        self._bundles[record.run_id] = bundle
        builder = StateGraph(GraphState)

        def input_node(state: GraphState) -> GraphState:
            self._event(record, "input", "node_started")
            parsed = ThreatIndicatorsV1.model_validate(state["input"])
            self._pydantic_evidence(
                record,
                node_id="input",
                layer="input_contract",
                contract=ThreatIndicatorsV1,
                status="passed",
                title="Threat input satisfied ThreatIndicatorsV1",
                explanation=(
                    "Strict Pydantic validation ran before the workflow accepted the "
                    "indicator set."
                ),
                guarantee="contract",
                teaching_note=(
                    "Input validation proves shape and declared constraints, not whether "
                    "the indicator is malicious."
                ),
                output_snapshot=parsed.model_dump(mode="json"),
            )
            self._event(
                record,
                "input",
                "node_finished",
                metadata={"contract": "ThreatIndicatorsV1"},
            )
            return {"input": parsed.model_dump(mode="json")}

        def enricher_node(state: GraphState) -> GraphState:
            del state
            self._event(record, "enricher", "node_started")
            before = bundle.counters.calls.get("enricher", 0)
            result = bundle.enricher.run_sync(
                "Enrich the registered threat indicator using only fixture sources.",
                deps=AgentDeps(record.run_id, record.variant),
            )
            requests = bundle.counters.calls.get("enricher", 0) - before
            self._record_invocation(
                record,
                node_id="enricher",
                contract="EnrichmentResultV1",
                result=result,
                request_count=requests,
            )
            if requests > 1:
                self._event(
                    record,
                    "enricher",
                    "agent_output_retry",
                    attempt=1,
                    errors=["required field 'reputation' missing"],
                    metadata={"enforcement_layer": "pydantic_ai"},
                )
            self._pydantic_evidence(
                record,
                node_id="enricher",
                layer="agent_output",
                contract=EnrichmentResultV1,
                status="repaired" if requests > 1 else "passed",
                title="Pydantic AI enforced EnrichmentResultV1",
                explanation=(
                    "The first fixture response omitted reputation. Pydantic AI returned "
                    "structured feedback to the model and accepted the bounded retry."
                ),
                guarantee="contract",
                teaching_note=(
                    "An output_type makes retry evidence observable; it does not make a "
                    "schema-valid attribution true."
                ),
                attempt=requests,
                validation_errors=(
                    [{"loc": ["reputation"], "msg": "Field required", "type": "missing"}]
                    if requests > 1
                    else []
                ),
                output_snapshot=result.output.model_dump(mode="json"),
            )
            self._event(record, "enricher", "node_finished", attempt=requests)
            return {"enrichment": result.output.model_dump(mode="json")}

        def edge_validator_node(state: GraphState) -> GraphState:
            self._event(record, "edge_validator", "node_started")
            candidate = dict(state["enrichment"])
            drift = self._fault(record.fault_plan, "contract_drift")
            if drift and not state.get("edge_fault_applied"):
                candidate.pop("reputation", None)
                self._event(
                    record,
                    "edge_validator",
                    "fault_injected",
                    metadata={"hook": "post_output_pre_edge", "mutation": "drop reputation"},
                )
            validation_errors: list[dict[str, Any]] = []
            try:
                validated = TypeAdapter(EnrichmentResultV1).validate_python(candidate)
                repaired = False
            except ValidationError as exc:
                validation_errors = exc.errors(
                    include_url=False,
                    include_context=False,
                )
                self._event(
                    record,
                    "edge_validator",
                    "edge_contract_rejected",
                    errors=[error["msg"] for error in exc.errors()],
                    metadata={"enforcement_layer": "langgraph_edge", "bounded_revision": True},
                )
                validated = TypeAdapter(EnrichmentResultV1).validate_python(state["enrichment"])
                repaired = True
            envelope = make_envelope(
                run_id=record.run_id,
                trace_id=record.trace_id,
                hop=1,
                sender="Enricher",
                receiver="Analyst",
                schema_name="EnrichmentResultV1",
                payload=validated,
                claims=validated.claims,
                source_ids=validated.source_ids,
                constraint_ids=record.input.get("required_constraint_ids", []),
                parent_hash=None,
            )
            self._pydantic_evidence(
                record,
                node_id="edge_validator",
                layer="edge_contract",
                contract=EnrichmentResultV1,
                status="repaired" if repaired else "passed",
                title="TypeAdapter protected the LangGraph handoff",
                explanation=(
                    "The producer/consumer boundary independently validated the typed "
                    "handoff and its provenance envelope."
                ),
                guarantee="contract",
                teaching_note=(
                    "Edge validation catches post-agent drift separately from an in-agent "
                    "Pydantic AI retry."
                ),
                validation_errors=validation_errors,
                input_snapshot=candidate,
                output_snapshot=envelope.model_dump(mode="json"),
            )
            self._event(
                record,
                "edge_validator",
                "handoff_validation",
                metadata={
                    "valid": True,
                    "repaired": repaired,
                    "integrity_hash": envelope.integrity_hash,
                },
            )
            self._event(record, "edge_validator", "node_finished")
            return {
                "enrichment": validated.model_dump(mode="json"),
                "enrichment_envelope": envelope.model_dump(mode="json"),
                "edge_fault_applied": bool(drift),
            }

        def analyst_node(state: GraphState) -> GraphState:
            self._event(record, "analyst", "node_started")
            envelope = HandoffEnvelope[Any].model_validate(state["enrichment_envelope"])
            result = bundle.analyst.run_sync(
                json.dumps(envelope.payload, sort_keys=True),
                deps=AgentDeps(record.run_id, record.variant),
            )
            self._record_invocation(
                record,
                node_id="analyst",
                contract="ThreatAssessmentV1",
                result=result,
                request_count=1,
            )
            output = result.output
            self._pydantic_evidence(
                record,
                node_id="analyst",
                layer="agent_output",
                contract=ThreatAssessmentV1,
                status="passed",
                title="Analyst returned ThreatAssessmentV1",
                explanation=(
                    "Pydantic AI accepted the analyst's typed claims, citations, and "
                    "confidence fields."
                ),
                guarantee="contract",
                teaching_note=(
                    "This green check is deliberately not a factuality check: a false "
                    "attribution can still be perfectly typed."
                ),
                output_snapshot=output.model_dump(mode="json"),
            )
            next_envelope = make_envelope(
                run_id=record.run_id,
                trace_id=record.trace_id,
                hop=2,
                sender="Analyst",
                receiver="PublisherReviewer",
                schema_name="ThreatAssessmentV1",
                payload=output,
                claims=output.claims,
                source_ids=output.source_ids,
                constraint_ids=envelope.preserved_constraint_ids,
                parent_hash=envelope.integrity_hash,
            )
            self._event(record, "analyst", "node_finished")
            return {
                "assessment": output.model_dump(mode="json"),
                "assessment_envelope": next_envelope.model_dump(mode="json"),
            }

        def factuality_node(state: GraphState) -> GraphState:
            self._event(record, "factuality", "node_started")
            assessment = ThreatAssessmentV1.model_validate(state["assessment"])
            rejected: list[str] = []
            for claim in assessment.claims:
                authoritative = assess_claim(claim, "factuality")
                record.claim_assessments.append(authoritative)
                integrity, missing = citation_integrity(claim)
                support = citation_support(claim)
                self._event(
                    record,
                    "factuality",
                    "factuality_assessment",
                    metadata={
                        "claim_id": claim.id,
                        "assessment": authoritative.assessment,
                        "contract_valid": True,
                    },
                )
                self._event(
                    record,
                    "factuality",
                    "citation_assessment",
                    metadata={
                        "claim_id": claim.id,
                        "integrity": integrity,
                        "missing_source_ids": missing,
                        "support": support,
                    },
                )
                if authoritative.assessment in {"unsupported", "contradicted"} or not support:
                    rejected.append(claim.id)
                self._pydantic_evidence(
                    record,
                    node_id="factuality",
                    layer="task_quality",
                    contract=None,
                    status=(
                        "rejected"
                        if authoritative.assessment in {"unsupported", "contradicted"}
                        or not support
                        else "passed"
                    ),
                    title=f"Independent claim check: {claim.id}",
                    explanation=(
                        f"Authoritative fixture assessment={authoritative.assessment}; "
                        f"citation_support={support}; citation_integrity={integrity}."
                    ),
                    guarantee="factuality",
                    teaching_note=(
                        "Pydantic validated the claim object; an independent evaluator "
                        "decided whether its content was supported."
                    ),
                    output_snapshot=claim.model_dump(mode="json"),
                )
            assessment.rejected_claim_ids = rejected
            self._event(
                record,
                "factuality",
                "node_finished",
                metadata={"rejected_claim_ids": rejected},
            )
            return {"assessment": assessment.model_dump(mode="json")}

        def reviewer_node(state: GraphState) -> GraphState:
            self._event(record, "reviewer", "node_started")
            result = bundle.reviewer.run_sync(
                json.dumps(state["assessment"], sort_keys=True),
                deps=AgentDeps(record.run_id, record.variant),
            )
            self._record_invocation(
                record,
                node_id="reviewer",
                contract="ThreatBriefV1",
                result=result,
                request_count=1,
            )
            self._event(record, "reviewer", "node_finished")
            return {"brief": result.output.model_dump(mode="json")}

        def publisher_node(state: GraphState) -> GraphState:
            self._event(record, "publisher", "node_started")
            result = bundle.publisher.run_sync(
                json.dumps(state["brief"], sort_keys=True),
                deps=AgentDeps(record.run_id, record.variant),
            )
            if not isinstance(result.output, DeferredToolRequests) or not result.output.approvals:
                raise RuntimeError("Publisher fixture did not return a deferred approval request.")
            call = result.output.approvals[0]
            args = call.args_as_dict()
            pending = PendingApproval(
                approval_id=stable_hash(f"{record.run_id}:{call.tool_call_id}")[:24],
                run_id=record.run_id,
                checkpoint_id=f"langgraph:{record.run_id}",
                tool_call_id=call.tool_call_id,
                validated_args_hash=stable_hash(args),
                config_hash=record.config_hash,
                status="pending",
                arguments=args,
            )
            self.store.create_approval(pending)
            record.pending_approvals = [pending]
            self._record_invocation(
                record,
                node_id="publisher",
                contract="ThreatBriefV1",
                result=result,
                request_count=1,
            )
            self._event(
                record,
                "publisher",
                "approval_requested",
                metadata={
                    "approval_id": pending.approval_id,
                    "tool_call_id": pending.tool_call_id,
                    "arguments": pending.arguments,
                },
            )
            self._event(record, "publisher", "node_finished", metadata={"deferred": True})
            return {
                "publisher_messages": ModelMessagesTypeAdapter.dump_python(
                    result.all_messages(), mode="json"
                ),
                "pending_call": {
                    "tool_name": call.tool_name,
                    "args": call.args_as_dict(),
                    "tool_call_id": call.tool_call_id,
                },
                "approval_id": pending.approval_id,
            }

        def approval_node(state: GraphState) -> GraphState:
            decision = interrupt(
                {
                    "approval_id": state["approval_id"],
                    "tool": state["pending_call"]["tool_name"],
                    "arguments": state["pending_call"]["args"],
                    "message": "Approve publishing the verified critical alert?",
                }
            )
            self._event(
                record,
                "approval",
                "approval_resolved",
                metadata={"decision": "approved" if decision else "denied"},
            )
            return {"decision": bool(decision)}

        def publisher_resume_node(state: GraphState) -> GraphState:
            messages = ModelMessagesTypeAdapter.validate_python(state["publisher_messages"])
            call = state["pending_call"]
            result = bundle.publisher.run_sync(
                message_history=messages,
                deferred_tool_results=DeferredToolResults(approvals={call["tool_call_id"]: True}),
                deps=AgentDeps(record.run_id, record.variant),
            )
            if isinstance(result.output, DeferredToolRequests):
                raise RuntimeError("Approved publisher request remained deferred.")
            self.store.consume_approval(state["approval_id"])
            for pending in record.pending_approvals:
                if pending.approval_id == state["approval_id"]:
                    pending.status = "consumed"
            self._event(
                record,
                "publisher",
                "tool_call",
                metadata={
                    "tool": call["tool_name"],
                    "tool_call_id": call["tool_call_id"],
                    "approved": True,
                    "side_effect_count": self.store.side_effect_count(record.run_id),
                },
            )
            self._record_invocation(
                record,
                node_id="publisher",
                contract="ThreatBriefV1",
                result=result,
                request_count=1,
            )
            return {"brief": result.output.model_dump(mode="json")}

        def denied_node(state: GraphState) -> GraphState:
            brief = ThreatBriefV1.model_validate(state["brief"]).model_copy(
                update={"publish": False}
            )
            return {"brief": brief.model_dump(mode="json"), "terminal_note": "Publication denied."}

        def output_node(state: GraphState) -> GraphState:
            self._event(record, "output", "node_started")
            if record.variant == "baseline":
                brief = baseline_brief()
            else:
                brief = ThreatBriefV1.model_validate(state["brief"])
            self._pydantic_evidence(
                record,
                node_id="output",
                layer="agent_output",
                contract=ThreatBriefV1,
                status="passed",
                title="Final brief satisfied ThreatBriefV1",
                explanation=(
                    "The final publication object is typed even when a baseline claim is "
                    "semantically unsafe."
                ),
                guarantee="contract",
                teaching_note=(
                    "Contract validity and factual safety remain separate reportable "
                    "guarantees."
                ),
                output_snapshot=brief.model_dump(mode="json"),
            )
            self._event(
                record,
                "output",
                "node_finished",
                metadata={"publish": brief.publish, "terminal_note": state.get("terminal_note")},
            )
            return {"brief": brief.model_dump(mode="json")}

        builder.add_node("input", input_node)
        builder.add_node("enricher", enricher_node)
        builder.add_node("edge_validator", edge_validator_node)
        builder.add_node("analyst", analyst_node)
        builder.add_node("output", output_node)
        builder.add_edge(START, "input")
        builder.add_edge("input", "enricher")
        builder.add_edge("enricher", "edge_validator")
        builder.add_edge("edge_validator", "analyst")
        if record.variant == "baseline":
            builder.add_edge("analyst", "output")
        else:
            builder.add_node("factuality", factuality_node)
            builder.add_node("reviewer", reviewer_node)
            builder.add_node("publisher", publisher_node)
            builder.add_node("approval", approval_node)
            builder.add_node("publisher_resume", publisher_resume_node)
            builder.add_node("denied", denied_node)
            builder.add_edge("analyst", "factuality")
            builder.add_edge("factuality", "reviewer")
            builder.add_edge("reviewer", "publisher")
            builder.add_edge("publisher", "approval")
            builder.add_conditional_edges(
                "approval",
                lambda state: "approved" if state.get("decision") else "denied",
                {"approved": "publisher_resume", "denied": "denied"},
            )
            builder.add_edge("publisher_resume", "output")
            builder.add_edge("denied", "output")
        builder.add_edge("output", END)
        graph = builder.compile(checkpointer=self._checkpointer, name=f"reagent-{record.variant}")
        self._graphs[record.run_id] = graph
        return graph

    def _record_invocation(
        self,
        record: RunRecord,
        *,
        node_id: str,
        contract: str,
        result: Any,
        request_count: int,
    ) -> None:
        messages = ModelMessagesTypeAdapter.dump_python(result.all_messages(), mode="json")
        usage = result.usage
        invocation = AgentInvocationRecord(
            invocation_id=str(uuid.uuid4()),
            node_id=node_id,
            attempt=len([item for item in record.agent_invocations if item.node_id == node_id]) + 1,
            model_provider="fixture",
            model_name=f"reagent-fixture-{node_id}-v1",
            output_contract=ContractRef(name=contract, version="1"),
            request_fingerprint=stable_hash(
                {"node": node_id, "contract": contract, "messages": messages}
            ),
            serialized_messages=messages,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            request_count=request_count,
        )
        record.agent_invocations.append(invocation)
        for attempt in range(1, request_count + 1):
            self._event(
                record,
                node_id,
                "model_request",
                attempt=attempt,
                metadata={"provider": "fixture", "external": False},
            )

    @staticmethod
    def _pydantic_evidence(
        record: RunRecord,
        *,
        node_id: str,
        layer: Any,
        contract: type[Any] | None,
        status: Any,
        title: str,
        explanation: str,
        guarantee: Any,
        teaching_note: str,
        attempt: int = 1,
        validation_errors: list[dict[str, Any]] | None = None,
        input_snapshot: dict[str, Any] | None = None,
        output_snapshot: dict[str, Any] | None = None,
    ) -> None:
        schema = contract.model_json_schema() if contract else {}
        record.pydantic_evidence.append(
            PydanticEvidence(
                evidence_id=str(uuid.uuid4()),
                node_id=node_id,
                layer=layer,
                contract_name=contract.__name__ if contract else None,
                status=status,
                title=title,
                explanation=explanation,
                attempt=attempt,
                validation_errors=validation_errors or [],
                schema_excerpt=(
                    {
                        "title": schema.get("title"),
                        "required": schema.get("required", []),
                        "properties": schema.get("properties", {}),
                        "$defs": schema.get("$defs", {}),
                        "additionalProperties": schema.get("additionalProperties"),
                        "oneOf": schema.get("oneOf", []),
                        "anyOf": schema.get("anyOf", []),
                        "discriminator": schema.get("discriminator"),
                    }
                    if schema
                    else {}
                ),
                input_snapshot=input_snapshot,
                output_snapshot=output_snapshot,
                guarantee=guarantee,
                teaching_note=teaching_note,
            )
        )

    def _sync_checkpoint(self, record: RunRecord, graph: Any, config: dict[str, Any]) -> None:
        snapshot = graph.get_state(config)
        self._collect_authoritative_assessments(record, snapshot.values)
        checkpoint_id = snapshot.config.get("configurable", {}).get("checkpoint_id", "unknown")
        for item in record.pending_approvals:
            item.checkpoint_id = checkpoint_id
            self.store.update_approval_checkpoint(item.approval_id, checkpoint_id)
        self._event(
            record,
            None,
            "checkpoint_saved",
            metadata={"checkpoint_id": checkpoint_id, "next": list(snapshot.next)},
        )

    def _finalize(
        self,
        record: RunRecord,
        state: GraphState,
        elapsed_ms: float,
        *,
        resumed: bool = False,
    ) -> None:
        brief = ThreatBriefV1.model_validate(state["brief"])
        record.outputs = {"brief": brief.model_dump(mode="json")}
        self._collect_authoritative_assessments(record, state)
        escape = any(
            item.assessment in {"unsupported", "contradicted"} and item.node_id == "output"
            for item in record.claim_assessments
        )
        self._pydantic_evidence(
            record,
            node_id="output",
            layer="task_quality",
            contract=None,
            status="failed" if escape else "passed",
            title="Schema-valid output checked against fixture truth",
            explanation=(
                "A typed unsupported claim reached the final output. The Pydantic contract "
                "passed, while the independent factuality guarantee failed."
                if escape
                else "No unsupported or contradicted claim reached the final output."
            ),
            guarantee="factuality",
            teaching_note=(
                "This is the core schema-versus-truth lesson: Pydantic constrains data; "
                "authoritative evals assess what the data means."
            ),
            output_snapshot=brief.model_dump(mode="json"),
        )
        contaminated_nodes = {
            item.node_id
            for item in record.claim_assessments
            if item.assessment in {"unsupported", "contradicted"} and item.node_id != "factuality"
        }
        unknown = [item for item in record.claim_assessments if item.assessment == "unknown"]
        request_count = sum(item.request_count for item in record.agent_invocations)
        input_tokens = sum(item.input_tokens or 0 for item in record.agent_invocations)
        output_tokens = sum(item.output_tokens or 0 for item in record.agent_invocations)
        rejected = any(
            event.kind == "factuality_assessment"
            and event.metadata.get("assessment") in {"unsupported", "contradicted"}
            for event in record.events
        )
        prior_duration = record.metrics.duration_ms if record.metrics else 0
        record.metrics = RunMetrics(
            duration_ms=prior_duration + elapsed_ms,
            request_count=request_count,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            tool_calls=sum(event.kind == "tool_call" for event in record.events),
            first_attempt_contract_pass=not any(
                event.kind in {"agent_output_retry", "edge_contract_rejected"}
                for event in record.events
            ),
            final_contract_pass=True,
            task_pass=bool(brief.body.strip()),
            containment=(rejected and not escape) if record.variant == "hardened" else False,
            propagation_depth=max(0, len(contaminated_nodes) - 1),
            blast_radius=len(contaminated_nodes),
            critical_output_escape=escape,
            unknown_assessment_rate=(
                len(unknown) / len(record.claim_assessments) if record.claim_assessments else 1.0
            ),
            labels={
                "duration": "measurement",
                "tokens": "measurement",
                "task_pass": "measurement",
                "containment": "measurement",
                "cost": "not_measured",
            },
        )
        record.terminal_status = "succeeded"
        record.ended_at = utc_now()
        record.semantic_trace_hash = self._semantic_hash(record)
        self._event(
            record,
            None,
            "run_finished",
            metadata={"status": "succeeded", "resumed": resumed},
        )

    def _collect_authoritative_assessments(self, record: RunRecord, state: GraphState) -> None:
        existing = {(item.node_id, item.claim_id) for item in record.claim_assessments}
        collections: list[tuple[str, list[dict[str, Any]]]] = []
        if state.get("enrichment"):
            collections.append(("enricher", state["enrichment"].get("claims", [])))
        if state.get("assessment"):
            collections.append(("analyst", state["assessment"].get("claims", [])))
        if state.get("brief"):
            collections.append(("output", state["brief"].get("claims", [])))
        for node_id, raw_claims in collections:
            for raw_claim in raw_claims:
                claim = ModelClaim.model_validate(raw_claim)
                if (node_id, claim.id) not in existing:
                    record.claim_assessments.append(assess_claim(claim, node_id))

    def _semantic_hash(self, record: RunRecord) -> str:
        return stable_hash(
            {
                "variant": record.variant,
                "status": record.terminal_status,
                "events": [
                    {
                        "node": event.node_id,
                        "kind": event.kind,
                        "attempt": event.attempt,
                        "errors": event.validation_errors,
                        "semantic_metadata": {
                            key: value
                            for key, value in event.metadata.items()
                            if key
                            in {
                                "valid",
                                "repaired",
                                "enforcement_layer",
                                "assessment",
                                "integrity",
                                "support",
                                "approved",
                                "deferred",
                                "publish",
                                "status",
                            }
                        },
                    }
                    for event in record.events
                    if event.kind != "checkpoint_saved"
                ],
                "outputs": record.outputs,
                "assessments": [item.model_dump(mode="json") for item in record.claim_assessments],
            }
        )

    def _update_duration(self, record: RunRecord, elapsed_ms: float) -> None:
        record.metrics = RunMetrics(
            duration_ms=elapsed_ms,
            request_count=sum(item.request_count for item in record.agent_invocations),
            input_tokens=sum(item.input_tokens or 0 for item in record.agent_invocations),
            output_tokens=sum(item.output_tokens or 0 for item in record.agent_invocations),
            tool_calls=0,
            first_attempt_contract_pass=not any(
                event.kind in {"agent_output_retry", "edge_contract_rejected"}
                for event in record.events
            ),
            final_contract_pass=True,
            task_pass=None,
            containment=None,
            propagation_depth=0,
            blast_radius=0,
            critical_output_escape=False,
            unknown_assessment_rate=1.0,
            labels={
                "duration": "measurement",
                "tokens": "measurement",
                "task_pass": "not_measured",
                "containment": "not_measured",
                "cost": "not_measured",
            },
        )

    def _event(
        self,
        record: RunRecord,
        node_id: str | None,
        kind: Any,
        *,
        attempt: int = 1,
        errors: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        now = utc_now()
        record.events.append(
            RunEvent(
                event_id=str(uuid.uuid4()),
                run_id=record.run_id,
                node_id=node_id,
                kind=kind,
                started_at=now,
                ended_at=now,
                attempt=attempt,
                validation_errors=errors or [],
                metadata=metadata or {},
            )
        )

    @staticmethod
    def _fault(faults: list[FaultInjection], case: str) -> FaultInjection | None:
        return next((fault for fault in faults if fault.case == case), None)
