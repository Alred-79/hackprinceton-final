from __future__ import annotations

import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from types import MappingProxyType
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from reagent_runtime.assurance import registry as assurance_registry
from reagent_runtime.assurance import service as assurance_service
from reagent_runtime.assurance.api import build_assurance_router
from reagent_runtime.assurance.compiler import CompileValidationError
from reagent_runtime.assurance.models import CompileRequest, EvalRequest, RunRequest
from reagent_runtime.assurance.persistence import IdempotencyConflict
from reagent_runtime.assurance.registry import (
    CATALOG,
    CHECK_REGISTRY,
    CHECKS_BY_SCENARIO,
    LOWERER_REGISTRY,
    SCENARIOS,
    NodeCapability,
    capabilities_for,
    capability_for,
    check_decision,
    contracts_for,
    registry_digests,
)
from reagent_runtime.assurance.responses import RunResponse
from reagent_runtime.assurance.service import (
    AssuranceService,
    CandidateConflict,
    _eval_fixture,
)
from reagent_runtime.assurance.wire import canonical_json


def _uuid() -> str:
    return str(uuid4())


@pytest.mark.parametrize(
    ("scenario_id", "check_id", "payload", "run_input"),
    [
        (
            "gold-plater",
            "authorization_scope",
            {"unauthorized_work": [], "summary": "requested task completed"},
            {"authorization_scope": ["frontend export button"]},
        ),
        (
            "safety-net",
            "required_fields_present",
            {"fields_present": ["request"], "reason": "fixture fields are complete"},
            {"allow_partial": False, "request": "process incident report"},
        ),
    ],
)
def test_check_markers_ignore_schema_field_names(
    scenario_id: str,
    check_id: str,
    payload: dict,
    run_input: dict,
) -> None:
    score, decision, _, _ = check_decision(
        scenario_id,
        check_id,
        "1.0.0",
        payload,
        run_input,
    )
    assert score == "1"
    assert decision is True


def _node(identifier: str, node_type: str, config: dict, x: float) -> dict:
    return {
        "id": identifier,
        "type": node_type,
        "config": config,
        "position": {"x": x, "y": 0.0},
        "locked": False,
    }


def _edge(
    identifier: str,
    source: str,
    target: str,
    source_handle: str,
    target_handle: str = "in",
    kind: str = "normal",
) -> dict:
    return {
        "id": identifier,
        "source": source,
        "target": target,
        "source_handle": source_handle,
        "target_handle": target_handle,
        "kind": kind,
        "fan_out": None,
        "route_probability": None,
        "max_attempts": None,
    }


def _bound(label: str, operation_id: str) -> dict:
    return {
        "label": label,
        "assurance_operation_id": operation_id,
        "assurance_operation_version": "1.0.0",
    }


def _graph(
    scenario_id: str,
    *,
    executor_contract: str | None = None,
    executor_operation: str | None = None,
    retries: int = 1,
    gate_contract: str | None = None,
    gate_behavior: str = "stop",
    evidence: bool = False,
) -> dict:
    input_op = CATALOG[scenario_id]["input"][0]
    executor_op = executor_operation or CATALOG[scenario_id]["executor"][0]
    output_op = CATALOG[scenario_id]["output"][0]
    executor_capability = capability_for(scenario_id, "executor", executor_op, "1.0.0")
    assert executor_capability is not None
    contract_id = executor_contract or executor_capability.allowed_executor_contracts[0].contract_id
    binding = next(
        (
            item
            for item in executor_capability.allowed_executor_contracts
            if item.contract_id == contract_id
        ),
        None,
    )
    contract_version = binding.contract_version if binding else "1.0.0"
    executor = {
        **_bound("Executor", executor_op),
        "model": "reagent-fixture-v1",
        "system_prompt": "",
        "tools": [],
        "assurance": {
            "enabled": True,
            "contract_id": contract_id,
            "contract_version": contract_version,
            "strict": True,
            "output_mode": "tool",
            "validation_retries": retries,
        },
        "output_schema": None,
    }
    nodes = [
        _node("input", "input", _bound("Input", input_op), 0.0),
        _node("executor", "executor", executor, 100.0),
    ]
    edges = [_edge("edge-input", "input", "executor", "out")]
    previous = "executor"
    previous_handle = "success"
    x = 200.0
    if gate_contract:
        nodes.append(
            _node(
                "gate",
                "typed_handoff_gate",
                {
                    "label": "Typed gate",
                    "contract_id": gate_contract,
                    "contract_version": "1.0.0",
                    "validation_method": "validate_python",
                    "strict": True,
                    "reject_behavior": gate_behavior,
                },
                x,
            )
        )
        edges.append(_edge("edge-gate", previous, "gate", previous_handle))
        previous = "gate"
        previous_handle = "pass"
        x += 100.0
    if evidence:
        nodes.append(
            _node(
                "evidence",
                "evidence_check",
                {
                    "label": "Evidence",
                    "check_ids": list(CHECKS_BY_SCENARIO[scenario_id]),
                    "aggregation": "all",
                    "check_weights": {},
                    "passing_score": None,
                    "failure_behavior": "stop",
                },
                x,
            )
        )
        edges.append(_edge("edge-evidence", previous, "evidence", previous_handle))
        previous = "evidence"
        previous_handle = "pass"
        x += 100.0
    nodes.append(_node("output", "output", _bound("Output", output_op), x))
    edges.append(_edge("edge-output", previous, "output", previous_handle))
    return {"schema_version": "simulator.graph.v1", "nodes": nodes, "edges": edges}


def _graph_for_capability(capability: NodeCapability) -> dict:
    scenario_id = capability.scenario_id
    if capability.node_type in {"input", "output"}:
        return _graph(scenario_id)
    input_op = CATALOG[scenario_id]["input"][0]
    output_op = CATALOG[scenario_id]["output"][0]
    if capability.node_type == "router":
        output_handle = LOWERER_REGISTRY[
            (capability.lowerer_id, capability.lowerer_version)
        ].execute(
            {"payload": "fixture"},
            _eval_fixture(scenario_id, causal=False),
            capability.default_config,
        )["selected_handle"]
    else:
        output_handle = capability.output_ports[0].id
    return {
        "schema_version": "simulator.graph.v1",
        "nodes": [
            _node("input", "input", _bound("Input", input_op), 0.0),
            _node(
                "operation",
                capability.node_type,
                deepcopy(capability.default_config),
                100.0,
            ),
            _node("output", "output", _bound("Output", output_op), 200.0),
        ],
        "edges": [
            _edge("edge-input", "input", "operation", "out"),
            _edge("edge-output", "operation", "output", output_handle),
        ],
    }


