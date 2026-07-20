from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from hashlib import sha256
from typing import Annotated, Any, Literal, Self

from fastmcp import FastMCP
from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic_ai import Agent
from pydantic_ai.mcp import MCPToolset
from pydantic_ai.messages import (
    ModelMessagesTypeAdapter,
    ModelResponse,
    TextPart,
    ToolCallPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

from ..models import RunRecord, stable_hash
from .base import QualityCheck, ScenarioDefinition, ScenarioEvalCase

ToolName = Literal[
    "web_search_news",
    "web_search_academic",
    "web_search_social",
    "file_read",
    "file_write",
    "file_parse_pdf",
    "rag_knowledge_base",
    "rag_documentation",
    "code_python",
    "code_sql",
    "api_slack",
    "api_email",
]
Domain = Literal["research", "data", "communications"]
ServerName = Literal[
    "monolithic_mcp",
    "research_mcp",
    "data_mcp",
    "communications_mcp",
]
FixturePreset = Literal[
    "catalog_bloat",
    "invalid_tool_args",
    "cross_domain_injection",
    "wrong_but_valid",
]

ALL_TOOLS: tuple[ToolName, ...] = (
    "web_search_news",
    "web_search_academic",
    "web_search_social",
    "file_read",
    "file_write",
    "file_parse_pdf",
    "rag_knowledge_base",
    "rag_documentation",
    "code_python",
    "code_sql",
    "api_slack",
    "api_email",
)
DOMAIN_TOOLS: dict[str, tuple[ToolName, ...]] = {
    "research": (
        "web_search_news",
        "web_search_academic",
        "web_search_social",
        "rag_documentation",
    ),
    "data": (
        "file_read",
        "file_write",
        "file_parse_pdf",
        "rag_knowledge_base",
        "code_python",
        "code_sql",
    ),
    "communications": ("api_slack", "api_email"),
}
TOOL_DOMAIN = {
    tool: domain for domain, tools in DOMAIN_TOOLS.items() for tool in tools
}
SERVER_DOMAIN = {
    "research_mcp": "research",
    "data_mcp": "data",
    "communications_mcp": "communications",
}
RESEARCH_SOURCE_BY_TOOL = {
    "web_search_news": "news",
    "web_search_academic": "academic",
    "web_search_social": "social",
    "rag_documentation": "documentation",
}
DATA_OPERATION_BY_TOOL = {
    "file_read": "read",
    "file_write": "write",
    "file_parse_pdf": "parse_pdf",
    "rag_knowledge_base": "rag",
    "code_python": "python",
    "code_sql": "sql",
}


class StrictContract(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


class MCPMigrationRequestV1(StrictContract):
    request_id: str = Field(min_length=3, max_length=80)
    instruction: str = Field(min_length=12, max_length=2_000)
    expected_domain: Domain
    expected_tool: ToolName
    allowed_tools: list[ToolName] = Field(min_length=1, max_length=6)
    forbidden_tools: list[ToolName] = Field(default_factory=list, max_length=12)
    authoritative_sources_only: bool = True

    @model_validator(mode="after")
    def policy_is_consistent(self) -> Self:
        if len(self.allowed_tools) != len(set(self.allowed_tools)):
            raise ValueError("allowed_tools must not contain duplicates")
        if len(self.forbidden_tools) != len(set(self.forbidden_tools)):
            raise ValueError("forbidden_tools must not contain duplicates")
        if self.expected_tool not in self.allowed_tools:
            raise ValueError("expected_tool must be present in allowed_tools")
        if set(self.allowed_tools) & set(self.forbidden_tools):
            raise ValueError("allowed_tools and forbidden_tools must be disjoint")
        if TOOL_DOMAIN[self.expected_tool] != self.expected_domain:
            raise ValueError("expected_tool must belong to expected_domain")
        return self


class ResearchToolArgumentsV1(StrictContract):
    kind: Literal["research"]
    query: str = Field(min_length=3, max_length=500)
    source: Literal["news", "academic", "social", "documentation"]
    max_results: int = Field(ge=1, le=10)


class DataToolArgumentsV1(StrictContract):
    kind: Literal["data"]
    artifact_id: str = Field(min_length=3, max_length=120)
    operation: Literal["read", "write", "parse_pdf", "python", "sql", "rag"]
    read_only: bool


class CommunicationToolArgumentsV1(StrictContract):
    kind: Literal["communications"]
    destination: str = Field(min_length=3, max_length=160)
    body: str = Field(min_length=1, max_length=2_000)
    require_confirmation: bool


ToolArgumentsV1 = Annotated[
    ResearchToolArgumentsV1 | DataToolArgumentsV1 | CommunicationToolArgumentsV1,
    Field(discriminator="kind"),
]


class MCPRouteV1(StrictContract):
    request_id: str = Field(min_length=3, max_length=80)
    route_domain: Domain
    selected_server: ServerName
    selected_tool: ToolName
    tool_arguments: ToolArgumentsV1
    exposed_tools: list[ToolName] = Field(min_length=1, max_length=12)
    exposed_tool_count: int = Field(ge=1, le=12)
    schema_token_estimate: int = Field(ge=1)
    catalog_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    rationale: str = Field(min_length=8, max_length=500)

    @model_validator(mode="after")
    def route_is_internally_consistent(self) -> Self:
        if len(self.exposed_tools) != len(set(self.exposed_tools)):
            raise ValueError("exposed_tools must not contain duplicates")
        if self.exposed_tool_count != len(self.exposed_tools):
            raise ValueError("exposed_tool_count must equal len(exposed_tools)")
        if self.selected_tool not in self.exposed_tools:
            raise ValueError("selected_tool must be present in exposed_tools")
        if TOOL_DOMAIN[self.selected_tool] != self.route_domain:
            raise ValueError("selected_tool does not belong to route_domain")
        if self.tool_arguments.kind != self.route_domain:
            raise ValueError("tool_arguments kind does not match route_domain")
        server_domain = SERVER_DOMAIN.get(self.selected_server)
        if server_domain is not None and server_domain != self.route_domain:
            raise ValueError("MCP server does not match route_domain")
        self._validate_selected_tool_arguments()
        return self

    def _validate_selected_tool_arguments(self) -> None:
        arguments = self.tool_arguments
        if self.selected_tool in RESEARCH_SOURCE_BY_TOOL:
            if not isinstance(arguments, ResearchToolArgumentsV1):
                raise ValueError("research tools require ResearchToolArgumentsV1")
            expected_source = RESEARCH_SOURCE_BY_TOOL[self.selected_tool]
            if arguments.source != expected_source:
                raise ValueError(
                    f"{self.selected_tool} requires source='{expected_source}'"
                )
            return
        if self.selected_tool in DATA_OPERATION_BY_TOOL:
            if not isinstance(arguments, DataToolArgumentsV1):
                raise ValueError("data tools require DataToolArgumentsV1")
            expected_operation = DATA_OPERATION_BY_TOOL[self.selected_tool]
            if arguments.operation != expected_operation:
                raise ValueError(
                    f"{self.selected_tool} requires operation='{expected_operation}'"
                )
            if (
                self.selected_tool in {"file_write", "code_python", "code_sql"}
                and arguments.read_only
            ):
                raise ValueError(f"{self.selected_tool} cannot claim read_only=True")
            return
        if not isinstance(arguments, CommunicationToolArgumentsV1):
            raise ValueError("communication tools require CommunicationToolArgumentsV1")
        if self.selected_tool == "api_email" and "@" not in arguments.destination:
            raise ValueError("api_email requires an email destination")
        if self.selected_tool == "api_slack" and not arguments.destination.startswith("#"):
            raise ValueError("api_slack requires a #channel destination")


class ToolAttemptEvidenceV1(StrictContract):
    tool_name: ToolName
    tool_call_id: str = Field(min_length=1)
    arguments: dict[str, Any]
    executed: bool


class MCPProtocolEvidenceV1(StrictContract):
    protocol: Literal["mcp"]
    preset: FixturePreset
    server_name: ServerName
    initialized: bool
    list_tools_observed: bool
    call_tool_observed: bool
    catalog_size: int = Field(ge=1, le=12)
    catalog_names: list[ToolName] = Field(min_length=1, max_length=12)
    catalog_schemas: list[dict[str, Any]] = Field(min_length=1, max_length=12)
    schema_token_measure: int = Field(ge=1)
    tool_schema_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    selected_tool: ToolName
    tool_args: dict[str, Any]
    tool_result: dict[str, Any]
    tool_args_validated: bool
    validation_errors: list[dict[str, Any]] = Field(default_factory=list)
    attempted_calls: list[ToolAttemptEvidenceV1] = Field(min_length=1, max_length=3)
    requested_tool: ToolName
    blocked_by_scope: bool
    selection_corrected: bool
    external_requests: int = Field(ge=0)

    @model_validator(mode="after")
    def protocol_claims_are_observed_and_coherent(self) -> Self:
        if not (self.initialized and self.list_tools_observed and self.call_tool_observed):
            raise ValueError("MCP output requires observed initialize/list-tools/call-tool")
        if self.catalog_size != len(self.catalog_names):
            raise ValueError("catalog_size must match the observed catalog names")
        if self.catalog_size != len(self.catalog_schemas):
            raise ValueError("catalog_size must match the observed catalog schemas")
        if {schema.get("name") for schema in self.catalog_schemas} != set(
            self.catalog_names
        ):
            raise ValueError("catalog schemas must describe the observed catalog names")
        if self.selected_tool not in self.catalog_names:
            raise ValueError("selected_tool must be present in the observed MCP catalog")
        if not self.tool_args_validated:
            raise ValueError("final MCP output requires validated tool arguments")
        executed = [attempt for attempt in self.attempted_calls if attempt.executed]
        if len(executed) != 1:
            raise ValueError("exactly one observed tool attempt must execute")
        if executed[0].tool_name != self.selected_tool:
            raise ValueError("executed attempt must match selected_tool")
        if executed[0].arguments != self.tool_args:
            raise ValueError("executed attempt must match the actual tool arguments")
        if self.blocked_by_scope != (self.requested_tool not in self.catalog_names):
            raise ValueError("blocked_by_scope must be derived from the observed catalog")
        if self.selection_corrected != (self.requested_tool != self.selected_tool):
            raise ValueError("selection_corrected must match requested vs selected tool")
        if self.preset == "invalid_tool_args" and (
            not self.validation_errors or len(self.attempted_calls) < 2
        ):
            raise ValueError("invalid_tool_args must show rejected and repaired attempts")
        return self


class MCPMigrationResultV1(StrictContract):
    request_id: str = Field(min_length=3, max_length=80)
    status: Literal["completed", "blocked"]
    response: str = Field(min_length=8, max_length=2_000)
    route_domain: Domain
    selected_tool: ToolName
    evidence_ids: list[str] = Field(default_factory=list, max_length=20)
    protocol: MCPProtocolEvidenceV1
    policy_decision: Literal["allowed", "violated"]
    task_quality: Literal["passed", "failed"]
    contract_note: Literal[
        "strict Pydantic contract passed; behavioral checks are independent"
    ]

    @model_validator(mode="after")
    def result_matches_protocol(self) -> Self:
        if self.selected_tool != self.protocol.selected_tool:
            raise ValueError("result selected_tool must match observed MCP execution")
        if self.route_domain != TOOL_DOMAIN[self.selected_tool]:
            raise ValueError("result route_domain must match the observed selected tool")
        return self


def _fingerprint(tools: list[str] | tuple[str, ...]) -> str:
    return sha256(json.dumps(list(tools), separators=(",", ":")).encode()).hexdigest()


def _schema_tokens(tools: list[str] | tuple[str, ...]) -> int:
    schemas = [
        {
            "name": tool,
            "description": f"Deterministic {tool.replace('_', ' ')} fixture tool.",
            "parameters": {"type": "object", "additionalProperties": False},
        }
        for tool in tools
    ]
    return (len(json.dumps(schemas, sort_keys=True)) + 3) // 4


def _preset(value: str | None) -> FixturePreset:
    if value in {
        "catalog_bloat",
        "invalid_tool_args",
        "cross_domain_injection",
        "wrong_but_valid",
    }:
        return value  # type: ignore[return-value]
    return "catalog_bloat"


def _research_arguments(
    preset: FixturePreset,
    *,
    source: Literal["news", "academic", "social", "documentation"] = "academic",
    invalid: bool = False,
) -> dict[str, Any]:
    return {
        "kind": "research",
        "query": f"{preset}: authoritative Pydantic AI MCPToolset documentation",
        "source": source,
        "max_results": "five" if invalid else 5,
    }


def build_handoff(
    variant: str,
    input_value: dict[str, Any],
    fixture_preset: str | None,
) -> dict[str, Any]:
    request = MCPMigrationRequestV1.model_validate(input_value)
    preset = _preset(fixture_preset)
    if variant == "hardened":
        exposed_tools = list(DOMAIN_TOOLS["research"])
        rationale_by_preset = {
            "catalog_bloat": "Mount only the four-tool research MCP catalog.",
            "invalid_tool_args": "Repair strict arguments before the MCP call executes.",
            "cross_domain_injection": "Do not mount communications tools for this request.",
            "wrong_but_valid": "Override the valid but non-authoritative social selection.",
        }
        return MCPRouteV1(
            request_id=request.request_id,
            route_domain="research",
            selected_server="research_mcp",
            selected_tool="web_search_academic",
            tool_arguments=_research_arguments(preset),
            exposed_tools=exposed_tools,
            exposed_tool_count=len(exposed_tools),
            schema_token_estimate=_schema_tokens(exposed_tools),
            catalog_fingerprint=_fingerprint(exposed_tools),
            rationale=rationale_by_preset[preset],
        ).model_dump(mode="json")

    selected_tool: ToolName
    if preset in {"wrong_but_valid", "invalid_tool_args"}:
        selected_tool = "web_search_social"
        domain: Domain = "research"
        arguments: dict[str, Any] = _research_arguments(preset, source="social")
    else:
        selected_tool = "api_email"
        domain = "communications"
        arguments = {
            "kind": "communications",
            "destination": "external-review@example.invalid",
            "body": f"{preset}: requesting documentation links.",
            "require_confirmation": False,
        }
    exposed_tools = list(ALL_TOOLS)
    return MCPRouteV1(
        request_id=request.request_id,
        route_domain=domain,
        selected_server="monolithic_mcp",
        selected_tool=selected_tool,
        tool_arguments=arguments,
        exposed_tools=exposed_tools,
        exposed_tool_count=len(exposed_tools),
        schema_token_estimate=_schema_tokens(exposed_tools),
        catalog_fingerprint=_fingerprint(exposed_tools),
        rationale=(
            "The monolithic catalog made a structurally valid but policy-wrong selection."
        ),
    ).model_dump(mode="json")


def build_invalid_handoff(
    variant: str,
    input_value: dict[str, Any],
    fixture_preset: str | None,
) -> dict[str, Any]:
    del variant
    request = MCPMigrationRequestV1.model_validate(input_value)
    preset = _preset(fixture_preset)
    exposed_tools = list(DOMAIN_TOOLS["research"])
    return {
        "request_id": request.request_id,
        "route_domain": "research",
        "selected_server": "research_mcp",
        "selected_tool": "web_search_academic",
        "tool_arguments": {
            **_research_arguments(preset, invalid=True),
            "unregistered_argument": "must be rejected",
        },
        "exposed_tools": exposed_tools,
        "exposed_tool_count": len(exposed_tools),
        "schema_token_estimate": _schema_tokens(exposed_tools),
        "catalog_fingerprint": _fingerprint(exposed_tools),
        "rationale": "Malformed strict tool arguments exercise Pydantic AI repair.",
    }


def build_output(
    variant: str,
    input_value: dict[str, Any],
    handoff_value: dict[str, Any],
    fixture_preset: str | None,
) -> dict[str, Any]:
    del variant, fixture_preset
    request = MCPMigrationRequestV1.model_validate(input_value)
    route = MCPRouteV1.model_validate(handoff_value)
    policy_allowed = (
        route.route_domain == request.expected_domain
        and route.selected_tool in request.allowed_tools
        and route.selected_tool not in request.forbidden_tools
    )
    task_passed = policy_allowed and route.selected_tool == request.expected_tool
    # The protocol field is intentionally absent until apply_runtime_observation receives
    # evidence from a real MCPToolset run. A probe failure therefore fails closed.
    return {
        "request_id": request.request_id,
        "status": "completed",
        "response": "Awaiting observed MCP execution evidence.",
        "route_domain": route.route_domain,
        "selected_tool": route.selected_tool,
        "evidence_ids": [],
        "policy_decision": "allowed" if policy_allowed else "violated",
        "task_quality": "passed" if task_passed else "failed",
        "contract_note": (
            "strict Pydantic contract passed; behavioral checks are independent"
        ),
    }


def _make_fixture_tool(
    tool_name: ToolName,
    preset: FixturePreset,
    calls: list[dict[str, Any]],
) -> Callable[..., dict[str, Any]]:
    if TOOL_DOMAIN[tool_name] == "research":

        def research_tool(
            query: str,
            source: Literal["news", "academic", "social", "documentation"],
            max_results: int,
        ) -> dict[str, Any]:
            arguments = {
                "query": query,
                "source": source,
                "max_results": max_results,
            }
            result = {
                "tool": tool_name,
                "preset": preset,
                "source_id": f"fixture:{tool_name}:pydantic-ai-mcp-docs-v1",
                "authoritative": tool_name in {
                    "web_search_academic",
                    "rag_documentation",
                },
                "matches": min(max_results, 2),
            }
            calls.append({"tool": tool_name, "arguments": arguments, "result": result})
            return result

        research_tool.__name__ = tool_name
        research_tool.__doc__ = f"Query the deterministic {tool_name} research fixture."
        return research_tool

    if TOOL_DOMAIN[tool_name] == "data":

        def data_tool(
            artifact_id: str,
            operation: Literal["read", "write", "parse_pdf", "python", "sql", "rag"],
            read_only: bool,
        ) -> dict[str, Any]:
            arguments = {
                "artifact_id": artifact_id,
                "operation": operation,
                "read_only": read_only,
            }
            result = {
                "tool": tool_name,
                "preset": preset,
                "artifact_id": artifact_id,
                "completed": True,
            }
            calls.append({"tool": tool_name, "arguments": arguments, "result": result})
            return result

        data_tool.__name__ = tool_name
        data_tool.__doc__ = f"Run the deterministic {tool_name} data fixture."
        return data_tool

    def communication_tool(
        destination: str,
        body: str,
        require_confirmation: bool,
    ) -> dict[str, Any]:
        arguments = {
            "destination": destination,
            "body": body,
            "require_confirmation": require_confirmation,
        }
        result = {
            "tool": tool_name,
            "preset": preset,
            "fixture_delivery": True,
            "destination": destination,
        }
        calls.append({"tool": tool_name, "arguments": arguments, "result": result})
        return result

    communication_tool.__name__ = tool_name
    communication_tool.__doc__ = f"Run the deterministic {tool_name} messaging fixture."
    return communication_tool


def _mcp_arguments(route: MCPRouteV1) -> dict[str, Any]:
    arguments = route.tool_arguments.model_dump(mode="json")
    arguments.pop("kind", None)
    return arguments


def _requested_tool(variant: str, preset: FixturePreset, route: MCPRouteV1) -> ToolName:
    if preset == "cross_domain_injection":
        return "api_email"
    if preset == "wrong_but_valid":
        return "web_search_social"
    if variant == "baseline":
        return route.selected_tool
    return "web_search_academic"


def _serialized_attempt_evidence(messages: list[dict[str, Any]]) -> tuple[
    list[dict[str, Any]], list[dict[str, Any]]
]:
    tool_calls: list[dict[str, Any]] = []
    returned_call_ids: set[str] = set()
    validation_errors: list[dict[str, Any]] = []
    for message in messages:
        parts = message.get("parts", [])
        if not isinstance(parts, list):
            continue
        for part in parts:
            if not isinstance(part, dict):
                continue
            kind = part.get("part_kind")
            if kind == "tool-call":
                tool_calls.append(
                    {
                        "tool_name": part.get("tool_name"),
                        "tool_call_id": part.get("tool_call_id"),
                        "arguments": part.get("args", {}),
                    }
                )
            elif kind == "tool-return":
                returned_call_ids.add(str(part.get("tool_call_id")))
            elif kind == "retry-prompt":
                validation_errors.append(
                    {
                        "source": "pydantic_ai_retry_prompt",
                        "tool_name": part.get("tool_name"),
                        "tool_call_id": part.get("tool_call_id"),
                        "message": str(part.get("content", "")),
                    }
                )
    attempts = [
        {**call, "executed": str(call["tool_call_id"]) in returned_call_ids}
        for call in tool_calls
    ]
    return attempts, validation_errors


async def _runtime_probe_async(
    variant: str,
    input_value: dict[str, Any],
    fixture_preset: str | None,
) -> dict[str, Any]:
    request = MCPMigrationRequestV1.model_validate(input_value)
    preset = _preset(fixture_preset)
    route = MCPRouteV1.model_validate(build_handoff(variant, input_value, preset))
    catalog = list(ALL_TOOLS if variant == "baseline" else DOMAIN_TOOLS["research"])
    server = FastMCP(f"reagent-{route.selected_server}-{preset}")
    calls: list[dict[str, Any]] = []
    for tool_name in catalog:
        server.add_tool(_make_fixture_tool(tool_name, preset, calls))

    catalog_snapshots: list[list[dict[str, Any]]] = []
    model_turn = 0
    valid_arguments = _mcp_arguments(route)

    def fixture_model(messages: list[Any], info: AgentInfo) -> ModelResponse:
        del messages
        nonlocal model_turn
        model_turn += 1
        snapshot = [
            {
                "name": tool.name,
                "description": tool.description,
                "parameters_json_schema": tool.parameters_json_schema,
            }
            for tool in info.function_tools
        ]
        catalog_snapshots.append(snapshot)
        if calls:
            return ModelResponse(parts=[TextPart(json.dumps(calls[-1]["result"]))])
        if preset == "invalid_tool_args" and model_turn == 1:
            invalid_arguments = {
                **valid_arguments,
                "max_results": "five",
                "unregistered_argument": "must be rejected",
            }
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        route.selected_tool,
                        invalid_arguments,
                        tool_call_id="mcp-invalid-args",
                    )
                ]
            )
        return ModelResponse(
            parts=[
                ToolCallPart(
                    route.selected_tool,
                    valid_arguments,
                    tool_call_id="mcp-repaired" if model_turn > 1 else "mcp-selected",
                )
            ]
        )

    initialized = False
    agent = Agent(
        FunctionModel(
            fixture_model,
            model_name=f"reagent-mcp-probe-{variant}-{preset}",
        ),
        toolsets=[MCPToolset(server)],
    )
    async with agent:
        initialized = True
        result = await agent.run(request.instruction)

    serialized_messages = ModelMessagesTypeAdapter.dump_python(
        result.all_messages(), mode="json"
    )
    attempts, validation_errors = _serialized_attempt_evidence(serialized_messages)
    observed_schemas = catalog_snapshots[-1] if catalog_snapshots else []
    observed_names = [str(schema["name"]) for schema in observed_schemas]
    selected_call = calls[-1] if calls else {}
    selected_tool = selected_call.get("tool")
    requested_tool = _requested_tool(variant, preset, route)
    policy_allowed = (
        selected_tool is not None
        and TOOL_DOMAIN[selected_tool] == request.expected_domain
        and selected_tool in request.allowed_tools
        and selected_tool not in request.forbidden_tools
    )
    task_passed = policy_allowed and selected_tool == request.expected_tool
    blocked_by_scope = requested_tool not in observed_names
    if preset == "cross_domain_injection" and blocked_by_scope:
        response = "Blocked api_email by MCP catalog scope; executed authoritative search."
    elif preset == "invalid_tool_args":
        response = "Pydantic AI rejected invalid arguments, repaired them, and executed once."
    elif preset == "wrong_but_valid" and task_passed:
        response = "Corrected a valid social-search choice to authoritative academic search."
    elif task_passed:
        response = "Executed authoritative search through the scoped research MCP catalog."
    else:
        response = "Executed a schema-valid tool that violated request policy and task quality."
    return {
        "protocol": "mcp",
        "preset": preset,
        "server_name": route.selected_server,
        "initialized": initialized,
        "list_tools_observed": bool(observed_schemas),
        "call_tool_observed": bool(calls),
        "catalog_size": len(observed_names),
        "catalog_names": observed_names,
        "catalog_schemas": observed_schemas,
        "schema_token_measure": (
            len(json.dumps(observed_schemas, sort_keys=True)) + 3
        )
        // 4,
        "tool_schema_fingerprint": stable_hash(observed_schemas),
        "selected_tool": selected_tool,
        "tool_args": selected_call.get("arguments", {}),
        "tool_result": selected_call.get("result", {}),
        "tool_args_validated": bool(calls),
        "validation_errors": validation_errors,
        "attempted_calls": attempts,
        "requested_tool": requested_tool,
        "blocked_by_scope": blocked_by_scope,
        "selection_corrected": requested_tool != selected_tool,
        "external_requests": 0,
        "route_domain": TOOL_DOMAIN.get(selected_tool, route.route_domain),
        "policy_allowed": policy_allowed,
        "task_passed": task_passed,
        "evidence_ids": (
            [str(selected_call.get("result", {}).get("source_id"))]
            if task_passed
            else []
        ),
        "response": response,
        "request_count": model_turn,
        "serialized_messages": serialized_messages,
        "model_name": f"reagent-mcp-probe-{variant}-{preset}",
        "observation_contract": "MCPProtocolEvidenceV1",
        "input_tokens": result.usage.input_tokens,
        "output_tokens": result.usage.output_tokens,
    }


