from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import time
import uuid

from core.utils import get_openclaw_root
from pathlib import Path
from typing import Any

SENSITIVE_KEY_SUBSTRINGS = (
    "token", "secret", "password", "api_key", "apikey",
    "authorization", "auth", "credential", "access_token",
    "refresh_token", "bearer", "jwt",
)

__all__ = [
    "redact_sensitive_data",
    "_get_openclaw_root",
    "_read_json_file",
    "sha256_hex",
    "atomic_replace",
    "write_bytes_atomic",
    "parse_jsonl_file",
    "_ts_ms_from_any",
    "_iso_from_ms",
]


def redact_sensitive_data(value: Any) -> Any:
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            key_str = str(key)
            if any(marker in key_str.lower() for marker in SENSITIVE_KEY_SUBSTRINGS):
                redacted[key_str] = "[REDACTED]"
            else:
                redacted[key_str] = redact_sensitive_data(item)
        return redacted
    if isinstance(value, list):
        return [redact_sensitive_data(item) for item in value]
    return value


def _get_openclaw_root() -> Path:
    """Return the OpenClaw root as a Path, delegating to core.utils."""
    return Path(get_openclaw_root())


def _read_json_file(path: Path) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def sha256_hex(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def atomic_replace(src_tmp: str, dst: str) -> None:
    for attempt in range(3):
        try:
            os.replace(src_tmp, dst)
            return
        except PermissionError:
            if attempt == 2:
                raise
            time.sleep(0.1 * (2**attempt))


def write_bytes_atomic(path: Path, content: bytes) -> None:
    tmp_path = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        tmp_path.write_bytes(content)
        atomic_replace(str(tmp_path), str(path))
    except Exception:
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except OSError:
            pass
        raise


def parse_jsonl_file(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    try:
        with path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(item, dict):
                    rows.append(item)
    except OSError:
        return []
    return rows


def _ts_ms_from_any(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return 0
        try:
            return int(stripped)
        except ValueError:
            pass
        iso_candidate = stripped.replace("Z", "+00:00")
        try:
            return int(dt.datetime.fromisoformat(iso_candidate).timestamp() * 1000)
        except ValueError:
            return 0
    return 0


def _iso_from_ms(value: Any) -> str | None:
    if value is None:
        return None
    try:
        ts_ms = int(value)
    except (TypeError, ValueError):
        return None
    return (
        dt.datetime.fromtimestamp(ts_ms / 1000, tz=dt.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )
