from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from core.utils import get_openclaw_root
from sse_manager import MAX_SSE_CLIENTS, SSEClient
from services.config_service import load_dashboard_config
from services.shared import redact_sensitive_data, write_bytes_atomic
from services.state import get_db, get_sse

router = APIRouter(prefix="/api/v1", tags=["heartbeat"])


def _build_health_payload() -> tuple[int, dict[str, Any]]:
    db = get_db()
    if db is None:
        return 503, {
            "status": "degraded",
            "db": {"ok": False, "error": "dashboard DB not initialized"},
        }

    db_status = db.health_check()

    canon_status: dict[str, Any] = {"ok": False, "path": None, "error": None}
    openclaw_root = get_openclaw_root()
    canon_db_path = os.path.join(
        openclaw_root, "workspace", "maids", "state", "canon.db"
    )
    try:
        conn = sqlite3.connect(canon_db_path, timeout=2.0)
        conn.execute("SELECT 1")
        conn.close()
        canon_status = {"ok": True, "path": canon_db_path}
    except Exception as exc:
        canon_status = {"ok": False, "path": canon_db_path, "error": str(exc)}

    events_status: dict[str, Any] = {"ok": False, "path": None, "error": None}
    events_path = os.path.join(
        openclaw_root, "workspace", "maids", "state", "events.jsonl"
    )
    try:
        with open(events_path, "r", encoding="utf-8") as f:
            f.read(1)
        events_status = {"ok": True, "path": events_path}
    except Exception as exc:
        events_status = {"ok": False, "path": events_path, "error": str(exc)}

    config = load_dashboard_config()
    redacted_config = redact_sensitive_data(
        {
            "bindHost": config.get("dashboardBindHost"),
            "port": config.get("dashboardPort"),
        }
    )

    all_ok = (
        bool(db_status.get("ok"))
        and bool(canon_status.get("ok"))
        and bool(events_status.get("ok"))
    )
    overall = "ok" if all_ok else "degraded"
    status = 200 if all_ok else 503

    sse_mgr = get_sse()
    sse_clients = sse_mgr.client_count if sse_mgr is not None else 0

    return status, {
        "status": overall,
        "ok": all_ok,
        "db": db_status,
        "canon_db": canon_status,
        "events_jsonl": events_status,
        "config": redacted_config,
        "sse_clients": sse_clients,
    }


@router.get("/health")
def get_health() -> tuple[int, dict[str, Any]] | dict[str, Any]:
    status, payload = _build_health_payload()
    if status == 200:
        return payload
    from fastapi import HTTPException

    raise HTTPException(status_code=status, detail=payload)


@router.get("/stream")
def sse_stream() -> StreamingResponse:
    sse_mgr = get_sse()
    if sse_mgr is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=503, detail="SSE manager not initialized")

    if sse_mgr.client_count >= MAX_SSE_CLIENTS:
        from fastapi import HTTPException

        raise HTTPException(status_code=503, detail="SSE client limit reached")

    client = SSEClient()
    if not sse_mgr.register(client):
        from fastapi import HTTPException

        raise HTTPException(status_code=503, detail="SSE client limit reached")

    def event_generator():
        try:
            while client.connected:
                try:
                    msg = client.event_queue.get(timeout=1.0)
                except Exception:
                    continue
                if msg is None:
                    break
                yield msg
        finally:
            client.close()
            sse_mgr.unregister(client)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/heartbeat/update")
def update_heartbeat(payload: dict[str, Any]) -> dict[str, Any]:
    content = payload.get("content", "")
    if not isinstance(content, str):
        raise HTTPException(
            status_code=400, detail={"error": "content must be a string"}
        )
    if len(content) > 102400:
        raise HTTPException(
            status_code=400, detail={"error": "content exceeds 100KB limit"}
        )
    openclaw_root = get_openclaw_root()
    heartbeat_path = Path(openclaw_root) / "workspace" / "maids" / "HEARTBEAT.md"
    try:
        heartbeat_path.parent.mkdir(parents=True, exist_ok=True)
        write_bytes_atomic(heartbeat_path, content.encode("utf-8"))
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail={"error": f"failed to write HEARTBEAT.md: {exc}"}
        )
    return {"ok": True, "path": str(heartbeat_path), "size": len(content)}
