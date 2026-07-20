from __future__ import annotations

import time
import uuid
from typing import Any, TypedDict

import pydantic_ai.models
from langgraph.graph import END, START, StateGraph
from pydantic import TypeAdapter, ValidationError
from pydantic_ai import Agent
from pydantic_ai.messages import ModelMessagesTypeAdapter, ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from ..models import (
    AgentInvocationRecord,
    ContractRef,
    CreateRunRequest,
    PydanticEvidence,
    RunEvent,
    RunMetrics,
    RunRecord,
    stable_hash,
    utc_now,
)
from ..store import RuntimeStore
from .base import QualityCheck, ScenarioDefinition


class ScenarioGraphState(TypedDict, total=False):
    input: dict[str, Any]
    handoff: dict[str, Any]
    envelope: dict[str, Any]
    output: dict[str, Any]
    quality_checks: list[dict[str, Any]]


class RegisteredScenarioRunner:
    def __init__(
        self,
        store: RuntimeStore,
        definitions: dict[str, ScenarioDefinition],
        runtime_build_hash: str,
    ) -> None:
        self.store = store
        self.definitions = definitions
        self.runtime_build_hash = runtime_build_hash

    def create_run(
        self,
        request: CreateRunRequest,
        *,
        operation: str = "execute",
        compared_to_run_id: str | None = None,
    ) -> RunRecord:
        definition = self.definitions.get(request.scenario_id)
        if not definition:
            raise ValueError(f"Scenario '{request.scenario_id}' has no registered runtime.")
        if request.run_mode != "fixture":
            raise ValueError(
                "Live provider execution is disabled for guided scenario fixtures."
            )
        if request.fixture_preset and request.fixture_preset not in definition.fixture_presets:
            raise ValueError(
                f"Unknown fixture preset '{request.fixture_preset}' for {request.scenario_id}."
            )

        pydantic_ai.models.ALLOW_MODEL_REQUESTS = False
        raw_input = request.input or definition.fixture_input
        validated_input = definition.input_model.model_validate(raw_input)
        workflow = definition.workflow_spec(request.variant)
        workflow_hash = stable_hash(workflow.model_dump(mode="json"))
        config_hash = stable_hash(
            {
                "workflow": workflow_hash,
                "scenario": definition.scenario_id,
                "variant": request.variant,
                "contracts": [model.model_json_schema() for model in definition.contract_models],
                "fixture_preset": request.fixture_preset,
                "faults": [fault.model_dump(mode="json") for fault in request.fault_plan],
                "runtime": self.runtime_build_hash,
            }
        )
        record = RunRecord(
            run_id=str(uuid.uuid4()),
            trace_id=str(uuid.uuid4()),
            scenario_id=definition.scenario_id,
            variant=request.variant,
            run_mode="fixture",
            terminal_status="running",
            runtime_build_hash=self.runtime_build_hash,
            fixture_set_version=f"{definition.scenario_id}-fixtures-v1",
            workflow_hash=workflow_hash,
            config_hash=config_hash,
            input=validated_input.model_dump(mode="json"),
            fault_plan=request.fault_plan,
            operation=operation,
            compared_to_run_id=compared_to_run_id,
            fixture_preset=request.fixture_preset,
        )
        self.store.save_run(record)
        graph = self._build_graph(record, definition)
        started = time.perf_counter()
        try:
            state = graph.invoke({"input": record.input})
            self._finalize(record, definition, state, (time.perf_counter() - started) * 1000)
        except Exception as exc:
            record.terminal_status = "failed"
            record.failure_reason = f"{type(exc).__name__}: {exc}"
            record.ended_at = utc_now()
            self._event(record, None, "run_finished", metadata={"status": "failed"})
        self.store.save_run(record)
        return record

    def _build_graph(self, record: RunRecord, definition: ScenarioDefinition) -> Any:
        counters = {"producer": 0, "consumer": 0}
        consumer_handoff: dict[str, dict[str, Any]] = {}
        runtime_observation: dict[str, dict[str, Any]] = {}

        def producer_response(messages: list[Any], info: AgentInfo) -> ModelResponse:
            del messages
            counters["producer"] += 1
            if counters["producer"] == 1:
                payload = definition.build_invalid_handoff(
                    record.variant, record.input, record.fixture_preset
                )
            else:
                payload = definition.build_handoff(
                    record.variant, record.input, record.fixture_preset
                )
            return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, payload)])

        def consumer_response(messages: list[Any], info: AgentInfo) -> ModelResponse:
            del messages
            counters["consumer"] += 1
            handoff = definition.handoff_model.model_validate(consumer_handoff["value"])
            payload = definition.build_output(
                record.variant,
                record.input,
                handoff.model_dump(mode="json"),
                record.fixture_preset,
            )
            if definition.runtime_probe:
                observation = definition.runtime_probe(
                    record.variant,
                    record.input,
                    record.fixture_preset,
                )
                runtime_observation["value"] = observation
                if definition.apply_runtime_observation:
                    payload = definition.apply_runtime_observation(payload, observation)
            return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, payload)])

        producer = Agent(
            FunctionModel(
                producer_response,
                model_name=f"reagent-{definition.scenario_id}-producer-fixture-v1",
            ),
            name=definition.producer_name,
            output_type=definition.handoff_model,
            retries=2,
        )
        consumer = Agent(
            FunctionModel(
                consumer_response,
                model_name=f"reagent-{definition.scenario_id}-consumer-fixture-v1",
            ),
            name=definition.consumer_name,
            output_type=definition.output_model,
            retries=2,
        )

        def input_node(state: ScenarioGraphState) -> ScenarioGraphState:
            self._event(record, "input", "node_started")
            parsed = definition.input_model.model_validate(state["input"])
            self._evidence(
                record,
                node_id="input",
                layer="input_contract",
                contract=definition.input_model,
                status="passed",
                title="Scenario input validated",
                explanation=(
                    "Pydantic rejected unknown fields and enforced input constraints "
                    "before execution."
                ),
                guarantee="contract",
                teaching_note=(
                    "A typed input prevents malformed work from entering the graph; "
                    "it does not prove the request is wise."
                ),
                output_snapshot=parsed.model_dump(mode="json"),
            )
            self._event(
                record,
                "input",
                "node_finished",
                metadata={"contract": definition.input_model.__name__},
            )
            return {"input": parsed.model_dump(mode="json")}

        def producer_node(state: ScenarioGraphState) -> ScenarioGraphState:
            self._event(record, "producer", "node_started")
            invalid = definition.build_invalid_handoff(
                record.variant, state["input"], record.fixture_preset
            )
            validation_errors: list[dict[str, Any]] = []
            try:
                definition.handoff_model.model_validate(invalid)
            except ValidationError as exc:
                validation_errors = exc.errors(
                    include_url=False,
                    include_context=False,
                )
            before = counters["producer"]
            result = producer.run_sync(
                f"Produce the typed {definition.handoff_model.__name__} fixture handoff."
            )
            requests = counters["producer"] - before
            self._record_invocation(
                record,
                node_id="producer",
                contract=definition.handoff_model.__name__,
                result=result,
                request_count=requests,
            )
            if requests > 1:
                self._event(
                    record,
                    "producer",
                    "agent_output_retry",
                    errors=[error["msg"] for error in validation_errors],
                    metadata={"enforcement_layer": "pydantic_ai", "repaired": True},
                )
            self._evidence(
                record,
                node_id="producer",
                layer="agent_output",
                contract=definition.handoff_model,
                status="repaired" if requests > 1 else "passed",
                title="Pydantic AI repaired malformed model output",
                explanation=(
                    "The deterministic model's first response violated the output contract; "
                    "Pydantic AI returned structured validation feedback and retried "
                    "within the run."
                ),
                guarantee="contract",
                teaching_note=(
                    "ModelRetry repairs shape and constraints. A schema-valid choice can "
                    "still be behaviorally wrong."
                ),
                attempt=requests,
                validation_errors=validation_errors,
                input_snapshot=invalid,
                output_snapshot=result.output.model_dump(mode="json"),
            )
            self._event(record, "producer", "node_finished", attempt=requests)
            return {"handoff": result.output.model_dump(mode="json")}

        def edge_node(state: ScenarioGraphState) -> ScenarioGraphState:
            self._event(record, "edge_validator", "node_started")
            candidate = dict(state["handoff"])
            inject_drift = record.fixture_preset == "contract_drift" or any(
                fault.case == "contract_drift" for fault in record.fault_plan
            )
            if inject_drift:
                candidate.pop(definition.edge_fault_field, None)
                self._event(
                    record,
                    "edge_validator",
                    "fault_injected",
                    metadata={
                        "hook": "post_output_pre_edge",
                        "mutation": f"drop {definition.edge_fault_field}",
                    },
                )
            validation_errors: list[dict[str, Any]] = []
            repaired = False
            try:
                validated = TypeAdapter(definition.handoff_model).validate_python(candidate)
            except ValidationError as exc:
                validation_errors = exc.errors(
                    include_url=False,
                    include_context=False,
                )
                repaired = True
                self._event(
                    record,
                    "edge_validator",
                    "edge_contract_rejected",
                    errors=[error["msg"] for error in validation_errors],
                    metadata={
                        "enforcement_layer": "pydantic_type_adapter",
                        "bounded_revision": True,
                    },
                )
                validated = TypeAdapter(definition.handoff_model).validate_python(
                    state["handoff"]
                )
            envelope_owned = {
                "run_id": record.run_id,
                "trace_id": record.trace_id,
                "hop": 1,
                "sender": definition.producer_name,
                "receiver": definition.consumer_name,
                "schema_name": definition.handoff_model.__name__,
                "schema_version": "1",
                "payload": validated.model_dump(mode="json"),
            }
            envelope = {**envelope_owned, "integrity_hash": stable_hash(envelope_owned)}
            self._evidence(
                record,
                node_id="edge_validator",
                layer="edge_contract",
                contract=definition.handoff_model,
                status="repaired" if repaired else "passed",
                title="LangGraph edge accepted a typed handoff",
                explanation=(
                    "A Pydantic TypeAdapter validated the producer/consumer boundary. "
                    "Post-output corruption is distinct from an in-agent ModelRetry."
                ),
                guarantee="contract",
                teaching_note=(
                    "Validate again at trust boundaries because values can drift after "
                    "an agent returns."
                ),
                validation_errors=validation_errors,
                input_snapshot=candidate,
                output_snapshot=envelope,
            )
            self._event(
                record,
                "edge_validator",
                "handoff_validation",
                metadata={
                    "valid": True,
                    "repaired": repaired,
                    "contract": definition.handoff_model.__name__,
                    "integrity_hash": envelope["integrity_hash"],
                },
            )
            self._event(record, "edge_validator", "node_finished")
            return {
                "handoff": validated.model_dump(mode="json"),
                "envelope": envelope,
            }

        def consumer_node(state: ScenarioGraphState) -> ScenarioGraphState:
            self._event(record, "consumer", "node_started")
            consumer_handoff["value"] = state["handoff"]
            before = counters["consumer"]
            result = consumer.run_sync(
                f"Consume the validated handoff and return {definition.output_model.__name__}."
            )
            requests = counters["consumer"] - before
            self._record_invocation(
                record,
                node_id="consumer",
                contract=definition.output_model.__name__,
                result=result,
                request_count=requests,
            )
            observation = runtime_observation.get("value")
            if observation:
                self._record_runtime_probe(record, observation)
            self._evidence(
                record,
                node_id="consumer",
                layer="agent_output",
                contract=definition.output_model,
                status="passed",
                title="Final agent output satisfied its Pydantic contract",
                explanation=(
                    "Pydantic AI returned a concrete typed object rather than "
                    "unvalidated JSON text."
                ),
                guarantee="contract",
                teaching_note=(
                    "A green contract check proves structure and invariants—not "
                    "factuality or task success."
                ),
                attempt=requests,
                output_snapshot=result.output.model_dump(mode="json"),
            )
            self._event(record, "consumer", "node_finished", attempt=requests)
            return {"output": result.output.model_dump(mode="json")}

        def quality_node(state: ScenarioGraphState) -> ScenarioGraphState:
            self._event(record, "quality", "node_started")
            checks = definition.evaluate_output(
                record.variant,
                record.input,
                state["output"],
                record.fixture_preset,
            )
            for check in checks:
                self._quality_evidence(record, check, state["output"])
            serialized = [
                {
                    "check_id": check.check_id,
                    "title": check.title,
                    "passed": check.passed,
                    "guarantee": check.guarantee,
                    "explanation": check.explanation,
                }
                for check in checks
            ]
            self._event(
                record,
                "quality",
                "node_finished",
                metadata={"passed": all(check.passed for check in checks)},
            )
            return {"quality_checks": serialized}

        def output_node(state: ScenarioGraphState) -> ScenarioGraphState:
            validated = definition.output_model.model_validate(state["output"])
            self._event(record, "output", "node_finished")
            return {"output": validated.model_dump(mode="json")}

        builder = StateGraph(ScenarioGraphState)
        builder.add_node("input", input_node)
        builder.add_node("producer", producer_node)
        builder.add_node("edge_validator", edge_node)
        builder.add_node("consumer", consumer_node)
        builder.add_node("quality", quality_node)
        builder.add_node("output", output_node)
        builder.add_edge(START, "input")
        builder.add_edge("input", "producer")
        builder.add_edge("producer", "edge_validator")
        builder.add_edge("edge_validator", "consumer")
        builder.add_edge("consumer", "quality")
        builder.add_edge("quality", "output")
        builder.add_edge("output", END)
        return builder.compile(name=f"reagent-{definition.scenario_id}-{record.variant}")

    def _finalize(
        self,
        record: RunRecord,
        definition: ScenarioDefinition,
        state: ScenarioGraphState,
        elapsed_ms: float,
    ) -> None:
        output = definition.output_model.model_validate(state["output"])
        checks = state.get("quality_checks", [])
        task_pass = bool(checks) and all(check["passed"] for check in checks)
        record.outputs = {
            "result": output.model_dump(mode="json"),
            "quality_checks": checks,
        }
        record.metrics = RunMetrics(
            duration_ms=elapsed_ms,
            request_count=sum(item.request_count for item in record.agent_invocations),
            input_tokens=sum(item.input_tokens or 0 for item in record.agent_invocations),
            output_tokens=sum(item.output_tokens or 0 for item in record.agent_invocations),
            tool_calls=sum(event.kind == "tool_call" for event in record.events),
            first_attempt_contract_pass=not any(
                event.kind in {"agent_output_retry", "edge_contract_rejected"}
                for event in record.events
            ),
            final_contract_pass=not any(
                item.layer in {"input_contract", "agent_output", "edge_contract"}
                and item.status in {"failed", "rejected"}
                for item in record.pydantic_evidence
            ),
            task_pass=task_pass,
            # Generic scenario fixtures do not carry a tracked injected-risk ID
            # through reached nodes, so task success cannot be relabeled as
            # containment or absence of escape.
            containment=None,
            propagation_depth=0,
            blast_radius=None,
            critical_output_escape=None,
            unknown_assessment_rate=0.0,
            labels={
                "duration": "measurement",
                "tokens": "measurement",
                "task_pass": "measurement",
                "containment": "not_measured",
                "blast_radius": "not_measured",
                "critical_output_escape": "not_measured",
                "cost": "not_measured",
            },
        )
        record.terminal_status = "succeeded"
        record.ended_at = utc_now()
        self._event(record, None, "run_finished", metadata={"status": "succeeded"})
        record.semantic_trace_hash = stable_hash(
            {
                "scenario": record.scenario_id,
                "variant": record.variant,
                "preset": record.fixture_preset,
                "events": [
                    {
                        "node": event.node_id,
                        "kind": event.kind,
                        "errors": event.validation_errors,
                    }
                    for event in record.events
                ],
                "outputs": record.outputs,
                "pydantic": [
                    {
                        "layer": item.layer,
                        "contract": item.contract_name,
                        "status": item.status,
                        "errors": item.validation_errors,
                    }
                    for item in record.pydantic_evidence
                ],
            }
        )

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
        record.agent_invocations.append(
            AgentInvocationRecord(
                invocation_id=str(uuid.uuid4()),
                node_id=node_id,
                attempt=1,
                model_provider="fixture",
                model_name=f"reagent-{record.scenario_id}-{node_id}-fixture-v1",
                output_contract=ContractRef(name=contract, version="1"),
                request_fingerprint=stable_hash(
                    {"node": node_id, "contract": contract, "messages": messages}
                ),
                serialized_messages=messages,
                input_tokens=usage.input_tokens,
                output_tokens=usage.output_tokens,
                request_count=request_count,
            )
        )
        for attempt in range(1, request_count + 1):
            self._event(
                record,
                node_id,
                "model_request",
                attempt=attempt,
                metadata={"provider": "fixture", "external": False},
            )

    def _evidence(
        self,
        record: RunRecord,
        *,
        node_id: str,
        layer: str,
        contract: type[Any] | None,
        status: str,
        title: str,
        explanation: str,
        guarantee: str,
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
                schema_excerpt={
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
                else {},
                input_snapshot=input_snapshot,
                output_snapshot=output_snapshot,
                guarantee=guarantee,
                teaching_note=teaching_note,
            )
        )

    def _quality_evidence(
        self,
        record: RunRecord,
        check: QualityCheck,
        output: dict[str, Any],
    ) -> None:
        self._evidence(
            record,
            node_id="quality",
            layer="task_quality",
            contract=None,
            status="passed" if check.passed else "failed",
            title=check.title,
            explanation=check.explanation,
            guarantee=check.guarantee,
            teaching_note=(
                "This independent check can fail even when every Pydantic contract is green."
            ),
            output_snapshot=output,
        )

    def _record_runtime_probe(
        self,
        record: RunRecord,
        observation: dict[str, Any],
    ) -> None:
        protocol = str(observation.get("protocol", "runtime"))
        request_count = int(observation.get("request_count", 0))
        if request_count:
            serialized_messages = observation.get("serialized_messages", [])
            if not isinstance(serialized_messages, list):
                serialized_messages = []
            record.agent_invocations.append(
                AgentInvocationRecord(
                    invocation_id=str(uuid.uuid4()),
                    node_id=f"{protocol}_runtime",
                    attempt=1,
                    model_provider="fixture",
                    model_name=str(
                        observation.get("model_name", f"reagent-{protocol}-probe-v1")
                    ),
                    output_contract=ContractRef(
                        name=str(
                            observation.get(
                                "observation_contract",
                                f"{protocol.upper()}RuntimeObservationV1",
                            )
                        ),
                        version="1",
                    ),
                    request_fingerprint=stable_hash(
                        {
                            "protocol": protocol,
                            "messages": serialized_messages,
                            "selected_tool": observation.get("selected_tool"),
                        }
                    ),
                    serialized_messages=serialized_messages,
                    input_tokens=observation.get("input_tokens"),
                    output_tokens=observation.get("output_tokens"),
                    request_count=request_count,
                )
            )
            for attempt in range(1, request_count + 1):
                self._event(
                    record,
                    f"{protocol}_runtime",
                    "model_request",
                    attempt=attempt,
                    metadata={"provider": "fixture", "external": False},
                )
        event_map = (
            ("initialized", "mcp_initialize"),
            ("list_tools_observed", "mcp_list_tools"),
            ("call_tool_observed", "tool_call"),
        )
        for key, kind in event_map:
            if observation.get(key):
                self._event(
                    record,
                    "consumer",
                    kind,
                    metadata={
                        "protocol": protocol,
                        "selected_tool": observation.get("selected_tool"),
                        "catalog_size": observation.get("catalog_size"),
                        "external": False,
                    },
                )
        valid_args = bool(observation.get("tool_args_validated", False))
        validation_errors = observation.get("validation_errors", [])
        self._evidence(
            record,
            node_id="consumer",
            layer="tool_arguments",
            contract=None,
            status="passed" if valid_args else "rejected",
            title=f"{protocol.upper()} tool arguments validated at execution",
            explanation=(
                "The registered runtime initialized the tool protocol, listed the actual "
                "catalog, and executed the selected fixture tool with validated arguments."
                if valid_args
                else "The runtime protocol rejected the selected tool arguments."
            ),
            guarantee="policy",
            teaching_note=(
                "This evidence comes from the runtime tool path, not from a model-authored "
                "boolean in the scenario output."
            ),
            validation_errors=(
                validation_errors if isinstance(validation_errors, list) else []
            ),
            input_snapshot={
                "selected_tool": observation.get("selected_tool"),
                "tool_args": observation.get("tool_args"),
            },
            output_snapshot=observation,
        )

    @staticmethod
    def _event(
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
