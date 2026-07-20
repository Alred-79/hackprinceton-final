from reagent_runtime.models import EdgeSpec, NodeSpec, WorkflowSpec
from reagent_runtime.workflows import threat_workflow_spec, validate_workflow


def test_registered_workflows_compile() -> None:
    for variant in ("baseline", "hardened"):
        result = validate_workflow(threat_workflow_spec(variant))
        assert result.valid, result.errors
        assert result.workflow_hash


def test_unbounded_cycle_is_rejected() -> None:
    spec = threat_workflow_spec("baseline").model_copy(deep=True)
    spec.edges.append(EdgeSpec(source="output", target="enricher"))
    result = validate_workflow(spec)
    assert not result.valid
    assert any("Unbounded cycle" in error for error in result.errors)


def test_invalid_join_and_contract_are_rejected() -> None:
    spec = threat_workflow_spec("baseline").model_copy(deep=True)
    spec.edges.append(EdgeSpec(source="input", target="analyst"))
    result = validate_workflow(spec)
    assert not result.valid
    assert any("join_policy" in error for error in result.errors)
    assert any("incompatible contracts" in error for error in result.errors)


def test_conditional_probabilities_must_sum_to_one() -> None:
    spec = WorkflowSpec(
        id="routes",
        version="1",
        nodes=[
            NodeSpec(id="input", kind="input", implementation_key="threat_input"),
            NodeSpec(id="left", kind="output", implementation_key="threat_output"),
            NodeSpec(id="right", kind="output", implementation_key="threat_output"),
        ],
        edges=[
            EdgeSpec(
                source="input",
                target="left",
                kind="conditional",
                fan_out="exclusive",
                route_probability=0.8,
            ),
            EdgeSpec(
                source="input",
                target="right",
                kind="conditional",
                fan_out="exclusive",
                route_probability=0.1,
            ),
        ],
        entry_node_id="input",
        output_node_ids=["left", "right"],
    )
    result = validate_workflow(spec)
    assert not result.valid
    assert any("sum to 1" in error for error in result.errors)


def test_unregistered_implementation_is_rejected() -> None:
    spec = threat_workflow_spec("baseline").model_copy(deep=True)
    spec.nodes[1].implementation_key = "arbitrary_python"
    result = validate_workflow(spec)
    assert not result.valid
    assert any("unregistered implementation" in error for error in result.errors)