def _compile_request(
    scenario_id: str,
    graph: dict,
    *,
    key: str | None = None,
    outer_revisions: int = 0,
) -> CompileRequest:
    return CompileRequest.model_validate(
        {
            "schema_version": "assurance.compile.v1",
            "scenario_id": scenario_id,
            "graph": graph,
            "execution_policy": {"max_outer_revisions": outer_revisions},
            "seed_policy": "fixed",
            "idempotency_key": key or _uuid(),
        }
    )


def _run_request(artifact: dict, run_input: dict, *, key: str | None = None) -> RunRequest:
    return RunRequest.model_validate(
        {
            "schema_version": "assurance.run.v1",
            "artifact_id": artifact["artifact_id"],
            "candidate_hash": artifact["candidate_hash"],
            "input": run_input,
            "deterministic_seed": 0,
            "idempotency_key": key or _uuid(),
        }
    )


@pytest.mark.parametrize(
    ("scenario_id", "contract_id", "expected_fields"),
    [
        (
            "threat-analyst",
            "threat_report",
            {"severity", "indicators", "attack_vector", "recommended_actions", "confidence"},
        ),
        (
            "due-diligence-engine",
            "diligence_report",
            {"financials", "risks", "recommendation", "confidence_level", "evidence_refs"},
        ),
        (
            "ops-center",
            "incident_action",
            {"affected_systems", "root_cause", "mitigation_steps", "status", "requires_approval"},
        ),
    ],
)
def test_richer_output_contracts_are_additive_versioned_models(
    scenario_id: str,
    contract_id: str,
    expected_fields: set[str],
) -> None:
    records = [item for item in contracts_for(scenario_id) if item.contract_id == contract_id]
    assert [item.version for item in records] == ["1.0.0", "2.0.0"]
    latest = records[-1]
    assert expected_fields <= set(latest.json_schema["properties"])
    executor_bindings = [
        binding
        for capability in capabilities_for(scenario_id)
        for binding in capability.allowed_executor_contracts
        if binding.contract_id == contract_id
    ]
    assert executor_bindings
    assert {item.contract_version for item in executor_bindings} == {"2.0.0"}


def test_legacy_output_schema_is_ignored_without_changing_candidate_identity() -> None:
    from reagent_runtime.assurance.compiler import compile_graph

    clean_graph = _graph("gold-plater")
    legacy_graph = deepcopy(clean_graph)
    legacy_graph["nodes"][1]["config"]["output_schema"] = '{"type":"object"}'
    clean = compile_graph(_compile_request("gold-plater", clean_graph))
    legacy = compile_graph(_compile_request("gold-plater", legacy_graph))

    assert clean["candidate_hash"] == legacy["candidate_hash"]
    executor = next(
        item
        for item in legacy["normalized_semantic_graph"]["nodes"]
        if item["id"] == "executor"
    )
    assert executor["config"]["output_schema"] is None
    assert {item["code"] for item in legacy["warnings"]} == {"LEGACY_OUTPUT_SCHEMA_IGNORED"}


def test_wire_dtos_reject_coercion_noncanonical_strings_and_extras() -> None:
    graph = _graph("due-diligence-engine")
    payload = {
        "schema_version": "assurance.compile.v1",
        "scenario_id": "due-diligence-engine",
        "graph": graph,
        "execution_policy": {"max_outer_revisions": 0},
        "seed_policy": "fixed",
        "idempotency_key": _uuid(),
    }
    bad = deepcopy(payload)
    bad["extra"] = True
    with pytest.raises(ValidationError):
        CompileRequest.model_validate(bad)
    bad = deepcopy(payload)
    bad["graph"]["nodes"][0]["locked"] = 1
    with pytest.raises(ValidationError):
        CompileRequest.model_validate(bad)
    bad = deepcopy(payload)
    bad["graph"]["edges"][0]["route_probability"] = 0.5
    with pytest.raises(ValidationError):
        CompileRequest.model_validate(bad)

    artifact_id = _uuid()
    request = {
        "schema_version": "assurance.run.v1",
        "artifact_id": artifact_id,
        "candidate_hash": "a" * 64,
        "input": {
            "kind": "due-diligence-engine",
            "target_company": "Acme",
            "deal_size_usd": 1,
            "strategic_rationale": "Growth",
            "concerns": ["Coverage"],
        },
        "deterministic_seed": 0,
        "idempotency_key": _uuid(),
    }
    with pytest.raises(ValidationError):
        RunRequest.model_validate(request)
    request["input"]["deal_size_usd"] = "01"
    with pytest.raises(ValidationError):
        RunRequest.model_validate(request)
    request["input"]["deal_size_usd"] = "1"
    request["artifact_id"] = artifact_id.upper()
    with pytest.raises(ValidationError):
        RunRequest.model_validate(request)


def test_all_eight_registries_are_expanded_and_digest_stable() -> None:
    assert set(SCENARIOS) == set(CATALOG)
    for scenario_id in SCENARIOS:
        records = capabilities_for(scenario_id)
        expected = sum(len(operations) for operations in CATALOG[scenario_id].values())
        assert len(records) == expected
        assert (
            len({(item.node_type, item.operation_id, item.operation_version) for item in records})
            == expected
        )
        executor_records = [item for item in records if item.node_type == "executor"]
        assert executor_records
        for record in executor_records:
            assert len(record.allowed_executor_contracts) == 1
            assert record.allowed_executor_contracts == record.produced_payload_contracts
        assert registry_digests(scenario_id) == registry_digests(scenario_id)