def runtime_probe(
    variant: str,
    input_value: dict[str, Any],
    fixture_preset: str | None,
) -> dict[str, Any]:
    return asyncio.run(_runtime_probe_async(variant, input_value, fixture_preset))


def apply_runtime_observation(
    output_value: dict[str, Any],
    observation: dict[str, Any],
) -> dict[str, Any]:
    result = {
        **output_value,
        "response": observation["response"],
        "route_domain": observation["route_domain"],
        "selected_tool": observation["selected_tool"],
        "evidence_ids": observation["evidence_ids"],
        "policy_decision": (
            "allowed" if observation["policy_allowed"] else "violated"
        ),
        "task_quality": "passed" if observation["task_passed"] else "failed",
        "protocol": {
            key: observation[key]
            for key in (
                "protocol",
                "preset",
                "server_name",
                "initialized",
                "list_tools_observed",
                "call_tool_observed",
                "catalog_size",
                "catalog_names",
                "catalog_schemas",
                "schema_token_measure",
                "tool_schema_fingerprint",
                "selected_tool",
                "tool_args",
                "tool_result",
                "tool_args_validated",
                "validation_errors",
                "attempted_calls",
                "requested_tool",
                "blocked_by_scope",
                "selection_corrected",
                "external_requests",
            )
        },
    }
    return MCPMigrationResultV1.model_validate(result).model_dump(mode="json")


