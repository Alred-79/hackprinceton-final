from reagent_runtime.engine import RuntimeEngine
from reagent_runtime.evals import EvalSuite


def test_all_failure_mode_cases_pass(tmp_path) -> None:
    report = EvalSuite(RuntimeEngine(tmp_path)).run()
    assert report.engine == "pydantic-evals"
    assert len(report.cases) == 8
    assert report.passed == 8
    assert report.failed == 0
    assert all(case.assertions and all(case.assertions.values()) for case in report.cases)


def test_suite_can_select_one_case(tmp_path) -> None:
    report = EvalSuite(RuntimeEngine(tmp_path)).run(["mcp_bloat"])
    assert [case.name for case in report.cases] == ["mcp_bloat"]
    assert (
        report.cases[0].metrics["tools_100_schema_tokens"]
        > report.cases[0].metrics["tools_5_schema_tokens"]
    )
