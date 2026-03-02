from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from services.session_service import _read_all_sessions
from services.shared import _get_openclaw_root, redact_sensitive_data

router = APIRouter(prefix="/api/v1", tags=["sessions"])


@router.get("/sessions")
def list_sessions() -> dict[str, Any]:
    openclaw_root = _get_openclaw_root()
    sessions = _read_all_sessions(openclaw_root)
    return {"sessions": redact_sensitive_data(sessions)}