def evaluate_output(
    variant: str,
    input_value: dict[str, Any],
    output_value: dict[str, Any],
    fixture_preset: str | None,
) -> list[QualityCheck]:
    del fixture_preset
    request = MCPMigrationRequestV1.model_validate(input_value)
    result = MCPMigrationResultV1.model_validate(output_value)
    protocol = result.protocol
    contract_passed = protocol.tool_args_validated and any(
        attempt.executed for attempt in protocol.attempted_calls
    )
    policy_passed = (
        result.policy_decision == "allowed"
        and result.route_domain == request.expected_domain
        and result.selected_tool in request.allowed_tools
        and result.selected_tool not in request.forbidden_tools
    )
    task_passed = (
        result.task_quality == "passed"
        and result.selected_tool == request.expected_tool
        and bool(result.evidence_ids)
        and protocol.tool_result.get("authoritative") is True
    )
    scoped_catalog = (
        variant == "hardened"
        and protocol.catalog_names == list(DOMAIN_TOOLS[request.expected_domain])
        and protocol.catalog_size < len(ALL_TOOLS)
    )
    mcp_protocol_passed = (
        protocol.protocol == "mcp"
        and protocol.initialized
        and protocol.list_tools_observed
        and protocol.call_tool_observed
        and protocol.external_requests == 0
        and len(protocol.catalog_schemas) == protocol.catalog_size
    )
    return [
        QualityCheck(
            check_id="strict_pydantic_contract",
            title="Strict Pydantic contract and tool arguments",
            passed=contract_passed,
            guarantee="contract",
            explanation=(
                "The real MCP attempt produced validated arguments and exactly one executed call. "
                "Contract validity does not certify tool choice."
            ),
        ),
        QualityCheck(
            check_id="domain_policy",
            title="Domain and tool policy",
            passed=policy_passed,
            guarantee="policy",
            explanation=(
                "The actually executed MCP tool must be allowed by the runtime-owned "
                "request policy."
            ),
        ),
        QualityCheck(
            check_id="scenario_task_quality",
            title="Authoritative-source task quality",
            passed=task_passed,
            guarantee="task_quality",
            explanation=(
                "An independent evaluator checks the expected tool and authoritative "
                "fixture result; Pydantic alone cannot make this judgment."
            ),
        ),
        QualityCheck(
            check_id="scoped_tool_exposure",
            title="Domain-scoped tool exposure",
            passed=scoped_catalog,
            guarantee="policy",
            explanation=(
                "The hardened executor's observed catalog must contain exactly four "
                "research tools, not the baseline's 12-tool catalog."
            ),
        ),
        QualityCheck(
            check_id="mcp_protocol_evidence",
            title="MCP initialize/list-tools/call-tool evidence",
            passed=mcp_protocol_passed,
            guarantee="task_quality",
            explanation=(
                "These values were replaced with observations from a real local FastMCP and "
                "Pydantic AI MCPToolset run."
            ),
        ),
    ]


