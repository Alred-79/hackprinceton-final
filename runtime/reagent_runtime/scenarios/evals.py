from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel
from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from ..models import CreateRunRequest, EvalCaseResult, EvalReport
from .base import ScenarioDefinition

if TYPE_CHECKING:
    from ..engine import RuntimeEngine


class ScenarioEvalInput(BaseModel):
    scenario_id: str
    case_name: str
    version: str
    variant: str
    fixture_preset: str | None


@dataclass
class ScenarioAssertions(
    Evaluator[ScenarioEvalInput, EvalCaseResult, dict[str, Any]]
):
    def evaluate(
        self,
        ctx: EvaluatorContext[ScenarioEvalInput, EvalCaseResult, dict[str, Any]],
    ) -> dict[str, bool]:
        return {
            f"assert_{name}": passed
            for name, passed in ctx.output.assertions.items()
        }

    def get_evaluator_version(self) -> str | None:
        return "1.0"


class ScenarioEvalSuite:
    """Run each scenario's versioned fixtures through the real Pydantic Evals engine."""

    def __init__(self, engine: RuntimeEngine, definition: ScenarioDefinition) -> None:
        self.engine = engine
        self.definition = definition

    def run(self, selected: list[str] | None = None) -> EvalReport:
        eval_cases = [
            item
            for item in self.definition.eval_cases
            if not selected or item.name in selected
        ]
        dataset = Dataset[ScenarioEvalInput, EvalCaseResult, dict[str, Any]](
            name=f"reagent_{self.definition.scenario_id}_evals_v1",
            cases=[
                Case(
                    name=item.name,
                    inputs=ScenarioEvalInput(
                        scenario_id=self.definition.scenario_id,
                        case_name=item.name,
                        version=item.version,
                        variant=item.variant,
                        fixture_preset=item.fixture_preset,
                    ),
                    metadata={
                        "case_version": item.version,
                        "description": item.description,
                    },
                    evaluators=(ScenarioAssertions(),),
                )
                for item in eval_cases
            ],
        )
        pydantic_report = dataset.evaluate_sync(
            self._run_case,
            name=f"reagent_{self.definition.scenario_id}_fixture_experiment",
            max_concurrency=1,
            progress=False,
        )
        results: list[EvalCaseResult] = []
        for report_case in pydantic_report.cases:
            if isinstance(report_case.output, EvalCaseResult):
                results.append(report_case.output)
            else:
                results.append(
                    EvalCaseResult(
                        name=report_case.name or "unknown",
                        version="1.0",
                        passed=False,
                        assertions={"typed_eval_result_returned": False},
                        metrics={},
                        mutation_plan={},
                        evidence=[
                            "Pydantic Evals did not return a typed EvalCaseResult."
                        ],
                    )
                )
        return EvalReport(
            report_id=str(uuid.uuid4()),
            suite_version=f"{self.definition.scenario_id}-evals-v1",
            cases=results,
            passed=sum(result.passed for result in results),
            failed=sum(not result.passed for result in results),
        )

    def _run_case(self, case_input: ScenarioEvalInput) -> EvalCaseResult:
        definition = next(
            item
            for item in self.definition.eval_cases
            if item.name == case_input.case_name
        )
        run = self.engine.create_run(
            CreateRunRequest(
                scenario_id=self.definition.scenario_id,
                variant=definition.variant,
                run_mode="fixture",
                input=self.definition.fixture_input,
                fault_plan=[],
                fixture_preset=definition.fixture_preset,
            )
        )
        assertions = definition.evaluate(run)
        passed = bool(assertions) and all(assertions.values())
        quality_checks = run.outputs.get("quality_checks", [])
        failed_quality = sum(
            not item.get("passed", False)
            for item in quality_checks
            if isinstance(item, dict)
        )
        return EvalCaseResult(
            name=definition.name,
            version=definition.version,
            passed=passed,
            assertions=assertions,
            metrics={
                "runtime_ms": run.metrics.duration_ms if run.metrics else None,
                "model_requests": run.metrics.request_count if run.metrics else 0,
                "pydantic_evidence_items": len(run.pydantic_evidence),
                "failed_quality_checks": failed_quality,
            },
            mutation_plan={
                "fixture_preset": definition.fixture_preset,
                "variant": definition.variant,
                "description": definition.description,
            },
            evidence=[
                f"run_id={run.run_id}",
                (
                    "The case executed through LangGraph, Pydantic AI output contracts, "
                    "edge TypeAdapter validation, and Pydantic Evals assertions."
                ),
            ],
        )

