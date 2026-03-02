from __future__ import annotations

import logging
import json
import shutil
import subprocess
from dataclasses import dataclass
from typing import Any


logger = logging.getLogger(__name__)
@dataclass(frozen=True)
class GatewayHealthResult:
    ok: bool
    payload: dict[str, Any]
    error: str | None = None


def gateway_health(timeout_s: int = 10) -> GatewayHealthResult:
    """Check gateway health using openclaw CLI."""
    exe = shutil.which("openclaw")
    if not exe:
        return GatewayHealthResult(ok=False, payload={}, error="openclaw CLI not found in PATH")
    try:
        p = subprocess.run(
            [exe, "gateway", "health", "--json"],
            capture_output=True,
            text=True,
            timeout=timeout_s,
            check=False,
        )
    except OSError as e:
        return GatewayHealthResult(ok=False, payload={}, error=f"openclaw CLI error: {e}")
    if p.returncode != 0:
        msg = (p.stderr or p.stdout or "").strip()
        return GatewayHealthResult(ok=False, payload={}, error=(msg or "gateway health failed"))
    try:
        data = json.loads((p.stdout or "").strip() or "{}")
    except Exception as e:
        return GatewayHealthResult(ok=False, payload={}, error=f"invalid json: {e}")
    return GatewayHealthResult(ok=True, payload=data)