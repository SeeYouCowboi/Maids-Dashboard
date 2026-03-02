from __future__ import annotations

import json
import sqlite3
from collections.abc import Mapping
from pathlib import Path
from typing import Any

OBSERVABILITY_BLOCKED_BASENAMES = frozenset({"MEMORY.md", "auth.json", "auth-profiles.json"})
INCIDENT_SEVERITY_SCORE = {"critical": 0, "high": 1, "medium": 2, "low": 3}
from dashboard_db import DashboardDB

from services.delivery_service import delivery_queue_path
from services.shared import _ts_ms_from_any, redact_sensitive_data


def _sort_incidents(incidents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        incidents,
        key=lambda item: (
            INCIDENT_SEVERITY_SCORE.get(str(item.get("severity", "medium")), 99),
            -_ts_ms_from_any(item.get("tsMs")),
            str(item.get("source", "")),
            str(item.get("id", "")),
        ),
    )


def _collect_delivery_incidents(queue_dir: Path) -> list[dict[str, Any]]:
    incidents: list[dict[str, Any]] = []
    if not queue_dir.is_dir():
        return incidents

    for file_path in sorted(queue_dir.glob("*.json")):
        try:
            with file_path.open("r", encoding="utf-8") as fh:
                payload = json.load(fh)
        except Exception:
            continue
        if not isinstance(payload, dict):
            continue
        last_error = payload.get("lastError")
        retry_count = int(payload.get("retryCount", 0) or 0)
        if not last_error and retry_count <= 0:
            continue
        enqueued_at = int(payload.get("enqueuedAt", 0) or 0)
        severity = "critical" if retry_count >= 5 else "high"
        incidents.append(
            redact_sensitive_data(
                {
                    "id": f"delivery:{payload.get('id', file_path.stem)}",
                    "source": "delivery",
                    "severity": severity,
                    "tsMs": enqueued_at,
                    "summary": f"Delivery queue failure for {payload.get('channel') or 'unknown channel'}",
                    "details": {
                        "file": str(file_path),
                        "retryCount": retry_count,
                        "recipient": payload.get("to"),
                        "lastError": last_error,
                    },
                    "suggestedFixes": [
                        {
                            "summary": "Verify delivery channel credentials and retry policy",
                            "configPath": "openclaw.json",
                            "field": f"channels.{payload.get('channel') or '<channel>'}",
                        }
                    ],
                }
            )
        )
    return incidents


def _collect_cron_incidents(db: DashboardDB) -> list[dict[str, Any]]:
    incidents: list[dict[str, Any]] = []
    try:
        with db.get_connection() as conn:
            run_rows = conn.execute(
                "SELECT id, job_id, ts_ms, status, action, run_json FROM cron_run "
                "WHERE lower(status) IN ('failed', 'error') ORDER BY ts_ms DESC, id DESC LIMIT 200"
            ).fetchall()
            state_rows = conn.execute(
                "SELECT id, name, state_json FROM cron_job "
                "WHERE lower(state_json) LIKE '%error%' OR lower(state_json) LIKE '%failed%' "
                "ORDER BY id ASC"
            ).fetchall()
    except sqlite3.Error:
        return incidents

    for row in run_rows:
        run_details: dict[str, Any] = {}
        try:
            parsed = json.loads(row["run_json"])
            if isinstance(parsed, dict):
                run_details = parsed
        except Exception:
            pass
        incidents.append(
            redact_sensitive_data(
                {
                    "id": f"cron-run:{row['id']}",
                    "source": "cron",
                    "severity": "high",
                    "tsMs": int(row["ts_ms"] or 0),
                    "summary": f"Cron run failed for job {row['job_id']}",
                    "details": {
                        "jobId": row["job_id"],
                        "status": row["status"],
                        "action": row["action"],
                        "error": run_details.get("error") or run_details.get("summary"),
                    },
                    "suggestedFixes": [
                        {
                            "summary": "Inspect cron job state and adjust schedule or command",
                            "configPath": "cron/jobs.json",
                            "field": f"jobs[id={row['job_id']}].state",
                        }
                    ],
                }
            )
        )

    for row in state_rows:
        state_value = row["state_json"]
        state: Any = state_value
        if isinstance(state_value, str):
            try:
                parsed_state = json.loads(state_value)
                state = parsed_state if isinstance(parsed_state, dict) else state_value
            except Exception:
                state = state_value
        incidents.append(
            redact_sensitive_data(
                {
                    "id": f"cron-state:{row['id']}",
                    "source": "cron",
                    "severity": "medium",
                    "tsMs": 0,
                    "summary": f"Cron job {row['id']} has error state",
                    "details": {
                        "jobId": row["id"],
                        "jobName": row["name"],
                        "state": state,
                    },
                    "suggestedFixes": [
                        {
                            "summary": "Clear stale error state after fixing the failing action",
                            "configPath": "cron/jobs.json",
                            "field": f"jobs[id={row['id']}].state",
                        }
                    ],
                }
            )
        )

    return incidents


