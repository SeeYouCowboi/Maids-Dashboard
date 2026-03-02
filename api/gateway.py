from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

import gateway.probe as gateway_probe
from services.shared import redact_sensitive_data

router = APIRouter(prefix="/api/v1", tags=["gateway"])


@router.get("/gateway/health")
def gateway_health() -> dict[str, Any]:
    try:
        result = gateway_probe.gateway_health()
    except Exception:
        raise HTTPException(status_code=502, detail={"error": "gateway health failed"})

    if result.ok:
        return redact_sensitive_data(result.payload)
    raise HTTPException(status_code=502, detail={"error": result.error or "gateway health failed"})
