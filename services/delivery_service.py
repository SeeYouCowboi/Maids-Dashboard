from __future__ import annotations

from pathlib import Path
from typing import Any

from core.utils import get_openclaw_root


def delivery_queue_path() -> Path:
    return Path(get_openclaw_root()) / "delivery-queue"


def infer_retry_status(item: dict[str, Any]) -> str:
    retry_count = int(item.get("retryCount", 0) or 0)
    has_error = bool(item.get("lastError"))
    if has_error and retry_count > 0:
        return "retrying"
    if has_error:
        return "failed"
    return "ok"
