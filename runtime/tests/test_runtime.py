import uuid

import pytest

from reagent_runtime.engine import RuntimeEngine
from reagent_runtime.models import CreateRunRequest, FaultInjection
from reagent_runtime.store import StoreError


@pytest.fixture
def engine(tmp_path):
    return RuntimeEngine(tmp_path)


def test_baseline_executes_real_agents_and_false_claim_escapes(engine: RuntimeEngine) -> None:
    run = engine.create_run(CreateRunRequest(variant="baseline"))
    assert run.terminal_status == "succeeded"
    assert {item.node_id for item in run.agent_invocations} == {"enricher", "analyst"}
    assert any(event.kind == "agent_output_retry" for event in run.events)
    assert run.metrics
    assert run.metrics.propagation_depth == 2
    assert run.metrics.critical_output_escape is True
    assert run.metrics.task_pass is True


def test_edge_contract_rejection_is_separate_from_agent_retry(engine: RuntimeEngine) -> None:
    run = engine.create_run(
        CreateRunRequest(
            variant="baseline",
            fault_plan=[FaultInjection(case="contract_drift", hook="post_output_pre_edge")],
        )
    )
    rejected = [event for event in run.events if event.kind == "edge_contract_rejected"]
    assert len(rejected) == 1
    assert rejected[0].metadata["enforcement_layer"] == "langgraph_edge"
    assert run.metrics and run.metrics.final_contract_pass


def test_hardened_run_pauses_and_approved_side_effect_is_idempotent(
    engine: RuntimeEngine,
) -> None:
    run = engine.create_run(CreateRunRequest(variant="hardened"))
    assert run.terminal_status == "paused"
    approval = run.pending_approvals[0]
    assert approval.checkpoint_id != f"langgraph:{run.run_id}"
    assert engine.store.side_effect_count(run.run_id) == 0

    resumed = engine.resume_run(
        run.run_id,
        approval_id=approval.approval_id,
        decision="approved",
        idempotency_key=f"approve-{uuid.uuid4()}",
    )
    assert resumed.terminal_status == "succeeded"
    assert resumed.metrics and resumed.metrics.containment
    assert not resumed.metrics.critical_output_escape
    assert resumed.metrics.propagation_depth == 1
    assert resumed.metrics.blast_radius == 2
    assert engine.store.side_effect_count(run.run_id) == 1
    assert resumed.pending_approvals[0].status == "consumed"

    with pytest.raises((StoreError, ValueError)):
        engine.resume_run(
            run.run_id,
            approval_id=approval.approval_id,
            decision="approved",
            idempotency_key=f"duplicate-{uuid.uuid4()}",
        )
    assert engine.store.side_effect_count(run.run_id) == 1


def test_denial_prevents_publish(engine: RuntimeEngine) -> None:
    run = engine.create_run(CreateRunRequest(variant="hardened"))
    approval = run.pending_approvals[0]
    denied = engine.resume_run(
        run.run_id,
        approval_id=approval.approval_id,
        decision="denied",
        idempotency_key=f"deny-{uuid.uuid4()}",
    )
    assert denied.terminal_status == "succeeded"
    assert denied.outputs["brief"]["publish"] is False
    assert engine.store.side_effect_count(run.run_id) == 0


def test_checkpoint_fork_reuses_state_and_only_reexecutes_downstream(
    engine: RuntimeEngine,
) -> None:
    source = engine.create_run(CreateRunRequest(variant="hardened"))
    fork = engine.checkpoint_fork(source.run_id, {})
    assert fork.run_id != source.run_id
    assert fork.compared_to_run_id == source.run_id
    assert fork.operation == "checkpoint_fork"
    assert fork.terminal_status == "paused"
    assert [item.node_id for item in fork.agent_invocations] == ["publisher"]
    approval = fork.pending_approvals[0]
    assert approval.arguments["run_id"] == fork.run_id

    resumed = engine.resume_run(
        fork.run_id,
        approval_id=approval.approval_id,
        decision="approved",
        idempotency_key=f"fork-{uuid.uuid4()}",
    )
    assert resumed.terminal_status == "succeeded"
    assert engine.store.side_effect_count(fork.run_id) == 1


def test_candidate_rerun_is_not_labeled_as_replay_or_checkpoint_fork(
    engine: RuntimeEngine,
) -> None:
    source = engine.create_run(CreateRunRequest(variant="baseline"))
    candidate = engine.candidate_rerun(
        source.run_id,
        variant="hardened",
        input_override={},
        fault_plan=None,
    )
    assert candidate.operation == "candidate_rerun"
    assert candidate.compared_to_run_id == source.run_id
    assert candidate.variant == "hardened"
    assert candidate.terminal_status == "paused"


@pytest.mark.parametrize("variant", ["baseline", "hardened"])
def test_fixture_replay_matches_semantic_hash_and_makes_no_external_requests(
    engine: RuntimeEngine, variant: str
) -> None:
    original = engine.create_run(CreateRunRequest(variant=variant))
    if original.terminal_status == "paused":
        approval = original.pending_approvals[0]
        original = engine.resume_run(
            original.run_id,
            approval_id=approval.approval_id,
            decision="approved",
            idempotency_key=f"original-{uuid.uuid4()}",
        )
    replay = engine.fixture_replay(original.run_id)
    assert replay.operation == "fixture_replay"
    assert replay.external_requests == 0
    assert replay.semantic_trace_hash == original.semantic_trace_hash
    assert replay.replay_comparison
    assert replay.replay_comparison["semantic_trace_match"] is True