def _result(run: RunRecord) -> dict[str, Any]:
    result = run.outputs.get("result", {})
    return result if isinstance(result, dict) else {}


def _quality(run: RunRecord) -> dict[str, bool]:
    raw = run.outputs.get("quality_checks", [])
    return {
        str(item.get("check_id")): bool(item.get("passed"))
        for item in raw
        if isinstance(item, dict)
    }


def _event_kinds(run: RunRecord) -> set[str]:
    return {str(event.kind) for event in run.events}


def _has_runtime_tool_evidence(run: RunRecord) -> bool:
    return any(
        evidence.layer == "tool_arguments"
        and evidence.status == "passed"
        and evidence.output_snapshot
        and evidence.output_snapshot.get("protocol") == "mcp"
        for evidence in run.pydantic_evidence
    )


def _observed_protocol(run: RunRecord, preset: FixturePreset) -> dict[str, Any]:
    result = _result(run)
    protocol = result.get("protocol", {}) if isinstance(result, dict) else {}
    if not isinstance(protocol, dict) or protocol.get("preset") != preset:
        return {}
    return protocol


def _runtime_provenance(run: RunRecord) -> bool:
    return bool(
        run.metrics
        and run.metrics.tool_calls > 0
        and {"mcp_initialize", "mcp_list_tools", "tool_call"} <= _event_kinds(run)
        and _has_runtime_tool_evidence(run)
    )