def _is_tool_result_failure(message_obj: Mapping[str, Any]) -> bool:
    if bool(message_obj.get("isError")):
        return True

    details = message_obj.get("details")
    if isinstance(details, Mapping):
        status = str(details.get("status", "")).strip().lower()
        if status in {"error", "failed", "denied", "blocked"}:
            return True
        if details.get("ok") is False:
            return True
        exit_code = details.get("exitCode")
        if isinstance(exit_code, int) and exit_code != 0:
            return True

    content = message_obj.get("content")
    if isinstance(content, list):
        for entry in content:
            if not isinstance(entry, Mapping):
                continue
            text = str(entry.get("text", "")).lower()
            if '"status": "error"' in text or "process exited with code 1" in text:
                return True
    return False


def _extract_tool_result_error(message_obj: Mapping[str, Any]) -> str:
    details = message_obj.get("details")
    if isinstance(details, Mapping):
        err = details.get("error")
        if isinstance(err, str) and err.strip():
            return err.strip()
        summary = details.get("summary")
        if isinstance(summary, str) and summary.strip():
            return summary.strip()
    content = message_obj.get("content")
    if isinstance(content, list):
        for entry in content:
            if not isinstance(entry, Mapping):
                continue
            text = str(entry.get("text", "")).strip()
            if text:
                return text[:280]
    return "Tool result indicates a failure"


def _collect_session_tool_result_incidents(openclaw_root: Path, db: DashboardDB) -> list[dict[str, Any]]:
    incidents: list[dict[str, Any]] = []
    try:
        with db.get_connection() as conn:
            session_rows = conn.execute(
                "SELECT session_key, agent_id, session_id, updated_at FROM session_meta "
                "ORDER BY updated_at DESC LIMIT 200"
            ).fetchall()
    except sqlite3.Error:
        return incidents

    for row in session_rows:
        agent_id = str(row["agent_id"] or "")
        session_id = str(row["session_id"] or "")
        if not agent_id or not session_id:
            continue
        transcript_path = openclaw_root / "agents" / agent_id / "sessions" / f"{session_id}.jsonl"
        if not transcript_path.is_file() or transcript_path.name in OBSERVABILITY_BLOCKED_BASENAMES:
            continue

        latest_failure: dict[str, Any] | None = None
        try:
            with transcript_path.open("r", encoding="utf-8") as fh:
                for raw_line in fh:
                    line = raw_line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if not isinstance(entry, dict) or entry.get("type") != "message":
                        continue
                    message_obj = entry.get("message")
                    if not isinstance(message_obj, Mapping):
                        continue
                    if message_obj.get("role") != "toolResult":
                        continue
                    if not _is_tool_result_failure(message_obj):
                        continue
                    latest_failure = {
                        "tsMs": _ts_ms_from_any(message_obj.get("timestamp") or entry.get("timestamp")),
                        "toolName": message_obj.get("toolName"),
                        "error": _extract_tool_result_error(message_obj),
                    }
        except OSError:
            continue

        if latest_failure is None:
            continue

        incidents.append(
            redact_sensitive_data(
                {
                    "id": f"session:{agent_id}:{session_id}",
                    "source": "sessions",
                    "severity": "medium",
                    "tsMs": latest_failure["tsMs"],
                    "summary": f"Session toolResult failure in agent {agent_id}",
                    "details": {
                        "agentId": agent_id,
                        "sessionId": session_id,
                        "sessionKey": row["session_key"],
                        "toolName": latest_failure.get("toolName"),
                        "error": latest_failure.get("error"),
                        "transcript": str(transcript_path),
                    },
                    "suggestedFixes": [
                        {
                            "summary": "Review tool permissions and command payload for this agent",
                            "configPath": "openclaw.json",
                            "field": f"agents.list[id={agent_id}].tools",
                        }
                    ],
                }
            )
        )

    return incidents


def collect_dispatch_incidents(db: DashboardDB | None, openclaw_root: Path) -> list[dict[str, Any]]:
    if db is None:
        return []
    incidents: list[dict[str, Any]] = []
    incidents.extend(_collect_delivery_incidents(delivery_queue_path()))
    incidents.extend(_collect_cron_incidents(db))
    incidents.extend(_collect_session_tool_result_incidents(openclaw_root, db))
    return _sort_incidents(incidents)