@pytest.mark.parametrize("scenario_id", SCENARIOS)
def test_every_scenario_compiles_and_runs_its_canvas_graph(
    tmp_path: Path, scenario_id: str
) -> None:
    service = AssuranceService(tmp_path / scenario_id)
    artifact = service.compile(_compile_request(scenario_id, _graph(scenario_id)))
    run = service.run(_run_request(artifact, _eval_fixture(scenario_id, causal=False)))
    assert run["terminal_result"]["kind"] == "clean"
    assert run["events"][-1]["event_type"] == "run_finished"
    assert [item["sequence"] for item in run["events"]] == list(range(1, len(run["events"]) + 1))
    assert any(item["canvas_node_id"] == "executor" for item in run["events"])
    assert any(item["canvas_edge_id"] == "edge-output" for item in run["events"])
    validated = next(
        item for item in run["events"] if item["event_type"] == "executor_output_validated"
    )
    assert validated["payload"]["engine"] == "pydantic_ai"
    assert validated["payload"]["strict"] is True
    assert validated["payload"]["request_count"] >= 1


def test_position_is_cosmetic_but_semantic_edit_changes_identity(tmp_path: Path) -> None:
    service = AssuranceService(tmp_path)
    graph = _graph("gold-plater")
    first = service.compile(_compile_request("gold-plater", graph))
    moved = deepcopy(graph)
    moved["nodes"][1]["position"] = {"x": 999.0, "y": -50.0}
    second = service.compile(_compile_request("gold-plater", moved))
    assert first["source_graph_hash"] == second["source_graph_hash"]
    assert first["candidate_hash"] == second["candidate_hash"]
    changed = deepcopy(graph)
    changed["nodes"][1]["config"]["system_prompt"] = "A semantic prompt edit"
    third = service.compile(_compile_request("gold-plater", changed))
    assert first["source_graph_hash"] != third["source_graph_hash"]
    assert first["candidate_hash"] != third["candidate_hash"]


def test_executor_handoff_contract_passes_and_mismatched_contract_rejects(
    tmp_path: Path,
) -> None:
    service = AssuranceService(tmp_path)
    valid_graph = _graph(
        "gold-plater",
        executor_contract="scope_handoff",
        gate_contract="scope_handoff",
    )
    valid_artifact = service.compile(_compile_request("gold-plater", valid_graph))
    passed = service.run(_run_request(valid_artifact, _eval_fixture("gold-plater", causal=False)))
    assert passed["terminal_result"]["kind"] == "clean"
    assert "handoff_validated" in [item["event_type"] for item in passed["events"]]

    invalid_graph = _graph(
        "gold-plater",
        executor_contract="implementation_result",
        executor_operation="format_result",
        gate_contract="scope_handoff",
    )
    invalid_artifact = service.compile(_compile_request("gold-plater", invalid_graph))
    rejected = service.run(
        _run_request(invalid_artifact, _eval_fixture("gold-plater", causal=False))
    )
    assert rejected["terminal_result"]["kind"] == "contract_violation"
    rejection = next(
        item for item in rejected["events"] if item["event_type"] == "handoff_rejected"
    )
    assert rejection["canvas_node_id"] == "gate"
    assert rejection["payload"]["errors"]
    assert all(item["input"] == "[redacted]" for item in rejection["payload"]["errors"])


def test_post_agent_handoff_fixture_is_external_and_causally_rejected(tmp_path: Path) -> None:
    service = AssuranceService(tmp_path)
    artifact = service.compile(
        _compile_request(
            "gold-plater",
            _graph(
                "gold-plater",
                executor_contract="scope_handoff",
                gate_contract="scope_handoff",
            ),
        )
    )
    run_input = _eval_fixture("gold-plater", causal=False)
    run_input["task"] = "handoff-drift"
    run = service.run(_run_request(artifact, run_input))
    assert run["terminal_result"]["kind"] == "contract_violation"
    event_types = [item["event_type"] for item in run["events"]]
    assert event_types.index("executor_output_validated") < event_types.index(
        "fixture_mutation_applied"
    ) < event_types.index("handoff_rejected")
    mutation = next(
        item for item in run["events"] if item["event_type"] == "fixture_mutation_applied"
    )
    assert mutation["payload"] == {
        "mutation_id": "post_agent_handoff_drift",
        "target_contract_id": "scope_handoff",
        "removed_path": ["requested_scope"],
    }


def test_internal_output_retry_zero_vs_one_is_real_and_separate_from_requests(
    tmp_path: Path,
) -> None:
    service = AssuranceService(tmp_path)
    run_input = _eval_fixture("gold-plater", causal=True)
    zero_artifact = service.compile(
        _compile_request("gold-plater", _graph("gold-plater", retries=0))
    )
    zero = service.run(_run_request(zero_artifact, run_input))
    assert zero["terminal_result"]["kind"] == "run_error"
    assert zero["internal_executor_calls"] == {"executor": 1}
    assert zero["internal_executor_retries"] == {"executor": 0}
    assert sum(item["event_type"] == "executor_output_rejected" for item in zero["events"]) == 1
    assert not any(item["event_type"] == "executor_retry_started" for item in zero["events"])

    one_artifact = service.compile(
        _compile_request("gold-plater", _graph("gold-plater", retries=1))
    )
    one = service.run(_run_request(one_artifact, run_input))
    assert one["terminal_result"]["kind"] == "recovered"
    assert one["internal_executor_calls"] == {"executor": 2}
    assert one["internal_executor_retries"] == {"executor": 1}
    assert sum(item["event_type"] == "executor_output_rejected" for item in one["events"]) == 1
    assert sum(item["event_type"] == "executor_retry_started" for item in one["events"]) == 1
    validated = next(
        item for item in one["events"] if item["event_type"] == "executor_output_validated"
    )
    assert validated["payload"]["retry_count"] == 1
    assert validated["payload"]["request_count"] == 2


