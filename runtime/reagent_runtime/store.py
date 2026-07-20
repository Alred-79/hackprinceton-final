from __future__ import annotations

import sqlite3
import threading
from pathlib import Path
from typing import Any

from .models import ApprovalError, PendingApproval, RunRecord, stable_hash


class StoreError(RuntimeError):
    def __init__(self, code: ApprovalError, message: str) -> None:
        self.code = code
        super().__init__(message)


class RuntimeStore:
    def __init__(self, path: str | Path) -> None:
        self.path = str(path)
        self._lock = threading.RLock()
        self.conn = sqlite3.connect(self.path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._setup()

    def _setup(self) -> None:
        with self.conn:
            self.conn.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS runs (
                    run_id TEXT PRIMARY KEY,
                    record_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS approvals (
                    approval_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    checkpoint_id TEXT NOT NULL,
                    tool_call_id TEXT NOT NULL,
                    args_hash TEXT NOT NULL,
                    config_hash TEXT NOT NULL,
                    status TEXT NOT NULL,
                    arguments_json TEXT NOT NULL,
                    idempotency_key TEXT UNIQUE
                );
                CREATE TABLE IF NOT EXISTS side_effects (
                    effect_key TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    tool_call_id TEXT NOT NULL,
                    payload_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                """
            )

    def save_run(self, record: RunRecord) -> None:
        payload = record.model_dump_json()
        with self._lock, self.conn:
            self.conn.execute(
                """
                INSERT INTO runs(run_id, record_json) VALUES (?, ?)
                ON CONFLICT(run_id) DO UPDATE SET
                    record_json=excluded.record_json,
                    updated_at=CURRENT_TIMESTAMP
                """,
                (record.run_id, payload),
            )

    def get_run(self, run_id: str) -> RunRecord | None:
        with self._lock:
            row = self.conn.execute(
                "SELECT record_json FROM runs WHERE run_id=?", (run_id,)
            ).fetchone()
        return RunRecord.model_validate_json(row["record_json"]) if row else None

    def create_approval(self, approval: PendingApproval) -> PendingApproval:
        import json

        with self._lock, self.conn:
            self.conn.execute(
                """
                INSERT OR IGNORE INTO approvals(
                    approval_id, run_id, checkpoint_id, tool_call_id, args_hash,
                    config_hash, status, arguments_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    approval.approval_id,
                    approval.run_id,
                    approval.checkpoint_id,
                    approval.tool_call_id,
                    approval.validated_args_hash,
                    approval.config_hash,
                    approval.status,
                    json.dumps(approval.arguments, sort_keys=True),
                ),
            )
        return self.get_approval(approval.approval_id) or approval

    def get_approval(self, approval_id: str) -> PendingApproval | None:
        import json

        with self._lock:
            row = self.conn.execute(
                "SELECT * FROM approvals WHERE approval_id=?", (approval_id,)
            ).fetchone()
        if not row:
            return None
        return PendingApproval(
            approval_id=row["approval_id"],
            run_id=row["run_id"],
            checkpoint_id=row["checkpoint_id"],
            tool_call_id=row["tool_call_id"],
            validated_args_hash=row["args_hash"],
            config_hash=row["config_hash"],
            status=row["status"],
            arguments=json.loads(row["arguments_json"]),
        )

    def update_approval_checkpoint(self, approval_id: str, checkpoint_id: str) -> None:
        with self._lock, self.conn:
            self.conn.execute(
                "UPDATE approvals SET checkpoint_id=? WHERE approval_id=? AND status='pending'",
                (checkpoint_id, approval_id),
            )

    def resolve_approval(
        self,
        *,
        approval_id: str,
        run_id: str,
        config_hash: str,
        args: dict[str, Any],
        decision: str,
        idempotency_key: str,
    ) -> PendingApproval:
        with self._lock, self.conn:
            row = self.conn.execute(
                "SELECT * FROM approvals WHERE approval_id=?", (approval_id,)
            ).fetchone()
            if not row:
                raise StoreError(ApprovalError.UNKNOWN, "The approval does not exist.")
            if row["run_id"] != run_id:
                raise StoreError(ApprovalError.CROSS_RUN, "The approval belongs to another run.")
            if row["config_hash"] != config_hash or row["args_hash"] != stable_hash(args):
                raise StoreError(
                    ApprovalError.TAMPERED,
                    "Approval arguments or configuration changed.",
                )
            if row["status"] in {"consumed", "approved", "denied"}:
                raise StoreError(ApprovalError.CONSUMED, "The approval was already resolved.")
            duplicate = self.conn.execute(
                "SELECT approval_id FROM approvals WHERE idempotency_key=?", (idempotency_key,)
            ).fetchone()
            if duplicate:
                raise StoreError(ApprovalError.DUPLICATE, "The idempotency key was already used.")
            status = "approved" if decision == "approved" else "denied"
            self.conn.execute(
                """
                UPDATE approvals SET status=?, idempotency_key=?
                WHERE approval_id=? AND status='pending'
                """,
                (status, idempotency_key, approval_id),
            )
        approval = self.get_approval(approval_id)
        assert approval is not None
        return approval

    def consume_approval(self, approval_id: str) -> None:
        with self._lock, self.conn:
            cursor = self.conn.execute(
                "UPDATE approvals SET status='consumed' WHERE approval_id=? AND status='approved'",
                (approval_id,),
            )
            if cursor.rowcount != 1:
                raise StoreError(
                    ApprovalError.CONSUMED,
                    "Approval is not approved or was consumed.",
                )

    def publish_once(self, run_id: str, tool_call_id: str, payload: str) -> dict[str, Any]:
        key = f"{run_id}:{tool_call_id}"
        with self._lock, self.conn:
            cursor = self.conn.execute(
                """
                INSERT OR IGNORE INTO side_effects(effect_key, run_id, tool_call_id, payload_hash)
                VALUES (?, ?, ?, ?)
                """,
                (key, run_id, tool_call_id, stable_hash(payload)),
            )
        return {"published": cursor.rowcount == 1, "idempotency_key": key}

    def side_effect_count(self, run_id: str) -> int:
        with self._lock:
            row = self.conn.execute(
                "SELECT COUNT(*) AS count FROM side_effects WHERE run_id=?", (run_id,)
            ).fetchone()
        return int(row["count"])
