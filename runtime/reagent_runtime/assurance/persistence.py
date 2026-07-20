from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any
from uuid import uuid4


class IdempotencyConflict(RuntimeError):
    pass


class AssuranceStore:
    def __init__(self, path: str | Path) -> None:
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(self.path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys=ON")
        self._migrate()

    def _migrate(self) -> None:
        with self.conn:
            self.conn.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS assurance_artifacts (
                    artifact_id TEXT PRIMARY KEY,
                    scenario_id TEXT NOT NULL,
                    source_graph_json TEXT NOT NULL,
                    normalized_semantic_graph_json TEXT NOT NULL,
                    source_graph_hash TEXT NOT NULL,
                    execution_policy_json TEXT NOT NULL,
                    compiled_plan_json TEXT NOT NULL,
                    node_map_json TEXT NOT NULL,
                    edge_map_json TEXT NOT NULL,
                    candidate_hash TEXT NOT NULL UNIQUE,
                    schema_version TEXT NOT NULL,
                    adapter_version TEXT NOT NULL,
                    compiler_version TEXT NOT NULL,
                    capability_registry_digest TEXT NOT NULL,
                    lowerer_registry_digest TEXT NOT NULL,
                    contract_registry_digest TEXT NOT NULL,
                    check_registry_digest TEXT NOT NULL,
                    resolved_assurance_config_json TEXT NOT NULL,
                    applied_patch_provenance_json TEXT,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS assurance_compile_requests (
                    scenario_id TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL,
                    request_hash TEXT NOT NULL,
                    artifact_id TEXT NOT NULL REFERENCES assurance_artifacts(artifact_id),
                    response_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY(scenario_id, idempotency_key)
                );
                CREATE TABLE IF NOT EXISTS assurance_runs (
                    run_id TEXT PRIMARY KEY,
                    artifact_id TEXT NOT NULL REFERENCES assurance_artifacts(artifact_id),
                    candidate_hash TEXT NOT NULL,
                    input_json TEXT NOT NULL,
                    deterministic_seed INTEGER NOT NULL,
                    terminal_result_json TEXT NOT NULL,
                    internal_executor_calls_json TEXT NOT NULL,
                    internal_executor_retries_json TEXT NOT NULL,
                    outer_revisions_json TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL,
                    request_hash TEXT NOT NULL,
                    response_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    finished_at TEXT NOT NULL,
                    UNIQUE(artifact_id, idempotency_key)
                );
                CREATE TABLE IF NOT EXISTS assurance_events (
                    event_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL REFERENCES assurance_runs(run_id),
                    sequence INTEGER NOT NULL,
                    event_type TEXT NOT NULL,
                    attempt_number INTEGER NOT NULL,
                    canvas_node_id TEXT,
                    canvas_edge_id TEXT,
                    plan_step_id TEXT,
                    causation_id TEXT,
                    correlation_id TEXT NOT NULL,
                    candidate_hash TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(run_id, sequence)
                );
                CREATE TABLE IF NOT EXISTS assurance_evals (
                    eval_id TEXT PRIMARY KEY,
                    artifact_id TEXT NOT NULL REFERENCES assurance_artifacts(artifact_id),
                    candidate_hash TEXT NOT NULL,
                    suite_id TEXT NOT NULL,
                    suite_version TEXT NOT NULL,
                    seed_policy TEXT NOT NULL,
                    aggregate_json TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL,
                    request_hash TEXT NOT NULL,
                    response_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    finished_at TEXT NOT NULL,
                    UNIQUE(artifact_id, idempotency_key)
                );
                CREATE TABLE IF NOT EXISTS assurance_eval_cases (
                    eval_id TEXT NOT NULL REFERENCES assurance_evals(eval_id),
                    case_id TEXT NOT NULL,
                    case_version TEXT NOT NULL,
                    evaluator_id TEXT NOT NULL,
                    evaluator_version TEXT NOT NULL,
                    run_id TEXT NOT NULL REFERENCES assurance_runs(run_id),
                    result_json TEXT NOT NULL,
                    PRIMARY KEY(eval_id, case_id)
                );
                CREATE TABLE IF NOT EXISTS assurance_idempotency_claims (
                    scope_type TEXT NOT NULL,
                    scope_id TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL,
                    request_hash TEXT NOT NULL,
                    status TEXT NOT NULL,
                    response_json TEXT,
                    owner_token TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY(scope_type, scope_id, idempotency_key)
                );
                CREATE INDEX IF NOT EXISTS assurance_events_run_sequence
                    ON assurance_events(run_id, sequence);
                """
            )

    def claim_idempotency(
        self,
        scope_type: str,
        scope_id: str,
        idempotency_key: str,
        request_hash: str,
    ) -> tuple[str, str | dict[str, Any]]:
        owner_token = str(uuid4())
        with self.lock, self.conn:
            self.conn.execute(
                """
                INSERT OR IGNORE INTO assurance_idempotency_claims(
                    scope_type,scope_id,idempotency_key,request_hash,status,owner_token
                ) VALUES (?,?,?,?,'pending',?)
                """,
                (scope_type, scope_id, idempotency_key, request_hash, owner_token),
            )
            row = self.conn.execute(
                """
                SELECT request_hash,status,response_json,owner_token
                FROM assurance_idempotency_claims
                WHERE scope_type=? AND scope_id=? AND idempotency_key=?
                """,
                (scope_type, scope_id, idempotency_key),
            ).fetchone()
        assert row is not None
        if row["request_hash"] != request_hash:
            raise IdempotencyConflict(
                f"The {scope_type} idempotency key was reused with a different request."
            )
        if row["status"] == "completed":
            return "replay", json.loads(row["response_json"])
        if row["owner_token"] == owner_token:
            return "owner", owner_token
        return "pending", row["owner_token"]

    def wait_for_idempotency(
        self,
        scope_type: str,
        scope_id: str,
        idempotency_key: str,
        request_hash: str,
        *,
        timeout_seconds: float = 30.0,
    ) -> dict[str, Any]:
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            with self.lock:
                row = self.conn.execute(
                    """
                    SELECT request_hash,status,response_json
                    FROM assurance_idempotency_claims
                    WHERE scope_type=? AND scope_id=? AND idempotency_key=?
                    """,
                    (scope_type, scope_id, idempotency_key),
                ).fetchone()
            if row is None:
                raise RuntimeError("The pending idempotency claim disappeared.")
            if row["request_hash"] != request_hash:
                raise IdempotencyConflict(
                    f"The {scope_type} idempotency key was reused with a different request."
                )
            if row["status"] == "completed":
                return json.loads(row["response_json"])
            time.sleep(0.01)
        raise TimeoutError(f"Timed out waiting for pending {scope_type} request.")

    def complete_idempotency(
        self,
        scope_type: str,
        scope_id: str,
        idempotency_key: str,
        owner_token: str,
        response: dict[str, Any],
    ) -> None:
        cursor = self.conn.execute(
            """
            UPDATE assurance_idempotency_claims
            SET status='completed',response_json=?,updated_at=CURRENT_TIMESTAMP
            WHERE scope_type=? AND scope_id=? AND idempotency_key=?
              AND owner_token=? AND status='pending'
            """,
            (
                json.dumps(response, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
                scope_type,
                scope_id,
                idempotency_key,
                owner_token,
            ),
        )
        if cursor.rowcount != 1:
            raise RuntimeError("Could not publish the owned idempotency claim.")

    def release_idempotency(
        self,
        scope_type: str,
        scope_id: str,
        idempotency_key: str,
        owner_token: str,
    ) -> None:
        with self.lock, self.conn:
            self.conn.execute(
                """
                DELETE FROM assurance_idempotency_claims
                WHERE scope_type=? AND scope_id=? AND idempotency_key=?
                  AND owner_token=? AND status='pending'
                """,
                (scope_type, scope_id, idempotency_key, owner_token),
            )

    @staticmethod
    def _load(value: str) -> dict[str, Any]:
        return json.loads(value)

    def idempotent_compile(
        self, scenario_id: str, idempotency_key: str, request_hash: str
    ) -> dict[str, Any] | None:
        with self.lock:
            row = self.conn.execute(
                "SELECT request_hash,response_json FROM assurance_compile_requests "
                "WHERE scenario_id=? AND idempotency_key=?",
                (scenario_id, idempotency_key),
            ).fetchone()
        if not row:
            return None
        if row["request_hash"] != request_hash:
            raise IdempotencyConflict(
                "The compile idempotency key was reused with a different canonical request."
            )
        return self._load(row["response_json"])

    def artifact_by_candidate(self, candidate_hash: str) -> dict[str, Any] | None:
        with self.lock:
            row = self.conn.execute(
                "SELECT * FROM assurance_artifacts WHERE candidate_hash=?", (candidate_hash,)
            ).fetchone()
        return self._artifact_row(row) if row else None

    def artifact(self, artifact_id: str) -> dict[str, Any] | None:
        with self.lock:
            row = self.conn.execute(
                "SELECT * FROM assurance_artifacts WHERE artifact_id=?", (artifact_id,)
            ).fetchone()
        return self._artifact_row(row) if row else None

    def _artifact_row(self, row: sqlite3.Row) -> dict[str, Any]:
        result = dict(row)
        for key in (
            "source_graph_json",
            "normalized_semantic_graph_json",
            "execution_policy_json",
            "compiled_plan_json",
            "node_map_json",
            "edge_map_json",
            "resolved_assurance_config_json",
            "applied_patch_provenance_json",
        ):
            if result[key] is not None:
                result[key.removesuffix("_json")] = json.loads(result[key])
        return result

    def save_compile(
        self,
        *,
        artifact: dict[str, Any],
        idempotency_key: str,
        request_hash: str,
        response: dict[str, Any],
        claim_owner: str | None = None,
    ) -> None:
        digests = artifact["registry_digests"]
        with self.lock, self.conn:
            self.conn.execute(
                """
                INSERT OR IGNORE INTO assurance_artifacts(
                    artifact_id,scenario_id,source_graph_json,normalized_semantic_graph_json,
                    source_graph_hash,execution_policy_json,compiled_plan_json,node_map_json,
                    edge_map_json,candidate_hash,schema_version,adapter_version,compiler_version,
                    capability_registry_digest,lowerer_registry_digest,contract_registry_digest,
                    check_registry_digest,resolved_assurance_config_json,
                    applied_patch_provenance_json,created_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    artifact["artifact_id"],
                    artifact["scenario_id"],
                    json.dumps(
                        artifact["source_graph"],
                        ensure_ascii=False,
                        separators=(",", ":"),
                        sort_keys=True,
                    ),
                    json.dumps(
                        artifact["normalized_semantic_graph"],
                        ensure_ascii=False,
                        separators=(",", ":"),
                        sort_keys=True,
                    ),
                    artifact["source_graph_hash"],
                    json.dumps(artifact["execution_policy"], separators=(",", ":"), sort_keys=True),
                    json.dumps(
                        artifact["compiled_plan"],
                        ensure_ascii=False,
                        separators=(",", ":"),
                        sort_keys=True,
                    ),
                    json.dumps(
                        artifact["node_to_plan_steps"], separators=(",", ":"), sort_keys=True
                    ),
                    json.dumps(
                        artifact["edge_to_plan_transitions"], separators=(",", ":"), sort_keys=True
                    ),
                    artifact["candidate_hash"],
                    "assurance.artifact.v1",
                    artifact["adapter_version"],
                    artifact["compiler_version"],
                    digests["capability_registry_digest"],
                    digests["lowerer_registry_digest"],
                    digests["contract_registry_digest"],
                    digests["check_registry_digest"],
                    json.dumps(
                        artifact["resolved_assurance"],
                        ensure_ascii=False,
                        separators=(",", ":"),
                        sort_keys=True,
                    ),
                    None,
                    artifact["created_at"],
                ),
            )
            if claim_owner:
                self.complete_idempotency(
                    "compile",
                    artifact["scenario_id"],
                    idempotency_key,
                    claim_owner,
                    response,
                )
            self.conn.execute(
                """
                INSERT INTO assurance_compile_requests(
                    scenario_id,idempotency_key,request_hash,artifact_id,response_json,status,created_at
                ) VALUES (?,?,?,?,?,'completed',?)
                """,
                (
                    artifact["scenario_id"],
                    idempotency_key,
                    request_hash,
                    artifact["artifact_id"],
                    json.dumps(response, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
                    artifact["created_at"],
                ),
            )

    def idempotent_run(
        self, artifact_id: str, idempotency_key: str, request_hash: str
    ) -> dict[str, Any] | None:
        with self.lock:
            row = self.conn.execute(
                "SELECT request_hash,response_json FROM assurance_runs "
                "WHERE artifact_id=? AND idempotency_key=?",
                (artifact_id, idempotency_key),
            ).fetchone()
        if not row:
            return None
        if row["request_hash"] != request_hash:
            raise IdempotencyConflict(
                "The run idempotency key was reused with a different canonical request."
            )
        return self._load(row["response_json"])

    def save_run(
        self,
        response: dict[str, Any],
        request_hash: str,
        run_input: dict[str, Any],
        seed: int,
        idempotency_key: str,
        claim_owner: str | None = None,
    ) -> None:
        with self.lock, self.conn:
            self.conn.execute(
                """
                INSERT INTO assurance_runs(
                    run_id,artifact_id,candidate_hash,input_json,deterministic_seed,
                    terminal_result_json,internal_executor_calls_json,
                    internal_executor_retries_json,outer_revisions_json,idempotency_key,
                    request_hash,response_json,status,created_at,finished_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    response["run_id"],
                    response["artifact_id"],
                    response["candidate_hash"],
                    json.dumps(
                        run_input, ensure_ascii=False, separators=(",", ":"), sort_keys=True
                    ),
                    seed,
                    json.dumps(
                        response["terminal_result"],
                        ensure_ascii=False,
                        separators=(",", ":"),
                        sort_keys=True,
                    ),
                    json.dumps(
                        response["internal_executor_calls"], separators=(",", ":"), sort_keys=True
                    ),
                    json.dumps(
                        response["internal_executor_retries"], separators=(",", ":"), sort_keys=True
                    ),
                    json.dumps(response["outer_revisions"], separators=(",", ":"), sort_keys=True),
                    idempotency_key,
                    request_hash,
                    json.dumps(response, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
                    response["status"],
                    response["created_at"],
                    response["finished_at"],
                ),
            )
            for event in response["events"]:
                self.conn.execute(
                    """
                    INSERT INTO assurance_events(
                        event_id,run_id,sequence,event_type,attempt_number,canvas_node_id,
                        canvas_edge_id,plan_step_id,causation_id,correlation_id,candidate_hash,
                        payload_json,created_at
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        event["event_id"],
                        response["run_id"],
                        event["sequence"],
                        event["event_type"],
                        event["attempt_number"],
                        event.get("canvas_node_id"),
                        event.get("canvas_edge_id"),
                        event.get("plan_step_id"),
                        event.get("causation_id"),
                        event["correlation_id"],
                        response["candidate_hash"],
                        json.dumps(
                            event["payload"],
                            ensure_ascii=False,
                            separators=(",", ":"),
                            sort_keys=True,
                        ),
                        event["timestamp"],
                    ),
                )
            if claim_owner:
                self.complete_idempotency(
                    "run",
                    response["artifact_id"],
                    idempotency_key,
                    claim_owner,
                    response,
                )

    def idempotent_eval(
        self, artifact_id: str, idempotency_key: str, request_hash: str
    ) -> dict[str, Any] | None:
        with self.lock:
            row = self.conn.execute(
                "SELECT request_hash,response_json FROM assurance_evals "
                "WHERE artifact_id=? AND idempotency_key=?",
                (artifact_id, idempotency_key),
            ).fetchone()
        if not row:
            return None
        if row["request_hash"] != request_hash:
            raise IdempotencyConflict(
                "The eval idempotency key was reused with a different canonical request."
            )
        return self._load(row["response_json"])

    def save_eval(
        self,
        response: dict[str, Any],
        request_hash: str,
        idempotency_key: str,
        claim_owner: str | None = None,
    ) -> None:
        with self.lock, self.conn:
            self.conn.execute(
                """
                INSERT INTO assurance_evals(
                    eval_id,artifact_id,candidate_hash,suite_id,suite_version,seed_policy,
                    aggregate_json,idempotency_key,request_hash,response_json,status,created_at,finished_at
                ) VALUES (?,?,?,?,?,'fixed',?,?,?,?,?,?,?)
                """,
                (
                    response["eval_id"],
                    response["artifact_id"],
                    response["candidate_hash"],
                    response["suite_id"],
                    response["suite_version"],
                    json.dumps(response["aggregate"], separators=(",", ":"), sort_keys=True),
                    idempotency_key,
                    request_hash,
                    json.dumps(response, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
                    response["status"],
                    response["created_at"],
                    response["finished_at"],
                ),
            )
            for case in response["cases"]:
                self.conn.execute(
                    """
                    INSERT INTO assurance_eval_cases(
                        eval_id,case_id,case_version,evaluator_id,evaluator_version,run_id,result_json
                    ) VALUES (?,?,?,?,?,?,?)
                    """,
                    (
                        response["eval_id"],
                        case["case_id"],
                        case["case_version"],
                        case["evaluator_id"],
                        case["evaluator_version"],
                        case["run_id"],
                        json.dumps(
                            case["result"],
                            ensure_ascii=False,
                            separators=(",", ":"),
                            sort_keys=True,
                        ),
                    ),
                )
            if claim_owner:
                self.complete_idempotency(
                    "eval",
                    response["artifact_id"],
                    idempotency_key,
                    claim_owner,
                    response,
                )