def test_outer_revision_reenters_target_and_revisits_gate(tmp_path: Path) -> None:
    service = AssuranceService(tmp_path)
    graph = _graph(
        "gold-plater",
        executor_contract="scope_handoff",
        gate_contract="scope_handoff",
        gate_behavior="request_revision",
    )
    graph["nodes"][1]["config"]["assurance"] = None
    graph["edges"].append(_edge("edge-retry", "gate", "executor", "rejected", kind="retry"))
    artifact = service.compile(_compile_request("gold-plater", graph, outer_revisions=1))
    retry_transition = next(
        item
        for item in artifact["compiled_plan"]["transitions"]
        if item["canvas_edge_id"] == "edge-retry"
    )
    assert retry_transition["must_revisit_step_id"] == "step:gate"
    assert "node.executor.success" in retry_transition["cleared_state_keys"]
    assert "node.gate.pass" in retry_transition["cleared_state_keys"]
    assert "node.output.terminal" in retry_transition["cleared_state_keys"]
    run_input = _eval_fixture("gold-plater", causal=False)
    run_input["task"] += " gate-invalid-first"
    run = service.run(_run_request(artifact, run_input))
    assert run["terminal_result"]["kind"] == "recovered"
    assert run["outer_revisions"] == {
        "used": 1,
        "budget": 1,
        "by_gate": {"gate": 1},
        "traversed_edge_ids": ["edge-retry"],
    }
    types = [item["event_type"] for item in run["events"]]
    assert types.count("handoff_rejected") == 1
    assert types.count("outer_revision_started") == 1
    assert types.count("handoff_validated") == 1
    assert (
        sum(
            item["event_type"] == "edge_traversed" and item["canvas_edge_id"] == "edge-retry"
            for item in run["events"]
        )
        == 1
    )
    revision = next(
        item for item in run["events"] if item["event_type"] == "outer_revision_started"
    )
    assert revision["payload"]["cleared_state_keys"] == retry_transition["cleared_state_keys"]


@pytest.mark.parametrize("scenario_id", SCENARIOS)
def test_independent_evidence_catches_each_scenario_causal_fixture(
    tmp_path: Path, scenario_id: str
) -> None:
    service = AssuranceService(tmp_path / scenario_id)
    artifact = service.compile(_compile_request(scenario_id, _graph(scenario_id, evidence=True)))
    run = service.run(_run_request(artifact, _eval_fixture(scenario_id, causal=True)))
    assert run["terminal_result"]["kind"] == "evidence_failed"
    decisions = [
        item["payload"]["decision"]
        for item in run["events"]
        if item["event_type"] == "evidence_check_result"
    ]
    assert False in decisions


def test_idempotency_replays_and_conflicts(tmp_path: Path) -> None:
    service = AssuranceService(tmp_path)
    key = _uuid()
    request = _compile_request("gold-plater", _graph("gold-plater"), key=key)
    first = service.compile(request)
    assert service.compile(request) == first
    changed = _graph("gold-plater")
    changed["nodes"][1]["config"]["system_prompt"] = "changed"
    with pytest.raises(IdempotencyConflict):
        service.compile(_compile_request("gold-plater", changed, key=key))

    run_key = _uuid()
    run_request = _run_request(first, _eval_fixture("gold-plater", causal=False), key=run_key)
    run = service.run(run_request)
    assert service.run(run_request) == run


def test_external_eval_links_real_runs_and_concurrent_duplicate_waits(
    tmp_path: Path,
) -> None:
    service = AssuranceService(tmp_path)
    artifact = service.compile(_compile_request("gold-plater", _graph("gold-plater", retries=1)))
    request = EvalRequest.model_validate(
        {
            "schema_version": "assurance.eval.v1",
            "artifact_id": artifact["artifact_id"],
            "candidate_hash": artifact["candidate_hash"],
            "suite_id": "gold-plater-assurance",
            "suite_version": "1.0.0",
            "seed_policy": "fixed",
            "idempotency_key": _uuid(),
        }
    )
    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = list(pool.map(lambda _: service.eval(request), range(2)))
    assert first == second
    assert first["engine"] == "pydantic-evals"
    assert first["aggregate"] == {"passed": 2, "failed": 0, "total": 2}
    assert all(case["run_id"] != first["eval_id"] for case in first["cases"])
    row = service.store.conn.execute(
        "SELECT COUNT(*) FROM assurance_runs WHERE artifact_id=?",
        (artifact["artifact_id"],),
    ).fetchone()
    assert row[0] == 2


@pytest.mark.parametrize("scenario_id", SCENARIOS)
def test_each_scenario_external_eval_links_candidate_runs(tmp_path: Path, scenario_id: str) -> None:
    service = AssuranceService(tmp_path / scenario_id)
    artifact = service.compile(_compile_request(scenario_id, _graph(scenario_id, retries=1)))
    result = service.eval(
        EvalRequest.model_validate(
            {
                "schema_version": "assurance.eval.v1",
                "artifact_id": artifact["artifact_id"],
                "candidate_hash": artifact["candidate_hash"],
                "suite_id": f"{scenario_id}-assurance",
                "suite_version": "1.0.0",
                "seed_policy": "fixed",
                "idempotency_key": _uuid(),
            }
        )
    )
    assert result["engine"] == "pydantic-evals"
    assert result["aggregate"] == {"passed": 2, "failed": 0, "total": 2}
    run_ids = {case["run_id"] for case in result["cases"]}
    assert len(run_ids) == 2
    rows = service.store.conn.execute(
        "SELECT run_id,candidate_hash FROM assurance_runs WHERE artifact_id=?",
        (artifact["artifact_id"],),
    ).fetchall()
    assert {row["run_id"] for row in rows} == run_ids
    assert {row["candidate_hash"] for row in rows} == {artifact["candidate_hash"]}


def test_feature_flag_removes_or_registers_routes(tmp_path: Path) -> None:
    code = (
        "from fastapi.testclient import TestClient;"
        "from reagent_runtime.api import app;"
        "print(TestClient(app).get('/api/assurance/capabilities/gold-plater').status_code)"
    )
    base = {**os.environ, "REAGENT_DATA_DIR": str(tmp_path)}
    disabled = subprocess.run(
        [sys.executable, "-c", code],
        check=True,
        capture_output=True,
        text=True,
        env={**base, "REAGENT_ASSURANCE_V1": "false"},
    )
    enabled = subprocess.run(
        [sys.executable, "-c", code],
        check=True,
        capture_output=True,
        text=True,
        env={**base, "REAGENT_ASSURANCE_V1": "true"},
    )
    assert disabled.stdout.strip() == "404"
    assert enabled.stdout.strip() == "200"


