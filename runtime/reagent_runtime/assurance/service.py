from __future__ import annotations

import json
import threading
from collections import defaultdict, deque
from copy import deepcopy
from dataclasses import dataclass
from decimal import ROUND_HALF_EVEN, Decimal
from pathlib import Path
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, TypeAdapter, ValidationError
from pydantic_ai import Agent, NativeOutput, PromptedOutput, ToolOutput
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from .compiler import compile_graph
from .models import (
    BloatedSwarmInput,
    CompileRequest,
    ContentMachineInput,
    DueDiligenceInput,
    EvalRequest,
    GoldPlaterInput,
    McpMigrationInput,
    OpsCenterInput,
    RunRequest,
    SafetyNetInput,
    ThreatAnalystInput,
)
from .persistence import AssuranceStore
from .registry import (
    ADAPTER_VERSION,
    COMPILER_VERSION,
    SCENARIOS,
    advertised_capabilities_for,
    check_decision,
    checks_for,
    contract_sample,
    contract_type,
    contracts_for,
    direct_callable_fingerprint,
    lowerer_for,
    registry_digests,
)
from .responses import CompileResponse, EvalResponse, RunResponse
from .retrieval import execute_knowledge_retrieval, retrieval_registry_digest
from .wire import canonical_decimal, canonical_hash, canonical_json, canonical_timestamp


class ArtifactNotFound(KeyError):
    pass


class CandidateConflict(RuntimeError):
    pass


class RunInputConflict(ValueError):
    pass


class SuiteNotFound(KeyError):
    pass


INPUT_MODELS: dict[str, type[BaseModel]] = {
    "threat-analyst": ThreatAnalystInput,
    "bloated-swarm": BloatedSwarmInput,
    "content-machine": ContentMachineInput,
    "due-diligence-engine": DueDiligenceInput,
    "gold-plater": GoldPlaterInput,
    "mcp-migration": McpMigrationInput,
    "ops-center": OpsCenterInput,
    "safety-net": SafetyNetInput,
}


def suite_id(scenario_id: str) -> str:
    return f"{scenario_id}-assurance"


@dataclass
class EventLog:
    run_id: str
    candidate_hash: str

    def __post_init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def add(
        self,
        event_type: str,
        *,
        attempt: int = 1,
        node_id: str | None = None,
        edge_id: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        sequence = len(self.events) + 1
        event = {
            "event_id": str(uuid4()),
            "run_id": self.run_id,
            "sequence": sequence,
            "event_type": event_type,
            "attempt_number": attempt,
            "timestamp": canonical_timestamp(),
            "correlation_id": self.run_id,
            "causation_id": self.events[-1]["event_id"] if self.events else None,
            "candidate_hash": self.candidate_hash,
            "canvas_node_id": node_id,
            "canvas_edge_id": edge_id,
            "plan_step_id": f"step:{node_id}" if node_id else None,
            "payload": payload or {},
        }
        self.events.append(event)
        return event


def _contains_marker(payload: Any, *markers: str) -> bool:
    text = canonical_json(payload).lower()
    return any(marker in text for marker in markers)


def _redacted_errors(exc: ValidationError) -> list[dict[str, Any]]:
    return [
        {
            "path": list(error["loc"]),
            "type": error["type"],
            "message": error["msg"],
            "input": "[redacted]",
        }
        for error in exc.errors(include_url=False, include_context=False, include_input=False)
    ]


def _structured_executor(
    *,
    scenario_id: str,
    contract_id: str,
    contract_version: str,
    output_mode: str,
    strict: bool,
    validation_retries: int,
    payload: dict[str, Any],
) -> tuple[dict[str, Any] | None, int, int, int, list[dict[str, Any]]]:
    model_type = contract_type(scenario_id, contract_id, contract_version)
    if model_type is None:
        raise ValueError("Executor contract disappeared after compilation.")
    sample = contract_sample(scenario_id, contract_id, payload, contract_version)
    invalid_first = _contains_marker(payload, "invalid-output", "malformed output") and not bool(
        payload.get("_assurance_revision_feedback")
    )
    invalid_always = _contains_marker(payload, "output-exhausted", "always-invalid")
    calls = 0
    errors: list[dict[str, Any]] = []

    def fixture_model(messages: list[Any], info: AgentInfo) -> ModelResponse:
        nonlocal calls
        calls += 1
        value = dict(sample)
        should_invalidate = invalid_always or (invalid_first and calls == 1)
        if should_invalidate:
            value.pop(next(iter(value)), None)
            try:
                TypeAdapter(model_type).validate_python(value, strict=strict)
            except ValidationError as exc:
                errors.extend(_redacted_errors(exc))
        if info.output_tools:
            return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, value)])
        return ModelResponse(parts=[TextPart(json.dumps(value, ensure_ascii=False))])

    wrapper: Any
    if output_mode == "tool":
        wrapper = ToolOutput(model_type, strict=strict)
    elif output_mode == "native":
        wrapper = NativeOutput(model_type, strict=strict)
    else:
        wrapper = PromptedOutput(model_type)
    agent = Agent(
        FunctionModel(
            fixture_model,
            model_name="reagent-assurance-fixture-v1",
            profile={
                "supports_tools": True,
                "supports_json_schema_output": True,
                "supports_json_object_output": True,
                "default_structured_output_mode": "tool",
            },
        ),
        output_type=wrapper,
        retries={"output": validation_retries, "tools": 0},
    )
    try:
        result = agent.run_sync("Produce the registered assurance output fixture.")
        output = result.output
        if isinstance(output, BaseModel):
            return (
                output.model_dump(mode="json"),
                calls,
                max(calls - 1, 0),
                max(calls - 1, 0),
                errors,
            )
        return (
            TypeAdapter(model_type).validate_python(output, strict=True).model_dump(mode="json"),
            calls,
            max(calls - 1, 0),
            max(calls - 1, 0),
            errors,
        )
    except Exception as exc:  # Pydantic AI raises UnexpectedModelBehavior on retry exhaustion.
        if not errors:
            errors.append(
                {
                    "path": [],
                    "type": "output_validation_exhausted",
                    "message": str(exc),
                    "input": "[redacted]",
                }
            )
        return None, calls, max(calls - 1, 0), max(calls, 1), errors


