from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from services.dispatch_service import explain_dispatch
from services.shared import _get_openclaw_root, redact_sensitive_data

router = APIRouter(prefix="/api/v1", tags=["dispatch"])


@router.post("/dispatch/explain")
def explain(payload: dict[str, Any]) -> dict[str, Any]:
    hypothetical = payload.get("dispatch") if isinstance(payload.get("dispatch"), dict) else payload
    if not isinstance(hypothetical, dict):
        raise HTTPException(status_code=400, detail={"error": "dispatch must be an object"})

    result = explain_dispatch(hypothetical, _get_openclaw_root())
    return redact_sensitive_data(result)
