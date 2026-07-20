from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from pydantic_ai import Agent, DeferredToolRequests, ModelRetry, RunContext, Tool
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from .models import (
    EnrichmentResultV1,
    ModelClaim,
    ThreatAssessmentV1,
    ThreatBriefV1,
)

FALSE_CLAIM = ModelClaim(
    id="claim-state-sponsored",
    statement="The activity is confirmed to be operated by a state-sponsored group.",
    citation_ids=["src-advisory"],
    declared_confidence=0.96,
    declared_status="observed",
)


@dataclass
class AgentDeps:
    run_id: str
    variant: str


@dataclass
class FixtureCounters:
    calls: dict[str, int] = field(default_factory=dict)

    def bump(self, name: str) -> int:
        self.calls[name] = self.calls.get(name, 0) + 1
        return self.calls[name]


class AgentBundle:
    def __init__(
        self, run_id: str, publish_side_effect: Callable[[str, str], dict[str, Any]]
    ) -> None:
        self.run_id = run_id
        self.counters = FixtureCounters()
        self.enricher = Agent(
            FunctionModel(self._enricher_response, model_name="reagent-fixture-enricher-v1"),
            name="Enricher",
            deps_type=AgentDeps,
            output_type=EnrichmentResultV1,
            retries=2,
        )
        self.analyst = Agent(
            FunctionModel(self._analyst_response, model_name="reagent-fixture-analyst-v1"),
            name="Analyst",
            deps_type=AgentDeps,
            output_type=ThreatAssessmentV1,
            retries=2,
        )
        self.reviewer = Agent(
            FunctionModel(self._reviewer_response, model_name="reagent-fixture-reviewer-v1"),
            name="PublisherReviewer",
            deps_type=AgentDeps,
            output_type=ThreatBriefV1,
            retries=2,
        )

        def publish_critical_alert(run_id: str, body: str) -> dict[str, Any]:
            """Publish a critical alert after explicit approval."""
            return publish_side_effect(run_id, body)

        self.publisher = Agent(
            FunctionModel(self._publisher_response, model_name="reagent-fixture-publisher-v1"),
            name="PublisherReviewer",
            deps_type=AgentDeps,
            tools=[Tool(publish_critical_alert, requires_approval=True, sequential=True)],
            output_type=[ThreatBriefV1, DeferredToolRequests],
            retries=2,
        )

        for agent in (self.enricher, self.analyst, self.reviewer, self.publisher):

            @agent.instructions
            def runtime_identity(ctx: RunContext[AgentDeps]) -> str:
                return (
                    f"Runtime-owned run ID: {ctx.deps.run_id}. "
                    f"Workflow variant: {ctx.deps.variant}. Do not invent runtime metadata."
                )

        @self.enricher.output_validator
        def claims_require_citations(output: EnrichmentResultV1) -> EnrichmentResultV1:
            if any(not claim.citation_ids for claim in output.claims):
                raise ModelRetry("Every claim must name at least one source ID.")
            return output

    def _enricher_response(self, messages: list[Any], info: AgentInfo) -> ModelResponse:
        attempt = self.counters.bump("enricher")
        output_tool = info.output_tools[0].name
        if attempt == 1:
            # Deliberately malformed: Pydantic AI rejects the missing required field and retries.
            args: dict[str, Any] = {
                "indicator": "198.51.100.42",
                "source_ids": ["src-telemetry", "src-advisory"],
                "claims": [],
            }
        else:
            args = {
                "indicator": "198.51.100.42",
                "reputation": "malicious",
                "source_ids": ["src-telemetry", "src-advisory"],
                "claims": [FALSE_CLAIM.model_dump(mode="json")],
            }
        return ModelResponse(parts=[ToolCallPart(output_tool, args)])

    def _analyst_response(self, messages: list[Any], info: AgentInfo) -> ModelResponse:
        self.counters.bump("analyst")
        args = {
            "severity": "critical",
            "summary": (
                "Telemetry marks the indicator malicious. The activity is confirmed as "
                "state-sponsored and requires urgent escalation."
            ),
            "source_ids": ["src-telemetry", "src-advisory"],
            "claims": [
                {
                    **FALSE_CLAIM.model_dump(mode="json"),
                    "id": "claim-state-sponsored-amplified",
                    "declared_parent_claim_ids": [FALSE_CLAIM.id],
                    "declared_confidence": 0.99,
                }
            ],
            "rejected_claim_ids": [],
        }
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, args)])

    def _reviewer_response(self, messages: list[Any], info: AgentInfo) -> ModelResponse:
        self.counters.bump("reviewer")
        args = {
            "title": "Critical threat intelligence alert",
            "body": (
                "The indicator is malicious. Independent verification found no evidence for "
                "the state-sponsorship attribution, so that claim was removed."
            ),
            "publish": True,
            "source_ids": ["src-telemetry"],
            "claims": [
                {
                    "id": "claim-indicator-malicious",
                    "statement": "The indicator is malicious.",
                    "citation_ids": ["src-telemetry"],
                    "declared_confidence": 1.0,
                    "declared_status": "observed",
                }
            ],
        }
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, args)])

    def _publisher_response(self, messages: list[Any], info: AgentInfo) -> ModelResponse:
        self.counters.bump("publisher")
        if len(messages) < 3:
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "publish_critical_alert",
                        {
                            "run_id": self.run_id,
                            "body": (
                                "Verified malicious indicator; unsupported attribution removed."
                            ),
                        },
                        tool_call_id="publish-critical-alert-1",
                    )
                ]
            )
        args = {
            "title": "Critical threat intelligence alert",
            "body": "Verified malicious indicator; unsupported attribution removed.",
            "publish": True,
            "source_ids": ["src-telemetry"],
            "claims": [
                {
                    "id": "claim-indicator-malicious",
                    "statement": "The indicator is malicious.",
                    "citation_ids": ["src-telemetry"],
                    "declared_confidence": 1.0,
                    "declared_status": "observed",
                }
            ],
        }
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, args)])


def baseline_brief() -> ThreatBriefV1:
    return ThreatBriefV1(
        title="Critical state-sponsored activity",
        body=(
            "The malicious indicator is confirmed to be operated by a state-sponsored group. "
            "Escalate immediately."
        ),
        publish=True,
        source_ids=["src-telemetry", "src-advisory"],
        claims=[
            ModelClaim(
                **{
                    **FALSE_CLAIM.model_dump(),
                    "id": "claim-state-sponsored-published",
                    "declared_parent_claim_ids": ["claim-state-sponsored-amplified"],
                }
            )
        ],
    )