def _aggregate_checks(
    config: dict[str, Any], results: list[dict[str, Any]]
) -> tuple[str, bool, str]:
    if config["aggregation"] == "all":
        return (
            "1" if all(item["decision"] for item in results) else "0",
            all(item["decision"] for item in results),
            "all(decisions)",
        )
    if config["aggregation"] == "any":
        return (
            "1" if any(item["decision"] for item in results) else "0",
            any(item["decision"] for item in results),
            "any(decisions)",
        )
    quant = Decimal("0.000001")
    terms = []
    numerator = Decimal("0")
    denominator = Decimal("0")
    by_id = {item["check_id"]: item for item in results}
    for check_id in sorted(config["check_ids"]):
        weight = Decimal(config["check_weights"][check_id])
        score = Decimal(by_id[check_id]["score"])
        numerator += weight * score
        denominator += weight
        terms.append(f"{config['check_weights'][check_id]}*{by_id[check_id]['score']}")
    score = (numerator / denominator).quantize(quant, rounding=ROUND_HALF_EVEN)
    score_text = canonical_decimal(score)
    decision = score >= Decimal(config["passing_score"])
    return score_text, decision, f"({' + '.join(terms)})/{canonical_decimal(denominator)}"


def _runtime_implementation_fingerprint() -> str:
    implementations = {
        "contains_marker": _contains_marker,
        "redacted_errors": _redacted_errors,
        "contract_sample": contract_sample,
        "contract_type": contract_type,
        "structured_executor": _structured_executor,
        "aggregate_checks": _aggregate_checks,
        "eval_fixture": _eval_fixture,
        "knowledge_retrieval": execute_knowledge_retrieval,
        "event_log_add": EventLog.add,
        "service_execute": AssuranceService._execute,
        "service_eval_dataset": AssuranceService._run_eval_dataset,
    }
    return canonical_hash(
        {
            "retrieval_registry_digest": retrieval_registry_digest(),
            "implementations": {
                name: direct_callable_fingerprint(
                    implementation,
                    {"runtime_helper_id": name, "runtime_helper_version": "1.0.0"},
                )
                for name, implementation in sorted(implementations.items())
            },
        }
    )


def _runtime_registry_digests(scenario_id: str) -> dict[str, str]:
    digests = registry_digests(scenario_id)
    digests["lowerer_registry_digest"] = canonical_hash(
        {
            "registered_lowerers": digests["lowerer_registry_digest"],
            "runtime_implementation": _runtime_implementation_fingerprint(),
        }
    )
    return digests