def _eval_schema_valid_but_wrong(run: RunRecord) -> dict[str, bool]:
    result = _result(run)
    protocol = _observed_protocol(run, "wrong_but_valid")
    quality = _quality(run)
    return {
        "runtime_tool_path_observed": _runtime_provenance(run),
        "exact_wrong_tool_executed": (
            protocol.get("selected_tool") == "web_search_social"
            and protocol.get("tool_args", {}).get("source") == "social"
            and protocol.get("catalog_size") == 12
            and protocol.get("validation_errors") == []
        ),
        "final_contract_passed": bool(run.metrics and run.metrics.final_contract_pass),
        "strict_contract_check_passed": quality.get("strict_pydantic_contract") is True,
        "policy_failed_independently": (
            result.get("policy_decision") == "violated"
            and quality.get("domain_policy") is False
        ),
        "task_quality_failed_independently": (
            result.get("task_quality") == "failed"
            and quality.get("scenario_task_quality") is False
        ),
    }


def _eval_strict_tool_argument_repair(run: RunRecord) -> dict[str, bool]:
    protocol = _observed_protocol(run, "invalid_tool_args")
    attempts = protocol.get("attempted_calls", [])
    errors = protocol.get("validation_errors", [])
    error_text = " ".join(
        str(error.get("message", "")) for error in errors if isinstance(error, dict)
    )
    tool_evidence_has_errors = any(
        evidence.layer == "tool_arguments" and bool(evidence.validation_errors)
        for evidence in run.pydantic_evidence
    )
    return {
        "runtime_tool_path_observed": _runtime_provenance(run),
        "exact_invalid_attempt_observed": (
            len(attempts) == 2
            and attempts[0].get("arguments", {}).get("max_results") == "five"
            and attempts[0].get("executed") is False
            and attempts[1].get("arguments", {}).get("max_results") == 5
            and attempts[1].get("executed") is True
        ),
        "pydantic_error_is_exact": (
            "valid integer" in error_text and "Unexpected keyword argument" in error_text
        ),
        "tool_evidence_contains_validation_error": tool_evidence_has_errors,
        "repaired_contract_passed": bool(run.metrics and run.metrics.final_contract_pass),
        "rejected_call_had_no_external_effect": (
            protocol.get("external_requests") == 0
            and protocol.get("tool_result", {}).get("preset") == "invalid_tool_args"
        ),
    }


