from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from services.config_service import _load_openclaw_config_payload, append_config_audit
from services.maid_service import (
    _build_new_maid_config_entry,
    _create_maid_directories_and_templates,
    _is_valid_maid_id,
    _read_maids_from_config,
)
from services.shared import _get_openclaw_root, redact_sensitive_data, sha256_hex, write_bytes_atomic
from services.state import get_db

router = APIRouter(prefix="/api/v1", tags=["maids"])


@router.get("/maids")
def list_maids() -> dict[str, Any]:
    openclaw_root = _get_openclaw_root()
    maids = _read_maids_from_config(openclaw_root)
    return {"maids": redact_sensitive_data(maids)}


@router.get("/maids/registry")
def list_registry() -> dict[str, Any]:
    openclaw_root = _get_openclaw_root()
    maids = _read_maids_from_config(openclaw_root)
    return {"maids": redact_sensitive_data(maids), "count": len(maids)}


@router.post("/maids/register")
def register_maid(payload: dict[str, Any]) -> dict[str, Any]:
    agent_id = str(payload.get("id") or "").strip()
    if not _is_valid_maid_id(agent_id):
        raise HTTPException(status_code=400, detail={"error": "id must match ^[a-z][a-z0-9-]{1,31}$"})

    display_name = str(payload.get("displayName") or agent_id).strip()
    if not display_name:
        raise HTTPException(status_code=400, detail={"error": "displayName cannot be empty"})

    openclaw_root = _get_openclaw_root()
    try:
        config_path, config_payload, before_raw = _load_openclaw_config_payload(openclaw_root)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail={"error": "openclaw.json not found"})
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": f"failed to read openclaw.json: {exc}"})

    agents_config = config_payload.get("agents")
    if not isinstance(agents_config, dict):
        agents_config = {}
        config_payload["agents"] = agents_config

    agents_list = agents_config.get("list")
    if not isinstance(agents_list, list):
        agents_list = []
        agents_config["list"] = agents_list

    exists = any(isinstance(item, dict) and str(item.get("id") or "") == agent_id for item in agents_list)
    if exists:
        raise HTTPException(status_code=409, detail={"error": f"maid '{agent_id}' already exists"})

    created_paths: dict[str, str] | None = None
    try:
        created_paths = _create_maid_directories_and_templates(openclaw_root, agent_id, display_name)
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail={"error": str(exc)})
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": f"failed to create maid directories/templates: {exc}"})

    new_entry = _build_new_maid_config_entry(agent_id, display_name, openclaw_root)
    agents_list.append(new_entry)

    after_raw = __import__("json").dumps(config_payload, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"
    try:
        write_bytes_atomic(config_path, after_raw)
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": f"failed to write openclaw.json: {exc}"})

    db = get_db()
    if db is not None:
        append_config_audit(
            db,
            kind="maids.register",
            path=str(config_path),
            before_sha256=sha256_hex(before_raw),
            after_sha256=sha256_hex(after_raw),
            summary=f"registered maid {agent_id}",
        )

    return {
        "ok": True,
        "maid": {
            "id": agent_id,
            "displayName": display_name,
        },
        "created": created_paths,
    }