class AssuranceService:
    def __init__(self, data_dir: str | Path) -> None:
        self.store = AssuranceStore(Path(data_dir) / "assurance.sqlite3")
        self.lock = threading.RLock()

    def _claim(
        self,
        scope_type: str,
        scope_id: str,
        idempotency_key: str,
        request_hash: str,
    ) -> tuple[dict[str, Any] | None, str | None]:
        status, value = self.store.claim_idempotency(
            scope_type, scope_id, idempotency_key, request_hash
        )
        if status == "replay":
            assert isinstance(value, dict)
            return value, None
        if status == "pending":
            return (
                self.store.wait_for_idempotency(
                    scope_type, scope_id, idempotency_key, request_hash
                ),
                None,
            )
        assert isinstance(value, str)
        return None, value

    def capabilities(self, scenario_id: str) -> dict[str, Any]:
        if scenario_id not in SCENARIOS:
            return {
                "schema_version": "assurance.capabilities.v1",
                "enabled": True,
                "supported": False,
                "scenario_id": scenario_id,
                "adapter_version": None,
                "compiler_version": COMPILER_VERSION,
                "run_input_schema": {},
                "node_capabilities": [],
                "contracts": [],
                "checks": [],
                "patches": [],
                "eval_suites": [],
                "registry_digests": {},
                "help_text": {
                    "unsupported": "No assurance adapter is registered for this scenario."
                },
            }
        ordinary = [
            item.model_dump(mode="json") for item in advertised_capabilities_for(scenario_id)
        ]
        return {
            "schema_version": "assurance.capabilities.v1",
            "enabled": True,
            "supported": True,
            "scenario_id": scenario_id,
            "adapter_version": ADAPTER_VERSION,
            "compiler_version": COMPILER_VERSION,
            "run_input_schema": INPUT_MODELS[scenario_id].model_json_schema(),
            "node_capabilities": ordinary,
            "contracts": [item.model_dump(mode="json") for item in contracts_for(scenario_id)],
            "checks": [item.model_dump(mode="json") for item in checks_for(scenario_id)],
            "patches": [],
            "eval_suites": [
                {
                    "suite_id": suite_id(scenario_id),
                    "version": "1.0.0",
                    "case_ids": ["clean", "causal"],
                }
            ],
            "registry_digests": _runtime_registry_digests(scenario_id),
            "help_text": {
                "executor": "Pydantic AI enforces the selected registered output model.",
                "handoff": "TypeAdapter validates the payload independently and never repairs it.",
                "evidence": "Independent deterministic checks can reject schema-valid falsehoods.",
                "evals": (
                    "Pydantic Evals runs linked candidate executions outside the production graph."
                ),
            },
        }

    def compile(self, request: CompileRequest) -> dict[str, Any]:
        request_hash = canonical_hash(request.model_dump(mode="json"))
        with self.lock:
            replay, claim_owner = self._claim(
                "compile",
                request.scenario_id,
                request.idempotency_key,
                request_hash,
            )
            if replay:
                return replay
            assert claim_owner is not None
            try:
                compiled = compile_graph(
                    request,
                    runtime_implementation_fingerprint=_runtime_implementation_fingerprint(),
                )
            except Exception:
                self.store.release_idempotency(
                    "compile",
                    request.scenario_id,
                    request.idempotency_key,
                    claim_owner,
                )
                raise
            existing = self.store.artifact_by_candidate(compiled["candidate_hash"])
            created_at = existing["created_at"] if existing else canonical_timestamp()
            artifact_id = existing["artifact_id"] if existing else str(uuid4())
            response = {
                "schema_version": "assurance.compile_result.v1",
                "artifact_id": artifact_id,
                "scenario_id": request.scenario_id,
                "status": "compiled",
                "source_graph_hash": compiled["source_graph_hash"],
                "candidate_hash": compiled["candidate_hash"],
                "normalized_semantic_graph": compiled["normalized_semantic_graph"],
                "compiled_plan": compiled["compiled_plan"],
                "node_to_plan_steps": compiled["node_to_plan_steps"],
                "edge_to_plan_transitions": compiled["edge_to_plan_transitions"],
                "resolved_assurance": compiled["resolved_assurance"],
                "registry_digests": compiled["registry_digests"],
                "issues": [],
                "warnings": compiled["warnings"],
                "created_at": created_at,
            }
            response = CompileResponse.model_validate(response).model_dump(mode="json")
            artifact = {
                **response,
                "source_graph": request.graph.model_dump(mode="json"),
                "execution_policy": request.execution_policy.model_dump(mode="json"),
                "adapter_version": ADAPTER_VERSION,
                "compiler_version": COMPILER_VERSION,
            }
            self.store.save_compile(
                artifact=artifact,
                idempotency_key=request.idempotency_key,
                request_hash=request_hash,
                response=response,
                claim_owner=claim_owner,
            )
            return response

    def run(self, request: RunRequest) -> dict[str, Any]:
        request_hash = canonical_hash(request.model_dump(mode="json"))
        with self.lock:
            replay, claim_owner = self._claim(
                "run",
                request.artifact_id,
                request.idempotency_key,
                request_hash,
            )
            if replay:
                return replay
            assert claim_owner is not None
            try:
                artifact = self.store.artifact(request.artifact_id)
                if artifact is None:
                    raise ArtifactNotFound(request.artifact_id)
                if artifact["candidate_hash"] != request.candidate_hash:
                    raise CandidateConflict(
                        "The candidate hash does not match the persisted artifact."
                    )
                current_digests = _runtime_registry_digests(artifact["scenario_id"])
                if any(artifact[key] != value for key, value in current_digests.items()):
                    raise CandidateConflict(
                        "The executable registry changed after compilation; recompile the graph."
                    )
                if request.input.kind != artifact["scenario_id"]:
                    raise RunInputConflict("Run input kind must equal the artifact scenario.")
                response = self._execute(
                    artifact,
                    request.input.model_dump(mode="json"),
                    request.deterministic_seed,
                )
            except Exception:
                self.store.release_idempotency(
                    "run",
                    request.artifact_id,
                    request.idempotency_key,
                    claim_owner,
                )
                raise
            self.store.save_run(
                response,
                request_hash,
                request.input.model_dump(mode="json"),
                request.deterministic_seed,
                request.idempotency_key,
                claim_owner,
            )
            return response

    def _execute(
        self, artifact: dict[str, Any], run_input: dict[str, Any], seed: int
    ) -> dict[str, Any]:
        del seed  # The fixture model is deterministic; the persisted seed remains provenance.
        run_id = str(uuid4())
        created_at = canonical_timestamp()
        log = EventLog(run_id, artifact["candidate_hash"])
        log.add("run_started", payload={"artifact_id": artifact["artifact_id"]})
        plan = artifact["compiled_plan"]
        steps = {step["canvas_node_id"]: step for step in plan["steps"]}
        transitions_by_source: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for transition in plan["transitions"]:
            source = transition["source_step_id"].removeprefix("step:")
            transitions_by_source[source].append(transition)
        queue: deque[tuple[str, Any, str | None]] = deque(
            (step_id.removeprefix("step:"), dict(run_input), None)
            for step_id in plan["entry_step_ids"]
        )
        calls: dict[str, int] = defaultdict(int)
        retries: dict[str, int] = defaultdict(int)
        outer_used = 0
        outer_by_gate: dict[str, int] = defaultdict(int)
        outer_edge_ids: list[str] = []
        gate_rejections: dict[str, list[str]] = defaultdict(list)
        run_state: dict[str, Any] = {"request.input": deepcopy(run_input)}
        checkpoints: dict[str, dict[str, Any]] = {}
        join_buffers: dict[tuple[str, str], dict[str, Any]] = defaultdict(dict)
        joined_inputs_queued: set[tuple[str, str]] = set()
        evidence_failed = False
        executor_failed = False
        recovered = False
        terminal_output: Any = None
        terminal_kind: str | None = None
        terminal_code: str | None = None
        proof_event_ids: list[str] = []
        visits = 0

        while (
            queue
            and terminal_output is None
            and terminal_kind not in {"run_error", "revision_exhausted"}
        ):
            visits += 1
            if visits > 256:
                terminal_kind = "run_error"
                terminal_code = "execution_step_limit"
                break
            node_id, payload, incoming_edge = queue.popleft()
            step = steps[node_id]
            node_type = step["node_type"]
            config = step["config"]
            lowerer = lowerer_for(step["lowerer_id"], step["lowerer_version"])
            if (
                lowerer is None
                or lowerer.implementation_fingerprint != step["implementation_fingerprint"]
                or lowerer.operation_id != step["operation_id"]
                or lowerer.operation_version != step["operation_version"]
            ):
                terminal_kind = "run_error"
                terminal_code = "lowerer_registry_mismatch"
                break
            if node_type == "executor" and node_id not in checkpoints:
                checkpoints[node_id] = {
                    "state": deepcopy(run_state),
                    "payload": deepcopy(payload),
                }
            lowered = lowerer.execute(deepcopy(payload), run_input, config)
            log.add(
                "node_started", node_id=node_id, payload={"incoming_canvas_edge_id": incoming_edge}
            )
            selected_handle: str | None = lowered.get("selected_handle")
            outgoing_payload = lowered.get("payload", payload)

            if node_type == "input":
                pass
            elif node_type == "output":
                terminal_output = outgoing_payload
                proof_event_ids.append(
                    log.add("node_completed", node_id=node_id, payload={"terminal": True})[
                        "event_id"
                    ]
                )
                continue
            elif node_type == "tool_rag":
                outgoing_payload = execute_knowledge_retrieval(
                    scenario_id=artifact["scenario_id"],
                    operation_id=step["operation_id"],
                    payload=payload,
                    run_input=run_input,
                    retrieval_mode=config["retrieval_mode"],
                    top_k=config["k_value"],
                )
                selected_handle = "success"
                proof_event_ids.append(
                    log.add(
                        "knowledge_retrieval_completed",
                        node_id=node_id,
                        payload=outgoing_payload,
                    )["event_id"]
                )
            elif node_type == "executor":
                assurance = config.get("assurance")
                if assurance and assurance.get("enabled"):
                    (
                        output,
                        request_calls,
                        retry_count,
                        rejected_count,
                        errors,
                    ) = _structured_executor(
                        scenario_id=artifact["scenario_id"],
                        contract_id=assurance["contract_id"],
                        contract_version=assurance["contract_version"],
                        output_mode=assurance["output_mode"],
                        strict=assurance["strict"],
                        validation_retries=assurance["validation_retries"],
                        payload=(
                            {
                                **payload,
                                "_assurance_operation_id": step["operation_id"],
                            }
                            if isinstance(payload, dict)
                            else {
                                "incoming_payloads": payload,
                                "_assurance_operation_id": step["operation_id"],
                            }
                        ),
                    )
                    calls[node_id] += request_calls
                    retries[node_id] += retry_count
                    for attempt in range(1, rejected_count + 1):
                        rejected = log.add(
                            "executor_output_rejected",
                            attempt=attempt,
                            node_id=node_id,
                            payload={
                                "contract_id": assurance["contract_id"],
                                "errors": errors
                                or [
                                    {
                                        "path": [],
                                        "type": "output_validation_error",
                                        "message": (
                                            "Pydantic AI rejected this structured output attempt."
                                        ),
                                        "input": "[redacted]",
                                    }
                                ],
                            },
                        )
                        gate_rejections[node_id].append(rejected["event_id"])
                        if attempt <= retry_count:
                            log.add(
                                "executor_retry_started",
                                attempt=attempt + 1,
                                node_id=node_id,
                                payload={"validation_retry": attempt},
                            )
                    if output is None:
                        executor_failed = True
                        selected_handle = "failure"
                        outgoing_payload = {"code": "executor_output_exhausted", "errors": errors}
                        log.add("node_failed", node_id=node_id, payload=outgoing_payload)
                    else:
                        selected_handle = "success"
                        outgoing_payload = output
                        proof_event_ids.append(
                            log.add(
                                "executor_output_validated",
                                attempt=max(request_calls, 1),
                                node_id=node_id,
                                payload={
                                    "contract_id": assurance["contract_id"],
                                    "contract_version": assurance["contract_version"],
                                    "output_mode": assurance["output_mode"],
                                    "strict": assurance["strict"],
                                    "request_count": request_calls,
                                    "retry_count": retry_count,
                                    "engine": "pydantic_ai",
                                },
                            )["event_id"]
                        )
                        is_handoff_contract = any(
                            item.contract_id == assurance["contract_id"] and item.kind == "handoff"
                            for item in contracts_for(artifact["scenario_id"])
                        )
                        if (
                            is_handoff_contract
                            and _contains_marker(payload, "handoff-drift")
                            and isinstance(outgoing_payload, dict)
                            and outgoing_payload
                        ):
                            removed_key = next(iter(outgoing_payload))
                            outgoing_payload = dict(outgoing_payload)
                            outgoing_payload.pop(removed_key)
                            log.add(
                                "fixture_mutation_applied",
                                node_id=node_id,
                                payload={
                                    "mutation_id": "post_agent_handoff_drift",
                                    "target_contract_id": assurance["contract_id"],
                                    "removed_path": [removed_key],
                                },
                            )
                        if rejected_count:
                            recovered = True
                        executor_failed = False
                else:
                    calls[node_id] += 1
            elif node_type == "typed_handoff_gate":
                adapter = TypeAdapter(
                    contract_type(
                        artifact["scenario_id"], config["contract_id"], config["contract_version"]
                    )
                )
                try:
                    if config["validation_method"] == "validate_json":
                        validated = adapter.validate_json(
                            canonical_json(payload), strict=config["strict"]
                        )
                    else:
                        validated = adapter.validate_python(payload, strict=config["strict"])
                    outgoing_payload = validated.model_dump(mode="json")
                    selected_handle = "pass"
                    proof_event_ids.append(
                        log.add(
                            "handoff_validated",
                            node_id=node_id,
                            payload={
                                "contract_id": config["contract_id"],
                                "contract_version": config["contract_version"],
                                "method": config["validation_method"],
                            },
                        )["event_id"]
                    )
                    if gate_rejections[node_id]:
                        recovered = True
                except ValidationError as exc:
                    errors = _redacted_errors(exc)
                    rejected = log.add(
                        "handoff_rejected",
                        node_id=node_id,
                        payload={
                            "contract_id": config["contract_id"],
                            "contract_version": config["contract_version"],
                            "method": config["validation_method"],
                            "errors": errors,
                        },
                    )
                    gate_rejections[node_id].append(rejected["event_id"])
                    selected_handle = "rejected"
                    outgoing_payload = {
                        "rejected_payload": "[redacted]",
                        "validation_errors": errors,
                    }
                    if config["reject_behavior"] == "stop":
                        terminal_kind = "contract_violation"
                        terminal_output = outgoing_payload
                        continue
                    if config["reject_behavior"] == "request_revision":
                        retry_edges = [
                            item
                            for item in transitions_by_source[node_id]
                            if item["source_handle"] == "rejected" and item["kind"] == "retry"
                        ]
                        budget = artifact["execution_policy"]["max_outer_revisions"]
                        if outer_used >= budget:
                            terminal_kind = "revision_exhausted"
                            terminal_output = outgoing_payload
                            continue
                        outer_used += 1
                        outer_by_gate[node_id] += 1
                        edge_id = retry_edges[0]["canvas_edge_id"] if retry_edges else None
                        if edge_id:
                            outer_edge_ids.append(edge_id)
                        log.add(
                            "outer_revision_started",
                            attempt=outer_used,
                            node_id=node_id,
                            edge_id=edge_id,
                            payload={
                                "cleared_state_keys": (
                                    retry_edges[0].get("cleared_state_keys", [])
                                    if retry_edges
                                    else []
                                ),
                                "replacement_state_key": (
                                    retry_edges[0].get("replacement_state_key")
                                    if retry_edges
                                    else None
                                ),
                                "must_revisit_step_id": (
                                    retry_edges[0].get("must_revisit_step_id")
                                    if retry_edges
                                    else None
                                ),
                                "revision_feedback": errors,
                            },
                        )
            elif node_type == "evidence_check":
                log.add(
                    "evidence_check_started",
                    node_id=node_id,
                    payload={"check_ids": config["check_ids"]},
                )
                results = []
                for check_id in config["check_ids"]:
                    score, decision, method, implementation_fingerprint = check_decision(
                        artifact["scenario_id"],
                        check_id,
                        "1.0.0",
                        payload,
                        run_input,
                    )
                    result = {
                        "check_id": check_id,
                        "version": "1.0.0",
                        "score": score,
                        "decision": decision,
                        "weight": config["check_weights"].get(check_id),
                        "engine": "deterministic",
                        "method": method,
                        "implementation_fingerprint": implementation_fingerprint,
                        "evidence_refs": [f"run:{run_id}", f"node:{node_id}"],
                    }
                    results.append(result)
                    proof_event_ids.append(
                        log.add("evidence_check_result", node_id=node_id, payload=result)[
                            "event_id"
                        ]
                    )
                aggregate_score, decision, equation = _aggregate_checks(config, results)
                outgoing_payload = {
                    "payload": payload,
                    "checks": results,
                    "aggregate": {
                        "aggregation": config["aggregation"],
                        "equation": equation,
                        "score": aggregate_score,
                        "decision": decision,
                    },
                }
                selected_handle = "pass" if decision else "failed"
                if not decision:
                    evidence_failed = True
                    if config["failure_behavior"] == "stop":
                        terminal_kind = "evidence_failed"
                        terminal_output = outgoing_payload
                        continue
            else:
                # Ordinary operations already executed through their immutable exact
                # lowerer above; no node-type fallback dispatch is permitted here.
                pass

            for state_key in step["state_writes"]:
                if node_type == "output" or state_key.endswith(f".{selected_handle}"):
                    if step["state_reducers"].get(state_key) == "ordered_list":
                        current = run_state.setdefault(state_key, [])
                        current.append(deepcopy(outgoing_payload))
                    else:
                        run_state[state_key] = deepcopy(outgoing_payload)

            if node_type not in {"output", "evidence_check"} or terminal_output is None:
                log.add(
                    "node_completed", node_id=node_id, payload={"selected_handle": selected_handle}
                )
            matching = sorted(
                [
                    item
                    for item in transitions_by_source[node_id]
                    if item["source_handle"] == selected_handle
                ],
                key=lambda item: item["canvas_edge_id"],
            )
            if not matching:
                if node_type == "executor" and selected_handle == "failure":
                    terminal_kind = "run_error"
                    terminal_code = "executor_output_exhausted"
                    terminal_output = outgoing_payload
                elif node_type not in {"output"}:
                    terminal_kind = "run_error"
                    terminal_code = "missing_compiled_transition"
                    terminal_output = outgoing_payload
                continue
            if matching[0].get("fan_out") == "exclusive":
                matching = matching[:1]
            for transition in matching:
                log.add(
                    "edge_traversed",
                    edge_id=transition["canvas_edge_id"],
                    payload={
                        "source_handle": selected_handle,
                        "target_handle": transition["target_handle"],
                        "kind": transition["kind"],
                    },
                )
                target = transition["target_step_id"].removeprefix("step:")
                if transition["kind"] == "retry":
                    checkpoint = checkpoints[target]
                    run_state = deepcopy(checkpoint["state"])
                    for state_key in transition.get("cleared_state_keys", []):
                        run_state.pop(state_key, None)
                    cleared_nodes = set(transition.get("cleared_canvas_node_ids", [])) - {target}
                    queue = deque(item for item in queue if item[0] not in cleared_nodes)
                    for join_key in list(join_buffers):
                        if join_key[0] in cleared_nodes:
                            join_buffers.pop(join_key, None)
                            joined_inputs_queued.discard(join_key)
                    checkpoint_payload = deepcopy(checkpoint["payload"])
                    retry_payload = {
                        **(
                            checkpoint_payload
                            if isinstance(checkpoint_payload, dict)
                            else {"incoming_payloads": checkpoint_payload}
                        ),
                        "_assurance_revision_feedback": outgoing_payload.get(
                            "validation_errors", []
                        ),
                    }
                else:
                    retry_payload = outgoing_payload
                target_handle = transition["target_handle"]
                target_step = steps[target]
                bindings = target_step["config"].get("_compiled_input_bindings", [])
                binding = next(
                    (item for item in bindings if item.get("source_port") == target_handle),
                    None,
                )
                if transition["kind"] != "retry" and binding:
                    state_key = binding["target_state_key"]
                    if binding["source"] == "incoming.payloads":
                        join_key = (target, target_handle)
                        requirements = (
                            target_step["config"]
                            .get("_compiled_required_input_edges", {})
                            .get(target_handle, [])
                        )
                        join_buffers[join_key][transition["canvas_edge_id"]] = deepcopy(
                            retry_payload
                        )
                        if join_key in joined_inputs_queued or not all(
                            edge_id in join_buffers[join_key] for edge_id in requirements
                        ):
                            continue
                        retry_payload = [
                            deepcopy(join_buffers[join_key][edge_id])
                            for edge_id in sorted(requirements)
                        ]
                        joined_inputs_queued.add(join_key)
                        run_state[state_key] = deepcopy(retry_payload)
                    else:
                        run_state[state_key] = deepcopy(retry_payload)
                queue.append((target, retry_payload, transition["canvas_edge_id"]))

        if terminal_kind is None:
            if evidence_failed:
                terminal_kind = "evidence_failed"
            elif recovered:
                terminal_kind = "recovered"
            elif executor_failed or any(gate_rejections.values()):
                terminal_kind = "contract_violation"
            elif terminal_output is None:
                terminal_kind = "run_error"
                terminal_code = terminal_code or "no_terminal_output"
            else:
                terminal_kind = "clean"
        terminal_result = {
            "kind": terminal_kind,
            "output": terminal_output,
            "code": terminal_code,
            "proof_event_ids": proof_event_ids,
            "recovered_from_event_ids": [
                event_id for values in gate_rejections.values() for event_id in values
            ]
            if terminal_kind == "recovered"
            else [],
        }
        log.add("run_finished", payload={"terminal_kind": terminal_kind, "code": terminal_code})
        finished_at = canonical_timestamp()
        response = {
            "schema_version": "assurance.run_result.v1",
            "run_id": run_id,
            "artifact_id": artifact["artifact_id"],
            "candidate_hash": artifact["candidate_hash"],
            "status": "completed",
            "terminal_result": terminal_result,
            "events": log.events,
            "internal_executor_calls": dict(calls),
            "internal_executor_retries": dict(retries),
            "outer_revisions": {
                "used": outer_used,
                "budget": artifact["execution_policy"]["max_outer_revisions"],
                "by_gate": dict(outer_by_gate),
                "traversed_edge_ids": outer_edge_ids,
            },
            "containment_evidence": {
                "measurement_status": "not_measured",
                "injected_risk_ids": [],
                "contained_risk_ids": [],
                "decision": None,
            },
            "created_at": created_at,
            "finished_at": finished_at,
        }
        return RunResponse.model_validate(response).model_dump(mode="json")

    def eval(self, request: EvalRequest) -> dict[str, Any]:
        request_hash = canonical_hash(request.model_dump(mode="json"))
        # Claim before taking the service execution lock: a same-process duplicate
        # may need to wait while the owner creates linked runs through this service.
        replay, claim_owner = self._claim(
            "eval",
            request.artifact_id,
            request.idempotency_key,
            request_hash,
        )
        if replay:
            return replay
        assert claim_owner is not None
        with self.lock:
            try:
                artifact = self.store.artifact(request.artifact_id)
                if artifact is None:
                    raise ArtifactNotFound(request.artifact_id)
                if artifact["candidate_hash"] != request.candidate_hash:
                    raise CandidateConflict(
                        "The candidate hash does not match the persisted artifact."
                    )
                current_digests = _runtime_registry_digests(artifact["scenario_id"])
                if any(artifact[key] != value for key, value in current_digests.items()):
                    raise CandidateConflict(
                        "The executable registry changed after compilation; recompile the graph."
                    )
                if (
                    request.suite_id != suite_id(artifact["scenario_id"])
                    or request.suite_version != "1.0.0"
                ):
                    raise SuiteNotFound(request.suite_id)
            except Exception:
                self.store.release_idempotency(
                    "eval",
                    request.artifact_id,
                    request.idempotency_key,
                    claim_owner,
                )
                raise
        # Pydantic Evals invokes the case callable on a worker thread. Holding this
        # lock here would deadlock when that callable creates its linked real run.
        try:
            response = self._run_eval_dataset(artifact)
            with self.lock:
                self.store.save_eval(
                    response,
                    request_hash,
                    request.idempotency_key,
                    claim_owner,
                )
                return response
        except Exception:
            with self.lock:
                self.store.release_idempotency(
                    "eval",
                    request.artifact_id,
                    request.idempotency_key,
                    claim_owner,
                )
            raise

    def _run_eval_dataset(self, artifact: dict[str, Any]) -> dict[str, Any]:
        eval_id = str(uuid4())
        created_at = canonical_timestamp()
        scenario_id = artifact["scenario_id"]
        fixture = _eval_fixture(scenario_id, causal=False)
        causal = _eval_fixture(scenario_id, causal=True)

        class EvalOutput(BaseModel):
            run_id: str
            terminal_kind: str
            candidate_hash: str
            passed: bool
            mechanism_observed: bool
            run_finished_last: bool

        class LinkedRunEvaluator(Evaluator[dict[str, Any], EvalOutput, dict[str, Any]]):
            def evaluate(
                self, ctx: EvaluatorContext[dict[str, Any], EvalOutput, dict[str, Any]]
            ) -> dict[str, bool]:
                return {
                    "linked_candidate": ctx.output.candidate_hash == artifact["candidate_hash"],
                    "run_finished_last": ctx.output.run_finished_last,
                    "expected_mechanism_observed": ctx.output.mechanism_observed,
                    "expected_terminal": ctx.output.passed,
                }

            def get_evaluator_version(self) -> str | None:
                return "1.0.0"

        cases = [
            Case(
                name="clean",
                inputs=fixture,
                metadata={"case_version": "1.0.0"},
                evaluators=(LinkedRunEvaluator(),),
            ),
            Case(
                name="causal",
                inputs=causal,
                metadata={"case_version": "1.0.0"},
                evaluators=(LinkedRunEvaluator(),),
            ),
        ]
        dataset = Dataset[dict[str, Any], EvalOutput, dict[str, Any]](
            name=f"{scenario_id}_assurance_v1",
            cases=cases,
        )

        def run_case(case_input: dict[str, Any]) -> EvalOutput:
            run_request = RunRequest(
                schema_version="assurance.run.v1",
                artifact_id=artifact["artifact_id"],
                candidate_hash=artifact["candidate_hash"],
                input=case_input,
                deterministic_seed=0,
                idempotency_key=str(uuid4()),
            )
            run = self.run(run_request)
            causal_case = _contains_marker(case_input, "invalid-output")
            event_types = [event["event_type"] for event in run["events"]]
            if causal_case:
                mechanism_observed = any(
                    event_type
                    in {
                        "executor_output_rejected",
                        "handoff_rejected",
                        "evidence_check_result",
                    }
                    for event_type in event_types
                )
                terminal_expected = run["terminal_result"]["kind"] in {
                    "recovered",
                    "contract_violation",
                    "evidence_failed",
                    "revision_exhausted",
                    "run_error",
                }
            else:
                mechanism_observed = True
                terminal_expected = run["terminal_result"]["kind"] in {
                    "clean",
                    "recovered",
                }
            return EvalOutput(
                run_id=run["run_id"],
                terminal_kind=run["terminal_result"]["kind"],
                candidate_hash=run["candidate_hash"],
                passed=terminal_expected,
                mechanism_observed=mechanism_observed,
                run_finished_last=run["events"][-1]["event_type"] == "run_finished",
            )

        report = dataset.evaluate_sync(
            run_case,
            name=f"{scenario_id}_assurance_linked_runs",
            max_concurrency=1,
            progress=False,
        )
        result_cases = []
        for item in report.cases:
            output = item.output
            passed = (
                isinstance(output, EvalOutput)
                and output.passed
                and output.mechanism_observed
                and output.run_finished_last
            )
            result_cases.append(
                {
                    "case_id": item.name or "unknown",
                    "case_version": "1.0.0",
                    "evaluator_id": "linked-run-integrity",
                    "evaluator_version": "1.0.0",
                    "run_id": output.run_id
                    if isinstance(output, EvalOutput)
                    else "00000000-0000-0000-0000-000000000000",
                    "passed": passed,
                    "result": {
                        "terminal_kind": output.terminal_kind
                        if isinstance(output, EvalOutput)
                        else "run_error",
                        "linked_candidate": isinstance(output, EvalOutput)
                        and output.candidate_hash == artifact["candidate_hash"],
                        "mechanism_observed": isinstance(output, EvalOutput)
                        and output.mechanism_observed,
                        "run_finished_last": isinstance(output, EvalOutput)
                        and output.run_finished_last,
                    },
                }
            )
        passed_count = sum(item["passed"] for item in result_cases)
        finished_at = canonical_timestamp()
        digests = {
            key: artifact[key]
            for key in (
                "capability_registry_digest",
                "lowerer_registry_digest",
                "contract_registry_digest",
                "check_registry_digest",
            )
        }
        cache_key = canonical_hash(
            {
                "candidate_hash": artifact["candidate_hash"],
                **digests,
                "suite_id": suite_id(scenario_id),
                "suite_version": "1.0.0",
                "case_versions": ["clean@1.0.0", "causal@1.0.0"],
                "evaluator_version": "1.0.0",
                "seed": 0,
            }
        )
        response = {
            "schema_version": "assurance.eval_result.v1",
            "eval_id": eval_id,
            "artifact_id": artifact["artifact_id"],
            "candidate_hash": artifact["candidate_hash"],
            "suite_id": suite_id(scenario_id),
            "suite_version": "1.0.0",
            "status": "completed",
            "engine": "pydantic-evals",
            "aggregate": {
                "passed": passed_count,
                "failed": len(result_cases) - passed_count,
                "total": len(result_cases),
            },
            "cases": result_cases,
            "cache_key": cache_key,
            "created_at": created_at,
            "finished_at": finished_at,
        }
        return EvalResponse.model_validate(response).model_dump(mode="json")


