from __future__ import annotations

import json
import subprocess
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from api.canon import _canon_row_dicts
from services.dispatch_service import DISPATCH_DIAGNOSIS_DISCLAIMER
from services.incident_service import collect_dispatch_incidents
from services.shared import _get_openclaw_root
from services.state import get_db

router = APIRouter(prefix="/api/v1", tags=["incidents"])


@router.get("/conflicts")
def list_conflicts() -> dict[str, Any]:
    rows = _canon_row_dicts(
        "SELECT conflict_id, world_id, branch_id, kind, note, status FROM canon_conflict ORDER BY created_at_ms DESC, conflict_id DESC"
    )
    conflicts = [
        {
            "id": row["conflict_id"],
            "world_id": row["world_id"],
            "branch_id": row["branch_id"],
            "entity_id": None,
            "description": row.get("note") or row.get("kind") or "",
            "status": row["status"],
        }
        for row in rows
    ]
    return {"conflicts": conflicts}


@router.get("/events")
def list_events(request: Request) -> dict[str, Any]:
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail={"error": "DB not initialized"})

    try:
        limit = min(int(request.query_params.get("limit", "50")), 500)
    except Exception:
        limit = 50
    try:
        after_id = int(request.query_params.get("after_id", "0"))
    except Exception:
        after_id = 0

    with db.get_connection() as conn:
        rows = conn.execute(
            "SELECT id, ts_ms, kind, payload_json FROM event_index WHERE id > ? ORDER BY id ASC LIMIT ?",
            (after_id, limit),
        ).fetchall()

    events: list[dict[str, Any]] = []
    for row in rows:
        try:
            payload = json.loads(row["payload_json"])
        except Exception:
            payload = row["payload_json"]
        events.append(
            {
                "id": row["id"],
                "ts_ms": row["ts_ms"],
                "kind": row["kind"],
                "payload": payload,
            }
        )
    return {"events": events, "count": len(events)}


@router.get("/metrics/summary")
def metrics_summary() -> dict[str, Any]:
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail={"error": "DB not initialized"})

    metrics: dict[str, Any] = {}

    active_sessions = 0
    try:
        proc = subprocess.run(
            ["openclaw", "sessions", "--all-agents", "--json"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        if proc.returncode == 0:
            try:
                data = json.loads((proc.stdout or "").strip() or "[]")
                active_sessions = len(data) if isinstance(data, list) else 0
            except Exception:
                pass
    except Exception:
        pass
    metrics["active_sessions"] = active_sessions

    cron_errors = 0
    try:
        with db.get_connection() as conn:
            row = conn.execute(
                "SELECT COUNT(*) as cnt FROM cron_job WHERE state_json LIKE '%error%' OR state_json LIKE '%failed%'"
            ).fetchone()
            cron_errors = row["cnt"] if row else 0
    except Exception:
        pass
    metrics["cron_errors"] = cron_errors

    delivery_failures = 0
    try:
        with db.get_connection() as conn:
            row = conn.execute("SELECT COUNT(*) as cnt FROM delivery_failure").fetchone()
            delivery_failures = row["cnt"] if row else 0
    except Exception:
        pass
    metrics["delivery_failures"] = delivery_failures

    now_ms = int(time.time() * 1000)
    one_day_ms = 24 * 60 * 60 * 1000
    events_per_kind: dict[str, int] = {}
    try:
        with db.get_connection() as conn:
            rows = conn.execute(
                "SELECT kind, COUNT(*) as cnt FROM event_index WHERE ts_ms > ? GROUP BY kind",
                (now_ms - one_day_ms,),
            ).fetchall()
            for row in rows:
                events_per_kind[row["kind"]] = row["cnt"]
    except Exception:
        pass
    metrics["events_per_kind"] = events_per_kind

    return metrics


@router.get("/dispatch/incidents")
def dispatch_incidents() -> dict[str, Any]:
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail={"error": "DB not initialized"})
    openclaw_root = _get_openclaw_root()
    incidents = collect_dispatch_incidents(db, openclaw_root)
    return {
        "incidents": incidents,
        "count": len(incidents),
        "disclaimer": DISPATCH_DIAGNOSIS_DISCLAIMER,
    }
