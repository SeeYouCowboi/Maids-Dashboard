from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter

from services.delivery_service import delivery_queue_path, infer_retry_status

router = APIRouter(prefix="/api/v1", tags=["delivery"])


def _redact_last_error_fields(value: Any) -> Any:
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            key_str = str(key)
            normalized = key_str.replace("_", "").lower()
            if normalized == "lasterror":
                redacted[key_str] = "[REDACTED]"
            else:
                redacted[key_str] = _redact_last_error_fields(item)
        return redacted
    if isinstance(value, list):
        return [_redact_last_error_fields(item) for item in value]
    return value


@router.get("/delivery/failures")
def get_delivery_failures() -> dict[str, Any]:
    queue_dir = delivery_queue_path()
    if not queue_dir.is_dir():
        return {"failures": []}

    failures: list[dict[str, Any]] = []
    for file_path in sorted(queue_dir.glob("*.json")):
        try:
            with file_path.open("r", encoding="utf-8") as fh:
                payload = json.load(fh)
        except Exception:
            continue
        if not isinstance(payload, dict):
            continue
        failures.append(
            _redact_last_error_fields(
                {
                    "id": payload.get("id", file_path.stem),
                    "file": str(file_path),
                    "enqueued_at": payload.get("enqueuedAt"),
                    "channel": payload.get("channel"),
                    "recipient": payload.get("to"),
                    "retry_count": payload.get("retryCount", 0),
                    "retry_status": infer_retry_status(payload),
                    "lastError": payload.get("lastError"),
                }
            )
        )

    failures.sort(key=lambda item: int(item.get("enqueued_at", 0) or 0), reverse=True)
    return {"failures": failures}