def _eval_fixture(scenario_id: str, *, causal: bool) -> dict[str, Any]:
    marker = (
        {
            "threat-analyst": "invented false claim",
            "bloated-swarm": "unauthorized tool",
            "content-machine": "invented citation",
            "due-diligence-engine": "unsupported finding",
            "gold-plater": "extra unauthorized work",
            "mcp-migration": "catalog bloat",
            "ops-center": "policy breach unapproved",
            "safety-net": "partial corrupt payload",
        }[scenario_id]
        + " invalid-output"
        if causal
        else "clean fixture"
    )
    fixtures: dict[str, dict[str, Any]] = {
        "threat-analyst": {
            "kind": scenario_id,
            "indicators": [marker],
            "observed_at": "2026-01-01T00:00:00Z",
            "tenant_id": "tenant-1",
        },
        "bloated-swarm": {
            "kind": scenario_id,
            "query": marker,
            "customer_id": "customer-1",
            "channel": "chat",
        },
        "content-machine": {
            "kind": scenario_id,
            "content_brief": marker,
            "target_audience": "engineers",
            "tone": "clear",
            "format": "blog",
        },
        "due-diligence-engine": {
            "kind": scenario_id,
            "target_company": marker,
            "deal_size_usd": "1",
            "strategic_rationale": "growth",
            "concerns": ["coverage"],
        },
        "gold-plater": {
            "kind": scenario_id,
            "task": marker,
            "constraints": ["stay scoped"],
            "authorization_scope": ["requested task"],
        },
        "mcp-migration": {
            "kind": scenario_id,
            "request": marker,
            "domain_hint": "research",
            "resource_refs": ["resource-1"],
        },
        "ops-center": {
            "kind": scenario_id,
            "alert": marker,
            "affected_systems": ["api"],
            "observed_at": "2026-01-01T00:00:00Z",
            "severity_hint": "routine",
        },
        "safety-net": {
            "kind": scenario_id,
            "request": marker,
            "file_refs": ["file-1"],
            "allow_partial": False,
        },
    }
    return fixtures[scenario_id]