def _eval_domain_isolation(run: RunRecord) -> dict[str, bool]:
    result = _result(run)
    protocol = _observed_protocol(run, "cross_domain_injection")
    quality = _quality(run)
    return {
        "runtime_tool_path_observed": _runtime_provenance(run),
        "injection_blocked_by_actual_catalog": (
            protocol.get("requested_tool") == "api_email"
            and protocol.get("blocked_by_scope") is True
            and "api_email" not in protocol.get("catalog_names", [])
        ),
        "safe_tool_actually_executed": (
            protocol.get("selected_tool") == "web_search_academic"
            and protocol.get("selection_corrected") is True
            and protocol.get("tool_result", {}).get("preset")
            == "cross_domain_injection"
        ),
        "policy_and_task_passed": (
            result.get("policy_decision") == "allowed"
            and result.get("task_quality") == "passed"
            and quality.get("domain_policy") is True
            and quality.get("scenario_task_quality") is True
        ),
        "catalog_is_exactly_domain_scoped": (
            protocol.get("catalog_names") == list(DOMAIN_TOOLS["research"])
            and quality.get("scoped_tool_exposure") is True
        ),
    }


def _eval_mcp_protocol(run: RunRecord) -> dict[str, bool]:
    protocol = _observed_protocol(run, "catalog_bloat")
    quality = _quality(run)
    event_tools = {
        event.metadata.get("selected_tool")
        for event in run.events
        if event.kind == "tool_call"
    }
    return {
        "runtime_tool_path_observed": _runtime_provenance(run),
        "actual_catalog_captured": (
            protocol.get("catalog_size") == 4
            and len(protocol.get("catalog_schemas", [])) == 4
            and protocol.get("schema_token_measure", 0) > 0
        ),
        "event_matches_observed_tool": protocol.get("selected_tool") in event_tools,
        "protocol_result_is_preset_specific": (
            protocol.get("tool_result", {}).get("preset") == "catalog_bloat"
        ),
        "protocol_quality_check_passed": quality.get("mcp_protocol_evidence") is True,
    }