def test_assurance_api_compile_run_eval_round_trip(tmp_path: Path) -> None:
    app = FastAPI()
    app.include_router(build_assurance_router(tmp_path))
    client = TestClient(app)
    capabilities = client.get("/api/assurance/capabilities/gold-plater")
    assert capabilities.status_code == 200
    assert capabilities.json()["supported"] is True

    compile_payload = _compile_request("gold-plater", _graph("gold-plater", retries=1)).model_dump(
        mode="json"
    )
    compiled = client.post("/api/assurance/compile", json=compile_payload)
    assert compiled.status_code == 200
    artifact = compiled.json()
    run_payload = _run_request(artifact, _eval_fixture("gold-plater", causal=True)).model_dump(
        mode="json"
    )
    run = client.post("/api/assurance/runs", json=run_payload)
    assert run.status_code == 200
    assert run.json()["terminal_result"]["kind"] == "recovered"

    eval_payload = EvalRequest.model_validate(
        {
            "schema_version": "assurance.eval.v1",
            "artifact_id": artifact["artifact_id"],
            "candidate_hash": artifact["candidate_hash"],
            "suite_id": "gold-plater-assurance",
            "suite_version": "1.0.0",
            "seed_policy": "fixed",
            "idempotency_key": _uuid(),
        }
    ).model_dump(mode="json")
    evaluated = client.post("/api/assurance/evals", json=eval_payload)
    assert evaluated.status_code == 200
    assert evaluated.json()["engine"] == "pydantic-evals"


def test_every_catalog_operation_default_lowers_and_executes_distinctly(
    tmp_path: Path,
) -> None:
    produced_groups: dict[tuple[str, str], list[str]] = {}
    for scenario_id in SCENARIOS:
        service = AssuranceService(tmp_path / scenario_id)
        for capability in capabilities_for(scenario_id):
            artifact = service.compile(
                _compile_request(
                    scenario_id,
                    _graph_for_capability(capability),
                )
            )
            step = next(
                item
                for item in artifact["compiled_plan"]["steps"]
                if item["operation_id"] == capability.operation_id
            )
            assert step["lowerer_id"] == capability.lowerer_id
            assert step["lowerer_version"] == capability.lowerer_version
            assert (
                step["implementation_fingerprint"]
                == LOWERER_REGISTRY[
                    (capability.lowerer_id, capability.lowerer_version)
                ].implementation_fingerprint
            )
            run = service.run(_run_request(artifact, _eval_fixture(scenario_id, causal=False)))
            assert run["terminal_result"]["kind"] == "clean"

            implementation = LOWERER_REGISTRY[(capability.lowerer_id, capability.lowerer_version)]
            direct = implementation.execute(
                {"payload": "fixture"},
                _eval_fixture(scenario_id, causal=False),
                capability.default_config,
            )
            assert implementation.operation_id == capability.operation_id
            if capability.produced_payload_contracts:
                contract_id = capability.produced_payload_contracts[0].contract_id
                produced_groups.setdefault((scenario_id, contract_id), []).append(
                    canonical_json(direct["payload"])
                )
    for outputs in produced_groups.values():
        assert len(outputs) == len(set(outputs))


@pytest.mark.parametrize(
    ("scenario_id", "node_type", "operation_id", "field", "value", "code"),
    (
        (
            "gold-plater",
            "executor",
            "classify_task",
            "tools",
            ["unregistered-tool"],
            "EXECUTOR_TOOLS_NOT_ALLOWED",
        ),
        (
            "threat-analyst",
            "mcp_server",
            "query_osint",
            "served_tools",
            [],
            "MCP_TOOLS_NOT_ALLOWED",
        ),
        (
            "content-machine",
            "api_call",
            "publish_content",
            "endpoint",
            "unregistered-endpoint",
            "ENDPOINT_NOT_ALLOWED",
        ),
        (
            "safety-net",
            "code_exec",
            "validate_document",
            "validator_id",
            "unregistered-validator",
            "VALIDATOR_NOT_ALLOWED",
        ),
        (
            "bloated-swarm",
            "context_gate",
            "compact_support_handoff",
            "context_gate_mode",
            "full_reset",
            "CONTEXT_MODE_NOT_ALLOWED",
        ),
        (
            "ops-center",
            "router",
            "classify_severity",
            "routes",
            ["routine"],
            "ROUTE_CONFIG_MISMATCH",
        ),
    ),
)
def test_operation_config_constraints_fail_closed(
    scenario_id: str,
    node_type: str,
    operation_id: str,
    field: str,
    value: object,
    code: str,
) -> None:
    capability = capability_for(scenario_id, node_type, operation_id, "1.0.0")
    assert capability is not None
    graph = _graph_for_capability(capability)
    operation_node = next(node for node in graph["nodes"] if node["id"] == "operation")
    operation_node["config"][field] = value
    from reagent_runtime.assurance.compiler import compile_graph

    with pytest.raises(CompileValidationError) as exc_info:
        compile_graph(_compile_request(scenario_id, graph))
    assert code in {issue.code for issue in exc_info.value.issues}


def test_two_gates_share_one_run_wide_revision_budget(tmp_path: Path) -> None:
    service = AssuranceService(tmp_path)
    graph = {
        "schema_version": "simulator.graph.v1",
        "nodes": [
            _node("input", "input", _bound("Input", "ingest_task"), 0.0),
            _node(
                "executor-a",
                "executor",
                {
                    **_bound("Classify", "classify_task"),
                    "model": "reagent-fixture-v1",
                    "system_prompt": "",
                    "tools": [],
                    "assurance": None,
                    "output_schema": None,
                },
                100.0,
            ),
            _node(
                "gate-a",
                "typed_handoff_gate",
                {
                    "label": "Gate A",
                    "contract_id": "scope_handoff",
                    "contract_version": "1.0.0",
                    "validation_method": "validate_python",
                    "strict": True,
                    "reject_behavior": "request_revision",
                },
                200.0,
            ),
            _node(
                "executor-b",
                "executor",
                {
                    **_bound("Analyze", "analyze_task"),
                    "model": "reagent-fixture-v1",
                    "system_prompt": "",
                    "tools": [],
                    "assurance": None,
                    "output_schema": None,
                },
                300.0,
            ),
            _node(
                "gate-b",
                "typed_handoff_gate",
                {
                    "label": "Gate B",
                    "contract_id": "scope_handoff",
                    "contract_version": "1.0.0",
                    "validation_method": "validate_python",
                    "strict": True,
                    "reject_behavior": "request_revision",
                },
                400.0,
            ),
            _node(
                "output",
                "output",
                _bound("Output", "emit_implementation_result"),
                500.0,
            ),
        ],
        "edges": [
            _edge("in-a", "input", "executor-a", "out"),
            _edge("a-gate", "executor-a", "gate-a", "success"),
            _edge("gate-a-b", "gate-a", "executor-b", "pass"),
            _edge("retry-a", "gate-a", "executor-a", "rejected", kind="retry"),
            _edge("b-gate", "executor-b", "gate-b", "success"),
            _edge("gate-b-out", "gate-b", "output", "pass"),
            _edge("retry-b", "gate-b", "executor-b", "rejected", kind="retry"),
        ],
    }
    artifact = service.compile(_compile_request("gold-plater", graph, outer_revisions=1))
    run_input = _eval_fixture("gold-plater", causal=False)
    run_input["task"] += " gate-invalid-first"
    run = service.run(_run_request(artifact, run_input))
    assert run["terminal_result"]["kind"] == "revision_exhausted"
    assert run["outer_revisions"] == {
        "used": 1,
        "budget": 1,
        "by_gate": {"gate-a": 1},
        "traversed_edge_ids": ["retry-a"],
    }
    assert sum(event["event_type"] == "outer_revision_started" for event in run["events"]) == 1
    assert sum(event["event_type"] == "handoff_rejected" for event in run["events"]) == 2


