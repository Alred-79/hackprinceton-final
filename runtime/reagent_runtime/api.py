from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .engine import RUNTIME_BUILD_HASH, RuntimeEngine
from .evals import EvalSuite
from .models import (
    CandidateRerunRequest,
    CheckpointForkRequest,
    CreateRunRequest,
    EvalReport,
    EvalRunRequest,
    ResumeRunRequest,
    RunRecord,
    WorkflowSpec,
    WorkflowValidationResponse,
)
from .scenarios.evals import ScenarioEvalSuite
from .scenarios.registry import DEFAULT_FIXTURE_PRESETS, SCENARIO_REGISTRY
from .store import StoreError
from .workflows import CONTRACT_REGISTRY, threat_workflow_spec, validate_workflow

DATA_DIR = Path(os.getenv("REAGENT_DATA_DIR", Path(__file__).parents[1] / ".data"))
engine = RuntimeEngine(DATA_DIR)

app = FastAPI(
    title="ReAgent Runtime API",
    version="0.1.0",
    description=(
        "Fixture-first LangGraph, Pydantic AI, Pydantic Evals, FastMCP, replay, and "
        "server-owned approval runtime."
    ),
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "http://127.0.0.1:8080"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


def _register_assurance_v1() -> None:
    enabled = os.getenv("REAGENT_ASSURANCE_V1", "false").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if not enabled:
        return
    import pydantic_ai

    if getattr(pydantic_ai, "__version__", None) != "2.13.0":
        logging.getLogger(__name__).error(
            "REAGENT_ASSURANCE_V1 requested but pydantic-ai version is %r; "
            "assurance routes require exactly 2.13.0 and were not registered.",
            getattr(pydantic_ai, "__version__", None),
        )
        return
    from .assurance import build_assurance_router

    app.include_router(build_assurance_router(DATA_DIR))


_register_assurance_v1()


@app.get("/api/health")
def health() -> dict[str, str | bool]:
    return {
        "status": "ok",
        "runtime_build_hash": RUNTIME_BUILD_HASH,
        "fixture_mode": True,
        "external_model_requests": False,
    }


@app.get("/api/capabilities")
def capabilities() -> dict[str, object]:
    scenario_runtimes = [
        {
            "scenario_id": "threat-analyst",
            "title": "Threat Analyst",
            "summary": (
                "Trace a schema-valid false attribution through typed agents, then compare "
                "a weak baseline with factuality, citation, and approval containment."
            ),
            "producer_name": "Enricher",
            "consumer_name": "Threat analyst",
            "contracts": {
                "input": "ThreatIndicatorsV1",
                "handoff": "EnrichmentResultV1",
                "output": "ThreatBriefV1",
            },
            "fixture_presets": {
                "false_claim_cascade": (
                    "A structurally valid unsupported attribution crosses agent boundaries."
                )
            },
            "default_fixture_preset": "false_claim_cascade",
            "pydantic_lessons": [
                "Pydantic AI retries a malformed EnrichmentResultV1 inside the agent run.",
                "A TypeAdapter validates the handoff again after the agent returns.",
                "A valid claim schema does not establish factual support or citation support.",
                "Human approval is a server-owned side-effect boundary, not a UI toggle.",
            ],
            "eval_case_count": 8,
        },
        *[
            {
                "scenario_id": definition.scenario_id,
                "title": definition.title,
                "summary": definition.summary,
                "producer_name": definition.producer_name,
                "consumer_name": definition.consumer_name,
                "contracts": {
                    "input": definition.input_model.__name__,
                    "handoff": definition.handoff_model.__name__,
                    "output": definition.output_model.__name__,
                },
                "fixture_presets": definition.fixture_presets,
                "default_fixture_preset": DEFAULT_FIXTURE_PRESETS[definition.scenario_id],
                "pydantic_lessons": list(definition.pydantic_lessons),
                "eval_case_count": len(definition.eval_cases),
            }
            for definition in SCENARIO_REGISTRY.values()
        ],
    ]
    return {
        "executable_scenarios": [
            "threat-analyst",
            *SCENARIO_REGISTRY.keys(),
        ],
        "design_only_scenarios": [],
        "contracts": sorted(CONTRACT_REGISTRY),
        "guarantees": ["contract", "factuality", "citation", "policy", "task_quality"],
        "operations": ["checkpoint_fork", "fixture_replay", "candidate_rerun"],
        "limitations": [
            "Fixture results are deterministic regression evidence, not production reliability.",
            "Live-model execution is optional and disabled until a provider policy is configured.",
            (
                "Production authentication, remote MCP authorization, and distributed "
                "durability are theoretical."
            ),
        ],
        "scenario_runtimes": scenario_runtimes,
    }


@app.get("/api/workflows/{scenario_id}/{variant}", response_model=WorkflowSpec)
def registered_workflow(scenario_id: str, variant: str) -> WorkflowSpec:
    if variant not in {"baseline", "hardened"}:
        raise HTTPException(status_code=404, detail="Unknown workflow variant.")
    if scenario_id == "threat-analyst":
        return threat_workflow_spec(variant)
    definition = SCENARIO_REGISTRY.get(scenario_id)
    if not definition:
        raise HTTPException(
            status_code=404,
            detail=f"Scenario '{scenario_id}' has no registered executable workflow.",
        )
    return definition.workflow_spec(variant)


@app.post("/api/workflows/validate", response_model=WorkflowValidationResponse)
def validate(spec: WorkflowSpec) -> WorkflowValidationResponse:
    return validate_workflow(spec)


@app.post("/api/runs", response_model=RunRecord)
def create_run(request: CreateRunRequest) -> RunRecord:
    try:
        return engine.create_run(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/runs/{run_id}", response_model=RunRecord)
def get_run(run_id: str) -> RunRecord:
    record = engine.store.get_run(run_id)
    if not record:
        raise HTTPException(status_code=404, detail="Run not found.")
    return record


@app.post("/api/runs/{run_id}/resume", response_model=RunRecord)
def resume_run(run_id: str, request: ResumeRunRequest) -> RunRecord:
    try:
        return engine.resume_run(
            run_id,
            approval_id=request.pending_approval_id,
            decision=request.decision,
            idempotency_key=request.idempotency_key,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Run not found.") from exc
    except StoreError as exc:
        raise HTTPException(
            status_code=409, detail={"code": exc.code.value, "message": str(exc)}
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/runs/{run_id}/fixture-replay", response_model=RunRecord)
def fixture_replay(run_id: str) -> RunRecord:
    try:
        return engine.fixture_replay(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Run not found.") from exc


@app.post("/api/runs/{run_id}/checkpoint-fork", response_model=RunRecord)
def checkpoint_fork(run_id: str, request: CheckpointForkRequest) -> RunRecord:
    try:
        return engine.checkpoint_fork(
            run_id,
            request.input_override,
            request.checkpoint_id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Run not found.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/runs/{run_id}/candidate-rerun", response_model=RunRecord)
def candidate_rerun(run_id: str, request: CandidateRerunRequest) -> RunRecord:
    try:
        return engine.candidate_rerun(
            run_id,
            variant=request.variant,
            input_override=request.input_override,
            fault_plan=request.fault_plan,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Run not found.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/evals/run", response_model=EvalReport)
def run_evals(request: EvalRunRequest) -> EvalReport:
    definition = SCENARIO_REGISTRY.get(request.scenario_id)
    if definition:
        known = {case.name for case in definition.eval_cases}
        unknown = set(request.cases or []) - known
        if unknown:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown eval cases: {sorted(unknown)}",
            )
        return ScenarioEvalSuite(engine, definition).run(request.cases)
    if request.scenario_id != "threat-analyst":
        raise HTTPException(status_code=400, detail="No executable eval suite is registered.")
    known = {
        "contract_drift",
        "tool_misuse",
        "context_overflow",
        "handoff_loss",
        "citation_drift",
        "cascading_false_claim",
        "mcp_bloat",
        "hitl_break",
    }
    unknown = set(request.cases or []) - known
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown eval cases: {sorted(unknown)}")
    return EvalSuite(engine).run(request.cases)