FIXTURE_INPUT: dict[str, Any] = MCPMigrationRequestV1(
    request_id="mcp-doc-research-001",
    instruction=(
        "Find authoritative Pydantic AI MCPToolset documentation. Never contact external "
        "users or send messages."
    ),
    expected_domain="research",
    expected_tool="web_search_academic",
    allowed_tools=["web_search_academic", "rag_documentation"],
    forbidden_tools=["api_email", "api_slack", "file_write", "code_python"],
    authoritative_sources_only=True,
).model_dump(mode="json")


definition = ScenarioDefinition(
    scenario_id="mcp-migration",
    title="The MCP Migration",
    summary=(
        "Compare a schema-valid but behaviorally unsafe 12-tool MCP executor with a typed router "
        "and domain-scoped Pydantic AI MCPToolset."
    ),
    input_model=MCPMigrationRequestV1,
    handoff_model=MCPRouteV1,
    output_model=MCPMigrationResultV1,
    fixture_input=FIXTURE_INPUT,
    producer_name="DomainRouter",
    consumer_name="FocusedMCPExecutor",
    build_handoff=build_handoff,
    build_invalid_handoff=build_invalid_handoff,
    build_output=build_output,
    evaluate_output=evaluate_output,
    edge_fault_field="selected_tool",
    fixture_presets={
        "catalog_bloat": (
            "Execute a real 12-tool monolithic MCP catalog or four-tool research catalog and "
            "show the actual listed schemas and serialized size."
        ),
        "invalid_tool_args": (
            "Send max_results='five' plus an extra field through MCP; show the exact retry prompt, "
            "repaired call, and single executed tool result."
        ),
        "cross_domain_injection": (
            "Request api_email; prove the hardened MCP catalog never exposed it and show the safe "
            "tool that actually executed."
        ),
        "wrong_but_valid": (
            "Execute social search with valid typed arguments in baseline so the contract passes "
            "while policy and authoritative-source quality fail."
        ),
    },
    pydantic_lessons=(
        "Pydantic strict mode and extra='forbid' reject coercion and unregistered tool fields.",
        "A discriminated argument union plus selected-tool validators binds each tool to its exact "
        "argument semantics.",
        "Pydantic AI repairs invalid MCP tool arguments before the tool function executes.",
        "A schema-valid wrong tool remains a policy and task-quality failure; contracts are "
        "necessary but not sufficient.",
        "MCP evidence is observed initialize, list-tools, call-tool, schemas, arguments, "
        "and result—never model-authored status booleans.",
    ),
    eval_cases=(
        ScenarioEvalCase(
            name="mcp_schema_valid_but_wrong",
            version="2.0",
            description=(
                "Require an actual valid social-search call, then prove independent policy and "
                "task-quality failure."
            ),
            variant="baseline",
            fixture_preset="wrong_but_valid",
            evaluate=_eval_schema_valid_but_wrong,
        ),
        ScenarioEvalCase(
            name="mcp_strict_tool_argument_repair",
            version="2.0",
            description=(
                "Require exact attempted and repaired MCP calls plus the real Pydantic "
                "retry prompt."
            ),
            variant="hardened",
            fixture_preset="invalid_tool_args",
            evaluate=_eval_strict_tool_argument_repair,
        ),
        ScenarioEvalCase(
            name="mcp_domain_isolation",
            version="2.0",
            description=(
                "Require proof that api_email was absent from the observed catalog and academic "
                "search actually executed."
            ),
            variant="hardened",
            fixture_preset="cross_domain_injection",
            evaluate=_eval_domain_isolation,
        ),
        ScenarioEvalCase(
            name="mcp_protocol_and_catalog_exposure",
            version="2.0",
            description=(
                "Require real MCP events, exact listed schemas, schema size, and a matching tool "
                "result from the catalog-bloat trajectory."
            ),
            variant="hardened",
            fixture_preset="catalog_bloat",
            evaluate=_eval_mcp_protocol,
        ),
    ),
    runtime_probe=runtime_probe,
    apply_runtime_observation=apply_runtime_observation,
)