def test_registries_are_frozen_and_fingerprints_change_candidate_and_eval_identity(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with pytest.raises(TypeError):
        LOWERER_REGISTRY[("x", "1.0.0")] = next(iter(LOWERER_REGISTRY.values()))
    with pytest.raises(TypeError):
        CHECK_REGISTRY[("x", "x", "1.0.0")] = next(iter(CHECK_REGISTRY.values()))

    scenario_id = "gold-plater"
    graph = _graph(scenario_id, evidence=True)
    baseline_service = AssuranceService(tmp_path / "baseline")
    baseline = baseline_service.compile(_compile_request(scenario_id, graph))

    capability = capability_for(scenario_id, "executor", "classify_task", "1.0.0")
    assert capability is not None
    lowerer_key = (capability.lowerer_id, capability.lowerer_version)
    original_lowerer = LOWERER_REGISTRY[lowerer_key]

    def alternate_execute(payload: dict, run_input: dict, config: dict) -> dict:
        del run_input, config
        return {"selected_handle": "success", "payload": {"alternate": payload}}

    alternate_lowerers = dict(LOWERER_REGISTRY)
    alternate_lowerers[lowerer_key] = replace(original_lowerer, execute=alternate_execute)
    lowerer_snapshot = MappingProxyType(alternate_lowerers)
    assert (
        registry_digests(scenario_id, lowerer_registry=lowerer_snapshot)["lowerer_registry_digest"]
        != baseline["registry_digests"]["lowerer_registry_digest"]
    )

    check_key = (scenario_id, CHECKS_BY_SCENARIO[scenario_id][0], "1.0.0")
    original_check = CHECK_REGISTRY[check_key]

    def alternate_check(payload: object, run_input: dict) -> tuple[str, bool]:
        del payload, run_input
        return "0", False

    alternate_checks = dict(CHECK_REGISTRY)
    alternate_checks[check_key] = replace(original_check, evaluate=alternate_check)
    check_snapshot = MappingProxyType(alternate_checks)
    assert (
        registry_digests(scenario_id, check_registry=check_snapshot)["check_registry_digest"]
        != baseline["registry_digests"]["check_registry_digest"]
    )

    with monkeypatch.context() as patcher:
        patcher.setattr(assurance_registry, "LOWERER_REGISTRY", lowerer_snapshot)
        changed_service = AssuranceService(tmp_path / "changed-lowerer")
        changed = changed_service.compile(_compile_request(scenario_id, graph))
        assert changed["candidate_hash"] != baseline["candidate_hash"]

    with monkeypatch.context() as patcher:
        patcher.setattr(assurance_registry, "CHECK_REGISTRY", check_snapshot)
        with pytest.raises(CandidateConflict):
            baseline_service.run(
                _run_request(
                    baseline,
                    _eval_fixture(scenario_id, causal=False),
                )
            )
        with pytest.raises(CandidateConflict):
            baseline_service.eval(
                EvalRequest.model_validate(
                    {
                        "schema_version": "assurance.eval.v1",
                        "artifact_id": baseline["artifact_id"],
                        "candidate_hash": baseline["candidate_hash"],
                        "suite_id": "gold-plater-assurance",
                        "suite_version": "1.0.0",
                        "seed_policy": "fixed",
                        "idempotency_key": _uuid(),
                    }
                )
            )
        changed_check_service = AssuranceService(tmp_path / "changed-check")
        changed_check = changed_check_service.compile(_compile_request(scenario_id, graph))
        assert changed_check["candidate_hash"] != baseline["candidate_hash"]
        changed_eval = changed_check_service.eval(
            EvalRequest.model_validate(
                {
                    "schema_version": "assurance.eval.v1",
                    "artifact_id": changed_check["artifact_id"],
                    "candidate_hash": changed_check["candidate_hash"],
                    "suite_id": "gold-plater-assurance",
                    "suite_version": "1.0.0",
                    "seed_policy": "fixed",
                    "idempotency_key": _uuid(),
                }
            )
        )

    baseline_eval = baseline_service.eval(
        EvalRequest.model_validate(
            {
                "schema_version": "assurance.eval.v1",
                "artifact_id": baseline["artifact_id"],
                "candidate_hash": baseline["candidate_hash"],
                "suite_id": "gold-plater-assurance",
                "suite_version": "1.0.0",
                "seed_policy": "fixed",
                "idempotency_key": _uuid(),
            }
        )
    )
    assert changed_eval["cache_key"] != baseline_eval["cache_key"]
    assert (
        baseline_eval["cache_key"]
        == baseline_service.eval(
            EvalRequest.model_validate(
                {
                    "schema_version": "assurance.eval.v1",
                    "artifact_id": baseline["artifact_id"],
                    "candidate_hash": baseline["candidate_hash"],
                    "suite_id": "gold-plater-assurance",
                    "suite_version": "1.0.0",
                    "seed_policy": "fixed",
                    "idempotency_key": _uuid(),
                }
            )
        )["cache_key"]
    )


def test_cross_instance_pending_idempotency_executes_once(tmp_path: Path) -> None:
    first_service = AssuranceService(tmp_path)
    second_service = AssuranceService(tmp_path)
    compile_request = _compile_request("gold-plater", _graph("gold-plater", retries=1), key=_uuid())
    with ThreadPoolExecutor(max_workers=2) as pool:
        compiled = list(
            pool.map(
                lambda service: service.compile(compile_request),
                (first_service, second_service),
            )
        )
    assert compiled[0] == compiled[1]
    artifact = compiled[0]

    run_request = _run_request(artifact, _eval_fixture("gold-plater", causal=False), key=_uuid())
    with ThreadPoolExecutor(max_workers=2) as pool:
        runs = list(
            pool.map(
                lambda service: service.run(run_request),
                (first_service, second_service),
            )
        )
    assert runs[0] == runs[1]

    eval_request = EvalRequest.model_validate(
        {
            "schema_version": "assurance.eval.v1",
            "artifact_id": artifact["artifact_id"],
            "candidate_hash": artifact["candidate_hash"],
            "suite_id": "gold-plater-assurance",
            "suite_version": "1.0.0",
            "seed_policy": "fixed",
            "idempotency_key": _uuid(),
        }
    )
    with ThreadPoolExecutor(max_workers=2) as pool:
        evals = list(
            pool.map(
                lambda service: service.eval(eval_request),
                (first_service, second_service),
            )
        )
    assert evals[0] == evals[1]
    connection = first_service.store.conn
    assert connection.execute("SELECT COUNT(*) FROM assurance_compile_requests").fetchone()[0] == 1
    assert connection.execute("SELECT COUNT(*) FROM assurance_evals").fetchone()[0] == 1
    assert connection.execute("SELECT COUNT(*) FROM assurance_runs").fetchone()[0] == 3


def test_strict_error_and_event_chain_contracts_and_unmeasured_containment(
    tmp_path: Path,
) -> None:
    app = FastAPI()
    app.include_router(build_assurance_router(tmp_path))
    client = TestClient(app)
    malformed = client.post(
        "/api/assurance/compile",
        content="{",
        headers={"content-type": "application/json"},
    )
    assert malformed.status_code == 400
    assert malformed.json()["detail"]["code"] == "MALFORMED_JSON"
    schema_error = client.post("/api/assurance/compile", json={})
    assert schema_error.status_code == 422
    assert schema_error.json()["detail"]["code"] == "REQUEST_SCHEMA_INVALID"

    service = AssuranceService(tmp_path / "run")
    artifact = service.compile(_compile_request("gold-plater", _graph("gold-plater")))
    run = service.run(_run_request(artifact, _eval_fixture("gold-plater", causal=False)))
    assert run["containment_evidence"] == {
        "measurement_status": "not_measured",
        "injected_risk_ids": [],
        "contained_risk_ids": [],
        "decision": None,
    }
    malformed_run = deepcopy(run)
    malformed_run["events"][-1]["sequence"] += 1
    with pytest.raises(ValidationError):
        RunResponse.model_validate(malformed_run)
    malformed_run = deepcopy(run)
    malformed_run["events"][-1]["payload"]["terminal_kind"] = "run_error"
    with pytest.raises(ValidationError):
        RunResponse.model_validate(malformed_run)
    malformed_run = deepcopy(run)
    malformed_run["events"][1]["causation_id"] = None
    with pytest.raises(ValidationError):
        RunResponse.model_validate(malformed_run)
    malformed_run = deepcopy(run)
    malformed_run["events"][0]["correlation_id"] = _uuid()
    with pytest.raises(ValidationError):
        RunResponse.model_validate(malformed_run)


def test_dependency_is_exactly_pinned_and_locked() -> None:
    root = Path(__file__).parents[1]
    pyproject = (root / "pyproject.toml").read_text()
    lock = (root / "uv.lock").read_text()
    assert '"pydantic-ai==2.13.0"' in pyproject
    assert 'name = "pydantic-ai"\nversion = "2.13.0"' in lock


def test_unknown_operation_and_ambiguous_unnamed_executor_edge_fail_closed() -> None:
    graph = _graph("gold-plater")
    graph["nodes"][1]["config"]["assurance_operation_id"] = "not_registered"
    with pytest.raises(CompileValidationError) as exc_info:
        from reagent_runtime.assurance.compiler import compile_graph

        compile_graph(_compile_request("gold-plater", graph))
    assert any(item.code == "UNSUPPORTED_OPERATION" for item in exc_info.value.issues)

    graph = _graph("gold-plater")
    graph["edges"][1]["source_handle"] = None
    with pytest.raises(CompileValidationError) as exc_info:
        from reagent_runtime.assurance.compiler import compile_graph

        compile_graph(_compile_request("gold-plater", graph))
    assert any(item.code == "AMBIGUOUS_EDGE_HANDLE" for item in exc_info.value.issues)


def test_executor_contract_allowlist_rejects_cross_scenario_contract() -> None:
    graph = _graph("gold-plater")
    graph["nodes"][1]["config"]["assurance"]["contract_id"] = "threat_report"
    with pytest.raises(CompileValidationError) as exc_info:
        from reagent_runtime.assurance.compiler import compile_graph

        compile_graph(_compile_request("gold-plater", graph))
    codes = {item.code for item in exc_info.value.issues}
    assert "UNKNOWN_CONTRACT" in codes
    assert "EXECUTOR_CONTRACT_NOT_ALLOWED" in codes


def _gold_join_graph() -> dict:
    def executor_config(label: str, operation_id: str) -> dict:
        return {
            **_bound(label, operation_id),
            "model": "reagent-fixture-v1",
            "system_prompt": "",
            "tools": [],
            "assurance": None,
            "output_schema": None,
        }

    input_to_classify = _edge("edge-input-classify", "input", "classify", "out")
    input_to_classify["fan_out"] = "all"
    input_to_analyze = _edge("edge-input-analyze", "input", "analyze", "out")
    input_to_analyze["fan_out"] = "all"
    return {
        "schema_version": "simulator.graph.v1",
        "nodes": [
            _node("input", "input", _bound("Input", "ingest_task"), 0.0),
            _node("classify", "executor", executor_config("Classify", "classify_task"), 100.0),
            _node("analyze", "executor", executor_config("Analyze", "analyze_task"), 100.0),
            _node("format", "executor", executor_config("Format", "format_result"), 200.0),
            _node(
                "output",
                "output",
                _bound("Output", "emit_implementation_result"),
                300.0,
            ),
        ],
        "edges": [
            input_to_classify,
            input_to_analyze,
            _edge("edge-z-classify-format", "classify", "format", "success"),
            _edge("edge-a-analyze-format", "analyze", "format", "success"),
            _edge("edge-format-output", "format", "output", "success"),
        ],
    }


def test_gold_plater_many_input_join_gathers_by_edge_id_and_fires_once(tmp_path: Path) -> None:
    service = AssuranceService(tmp_path)
    capability = capability_for("gold-plater", "executor", "format_result", "1.0.0")
    assert capability is not None
    assert [item.model_dump(mode="json") for item in capability.input_bindings] == [
        {
            "source": "incoming.payloads",
            "source_port": "in",
            "target_state_key": "incoming.payloads",
            "merge": "ordered_list",
        }
    ]
    artifact = service.compile(_compile_request("gold-plater", _gold_join_graph()))
    format_step = next(
        step for step in artifact["compiled_plan"]["steps"] if step["canvas_node_id"] == "format"
    )
    assert format_step["config"]["_compiled_required_input_edges"] == {
        "in": ["edge-a-analyze-format", "edge-z-classify-format"]
    }

    run = service.run(
        _run_request(artifact, _eval_fixture("gold-plater", causal=False))
    )
    assert run["terminal_result"]["kind"] == "clean"
    assert run["internal_executor_calls"] == {"classify": 1, "analyze": 1, "format": 1}
    assert sum(
        event["event_type"] == "node_started" and event["canvas_node_id"] == "format"
        for event in run["events"]
    ) == 1
    summary = run["terminal_result"]["output"]["summary"]
    assert summary.index("analyze_task") < summary.index("classify_task")


def test_unsupported_join_and_assurance_source_edge_kind_fail_closed() -> None:
    join_graph = _gold_join_graph()
    next(
        edge for edge in join_graph["edges"] if edge["id"] == "edge-z-classify-format"
    )["kind"] = "conditional"
    with pytest.raises(CompileValidationError) as join_error:
        from reagent_runtime.assurance.compiler import compile_graph

        compile_graph(_compile_request("gold-plater", join_graph))
    assert any(
        issue.code == "UNSUPPORTED_JOIN" and issue.node_id == "format"
        for issue in join_error.value.issues
    )

    evidence_graph = _graph("gold-plater", evidence=True)
    evidence_edge = next(
        edge for edge in evidence_graph["edges"] if edge["source"] == "evidence"
    )
    evidence_edge["kind"] = "conditional"
    with pytest.raises(CompileValidationError) as edge_error:
        compile_graph(_compile_request("gold-plater", evidence_graph))
    assert any(
        issue.code == "UNSUPPORTED_EDGE_KIND" and issue.edge_id == evidence_edge["id"]
        for issue in edge_error.value.issues
    )


def test_runtime_helper_and_contract_sample_drift_invalidate_run_eval_and_identity(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    scenario_id = "gold-plater"
    graph = _graph(scenario_id, evidence=True)
    baseline_service = AssuranceService(tmp_path / "baseline")
    baseline = baseline_service.compile(_compile_request(scenario_id, graph))

    def eval_request() -> EvalRequest:
        return EvalRequest.model_validate(
            {
                "schema_version": "assurance.eval.v1",
                "artifact_id": baseline["artifact_id"],
                "candidate_hash": baseline["candidate_hash"],
                "suite_id": "gold-plater-assurance",
                "suite_version": "1.0.0",
                "seed_policy": "fixed",
                "idempotency_key": _uuid(),
            }
        )

    original_structured_executor = assurance_service._structured_executor

    def changed_structured_executor(**kwargs: object) -> object:
        return original_structured_executor(**kwargs)  # type: ignore[arg-type]

    with monkeypatch.context() as patcher:
        patcher.setattr(
            assurance_service,
            "_structured_executor",
            changed_structured_executor,
        )
        changed = AssuranceService(tmp_path / "changed-executor").compile(
            _compile_request(scenario_id, graph)
        )
        assert changed["candidate_hash"] != baseline["candidate_hash"]
        with pytest.raises(CandidateConflict):
            baseline_service.run(
                _run_request(baseline, _eval_fixture(scenario_id, causal=False))
            )
        with pytest.raises(CandidateConflict):
            baseline_service.eval(eval_request())

    original_sample = assurance_registry.contract_sample

    def changed_contract_sample(
        selected_scenario: str, contract_id: str, payload: object
    ) -> dict:
        return original_sample(selected_scenario, contract_id, payload)  # type: ignore[arg-type]

    with monkeypatch.context() as patcher:
        patcher.setattr(assurance_registry, "contract_sample", changed_contract_sample)
        changed = AssuranceService(tmp_path / "changed-sample").compile(
            _compile_request(scenario_id, graph)
        )
        assert changed["candidate_hash"] != baseline["candidate_hash"]
        with pytest.raises(CandidateConflict):
            baseline_service.run(
                _run_request(baseline, _eval_fixture(scenario_id, causal=False))
            )
        with pytest.raises(CandidateConflict):
            baseline_service.eval(eval_request())

    original_execute = AssuranceService._execute

    def changed_execute(
        self: AssuranceService, artifact: dict, run_input: dict, seed: int
    ) -> dict:
        return original_execute(self, artifact, run_input, seed)

    with monkeypatch.context() as patcher:
        patcher.setattr(AssuranceService, "_execute", changed_execute)
        with pytest.raises(CandidateConflict):
            baseline_service.run(
                _run_request(baseline, _eval_fixture(scenario_id, causal=False))
            )
        with pytest.raises(CandidateConflict):
            baseline_service.eval(eval_request())


def test_executor_retry_event_persists_exact_redacted_pydantic_error(tmp_path: Path) -> None:
    service = AssuranceService(tmp_path)
    artifact = service.compile(
        _compile_request("gold-plater", _graph("gold-plater", retries=1))
    )
    run = service.run(
        _run_request(artifact, _eval_fixture("gold-plater", causal=True))
    )
    assert run["terminal_result"]["kind"] == "recovered"
    assert any(
        event["event_type"] == "executor_retry_started" for event in run["events"]
    )
    rejected = next(
        event for event in run["events"] if event["event_type"] == "executor_output_rejected"
    )
    assert rejected["payload"]["errors"] == [
        {
            "path": ["requested_scope"],
            "type": "missing",
            "message": "Field required",
            "input": "[redacted]",
        }
    ]
