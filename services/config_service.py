from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any, Mapping

from dashboard_backend import DEFAULT_CONFIG_PATH, DEFAULT_DASHBOARD_CONFIG

ALLOWED_WRITE_PATHS: tuple[str, ...] = (
    os.path.normpath(os.path.expanduser("~/.openclaw/workspace/maids/state")),
    os.path.normpath(os.path.expanduser("~/.openclaw/workspace/maids/config.json")),
)
from dashboard_db import DashboardDB

from services.shared import sha256_hex

__all__ = [
    "validate_file_path",
    "load_dashboard_config",
    "_load_openclaw_config_payload",
    "_serialize_json_payload",
    "_load_json_object_payload",
    "append_config_audit",
]


def validate_file_path(filepath: str) -> bool:
    resolved = os.path.normpath(os.path.realpath(filepath))
    return any(
        resolved == allowed or resolved.startswith(allowed + os.sep)
        for allowed in ALLOWED_WRITE_PATHS
    )


def load_dashboard_config(config_path: str = DEFAULT_CONFIG_PATH) -> dict[str, Any]:
    config = dict(DEFAULT_DASHBOARD_CONFIG)
    try:
        with open(config_path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            if data.get("dashboardBindHost"):
                config["dashboardBindHost"] = str(data["dashboardBindHost"])
            if data.get("dashboardPort") is not None:
                config["dashboardPort"] = int(data["dashboardPort"])
    except Exception:
        pass
    return config


def _load_openclaw_config_payload(openclaw_root: Path) -> tuple[Path, dict[str, Any], bytes]:
    config_path = openclaw_root / "openclaw.json"
    raw = config_path.read_bytes()
    payload = json.loads(raw.decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("openclaw.json payload must be an object")
    return config_path, payload, raw


def _serialize_json_payload(payload: Mapping[str, Any]) -> bytes:
    raw = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"
    json.loads(raw.decode("utf-8"))
    return raw


def _load_json_object_payload(path: Path) -> tuple[dict[str, Any], bytes, str]:
    if not path.exists():
        return {}, b"", "missing"
    raw = path.read_bytes()
    payload = json.loads(raw.decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} payload must be an object")
    return payload, raw, sha256_hex(raw)


def append_config_audit(
    db: DashboardDB,
    *,
    kind: str,
    path: str,
    before_sha256: str,
    after_sha256: str,
    summary: str,
) -> None:
    ts_ms = int(time.time() * 1000)
    with db.get_connection() as conn:
        conn.execute(
            "INSERT INTO config_audit(id, ts_ms, kind, path, before_sha256, after_sha256, summary) VALUES(?, ?, ?, ?, ?, ?, ?)",
            (
                str(uuid.uuid4()),
                ts_ms,
                kind,
                path,
                before_sha256,
                after_sha256,
                summary,
            ),
        )
        conn.commit()
