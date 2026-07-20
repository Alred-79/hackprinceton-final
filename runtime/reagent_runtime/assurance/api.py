from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute

from .compiler import CompileValidationError
from .models import CompileRequest, EvalRequest, PatchPreviewRequest, RunRequest
from .persistence import IdempotencyConflict
from .responses import CapabilitiesResponse, CompileResponse, EvalResponse, RunResponse
from .service import (
    ArtifactNotFound,
    AssuranceService,
    CandidateConflict,
    RunInputConflict,
    SuiteNotFound,
)


class AssuranceRoute(APIRoute):
    def get_route_handler(self) -> Any:
        original = super().get_route_handler()

        async def stable_validation_handler(request: Request) -> Any:
            try:
                return await original(request)
            except RequestValidationError as exc:
                errors = exc.errors()
                malformed_json = any(error.get("type") == "json_invalid" for error in errors)
                raise HTTPException(
                    status_code=400 if malformed_json else 422,
                    detail={
                        "code": "MALFORMED_JSON" if malformed_json else "REQUEST_SCHEMA_INVALID",
                        "message": "Request JSON is malformed."
                        if malformed_json
                        else "Request failed strict schema validation.",
                        "issues": [
                            {
                                "path": list(error.get("loc", ())),
                                "type": str(error.get("type", "validation_error")),
                                "message": str(error.get("msg", "Invalid value.")),
                            }
                            for error in errors
                        ],
                    },
                ) from exc

        return stable_validation_handler


def build_assurance_router(data_dir: str | Path) -> APIRouter:
    router = APIRouter(
        prefix="/api/assurance",
        tags=["assurance"],
        route_class=AssuranceRoute,
    )
    service = AssuranceService(data_dir)

    @router.get("/capabilities/{scenario_id}", response_model=CapabilitiesResponse)
    def capabilities(scenario_id: str) -> CapabilitiesResponse:
        return CapabilitiesResponse.model_validate(service.capabilities(scenario_id))

    @router.post("/compile", response_model=CompileResponse)
    def compile_current_graph(request: CompileRequest) -> CompileResponse:
        try:
            return CompileResponse.model_validate(service.compile(request))
        except CompileValidationError as exc:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "GRAPH_COMPILE_FAILED",
                    "message": str(exc),
                    "issues": [item.model_dump(mode="json") for item in exc.issues],
                },
            ) from exc
        except IdempotencyConflict as exc:
            raise HTTPException(
                status_code=409,
                detail={"code": "IDEMPOTENCY_CONFLICT", "message": str(exc)},
            ) from exc

    @router.post("/runs", response_model=RunResponse)
    def create_run(request: RunRequest) -> RunResponse:
        try:
            return RunResponse.model_validate(service.run(request))
        except ArtifactNotFound as exc:
            raise HTTPException(
                status_code=404,
                detail={"code": "ARTIFACT_NOT_FOUND", "message": "Assurance artifact not found."},
            ) from exc
        except CandidateConflict as exc:
            raise HTTPException(
                status_code=409,
                detail={"code": "CANDIDATE_HASH_MISMATCH", "message": str(exc)},
            ) from exc
        except IdempotencyConflict as exc:
            raise HTTPException(
                status_code=409,
                detail={"code": "IDEMPOTENCY_CONFLICT", "message": str(exc)},
            ) from exc
        except RunInputConflict as exc:
            raise HTTPException(
                status_code=422,
                detail={"code": "RUN_INPUT_SCENARIO_MISMATCH", "message": str(exc)},
            ) from exc

    @router.post("/evals", response_model=EvalResponse)
    def run_evals(request: EvalRequest) -> EvalResponse:
        try:
            return EvalResponse.model_validate(service.eval(request))
        except ArtifactNotFound as exc:
            raise HTTPException(
                status_code=404,
                detail={"code": "ARTIFACT_NOT_FOUND", "message": "Assurance artifact not found."},
            ) from exc
        except SuiteNotFound as exc:
            raise HTTPException(
                status_code=404,
                detail={"code": "EVAL_SUITE_NOT_FOUND", "message": "Eval suite/version not found."},
            ) from exc
        except CandidateConflict as exc:
            raise HTTPException(
                status_code=409,
                detail={"code": "CANDIDATE_HASH_MISMATCH", "message": str(exc)},
            ) from exc
        except IdempotencyConflict as exc:
            raise HTTPException(
                status_code=409,
                detail={"code": "IDEMPOTENCY_CONFLICT", "message": str(exc)},
            ) from exc

    @router.post("/patches/{patch_id}/preview")
    def preview_patch(patch_id: str, request: PatchPreviewRequest) -> dict[str, object]:
        del request
        raise HTTPException(
            status_code=404,
            detail={
                "code": "PATCH_NOT_FOUND",
                "message": f"No assurance graph patch '{patch_id}' is registered.",
            },
        )

    return router
