from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from dashboard_backend import DEFAULT_DASHBOARD_CONFIG
from services.session_service import _read_all_sessions
from services.shared import _get_openclaw_root, _iso_from_ms, redact_sensitive_data, sha256_hex, write_bytes_atomic
from services.config_service import (
    _load_json_object_payload,
    _load_openclaw_config_payload,
    _serialize_json_payload,
    append_config_audit,
)
from services.models_service import (
    _agent_models_path,
    _apply_agent_models_patch,
    _discover_agent_model_paths,
    _validate_agent_models_update,
)
from services.state import get_db

router = APIRouter(prefix="/api/v1", tags=["config"])

# --- Constants formerly in dashboard_backend.py ---
OPENCLAW_TYPED_PATCH_KINDS = frozenset({
    "binding.setAgentId",
    "defaults.model.setPrimary",
    "defaults.model.setFallbacks",
    "agent.setAllowAgents",
})
ALLOWED_DASHBOARD_BIND_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
OPENCLAW_PATCH_MAX_LIST_ITEMS = 64
OPENCLAW_PATCH_MAX_STRING_LEN = 256
DEFAULT_CONFIG_AUDIT_LIMIT = 50
MAX_CONFIG_AUDIT_LIMIT = 500


def _build_dashboard_config_view(config_payload: Mapping[str, Any]) -> dict[str, Any]:
    bind_host = config_payload.get("dashboardBindHost", DEFAULT_DASHBOARD_CONFIG["dashboardBindHost"])
    port = config_payload.get("dashboardPort", DEFAULT_DASHBOARD_CONFIG["dashboardPort"])
    return {
        "dashboardBindHost": bind_host,
        "dashboardPort": port,
    }


def _build_openclaw_safe_view(config_payload: Mapping[str, Any]) -> dict[str, Any]:
    bindings_raw = config_payload.get("bindings")
    bindings_list = bindings_raw if isinstance(bindings_raw, list) else []
    bindings: list[dict[str, Any]] = []
    for idx, entry in enumerate(bindings_list):
        if not isinstance(entry, dict):
            continue
        match = entry.get("match")
        match_obj = match if isinstance(match, dict) else {}
        bindings.append({
            "index": idx,
            "agentId": entry.get("agentId"),
            "match": {
                "channel": match_obj.get("channel"),
                "accountId": match_obj.get("accountId"),
            },
        })

    agents = config_payload.get("agents")
    agents_obj = agents if isinstance(agents, dict) else {}

    defaults = agents_obj.get("defaults")
    defaults_obj = defaults if isinstance(defaults, dict) else {}

    model_cfg = defaults_obj.get("model")
    model_obj = model_cfg if isinstance(model_cfg, dict) else {}
    model_fallbacks_raw = model_obj.get("fallbacks")
    model_fallbacks = (
        [str(item) for item in model_fallbacks_raw if isinstance(item, str)]
        if isinstance(model_fallbacks_raw, list)
        else []
    )

    agents_list_raw = agents_obj.get("list")
    agents_list = agents_list_raw if isinstance(agents_list_raw, list) else []
    allow_agents_items: list[dict[str, Any]] = []
    for item in agents_list:
        if not isinstance(item, dict):
            continue
        agent_id = item.get("id")
        if not isinstance(agent_id, str) or not agent_id.strip():
            continue
        subagents = item.get("subagents")
        subagents_obj = subagents if isinstance(subagents, dict) else {}
        allow_raw = subagents_obj.get("allowAgents")
        allow_list = (
            [str(value) for value in allow_raw if isinstance(value, str)]
            if isinstance(allow_raw, list)
            else []
        )
        allow_agents_items.append({
            "agentId": agent_id,
            "allowAgents": allow_list,
        })

    return {
        "bindings": bindings,
        "modelDefaults": {
            "primary": model_obj.get("primary"),
            "fallbacks": model_fallbacks,
        },
        "allowAgents": allow_agents_items,
    }


def _build_runtime_usage_by_agent(openclaw_root: Path) -> dict[str, dict[str, Any]]:
    sessions = _read_all_sessions(openclaw_root)
    runtime: dict[str, dict[str, Any]] = {}
    for session in sessions:
        agent_id = str(session.get("agentId") or "").strip()
        if not agent_id or agent_id in runtime:
            continue
        runtime[agent_id] = redact_sensitive_data({
            "sessionKey": session.get("sessionKey"),
            "sessionId": session.get("sessionId"),
            "modelProvider": session.get("modelProvider"),
            "model": session.get("model"),
            "updatedAt": session.get("updatedAt"),
            "updatedAtIso": _iso_from_ms(session.get("updatedAt")),
        })
    return runtime


def _merge_model_config(
    global_models: Mapping[str, Any],
    agent_override: Mapping[str, Any],
) -> dict[str, Any]:
    merged: dict[str, Any] = json.loads(json.dumps(global_models))
    merged_providers = merged.get("providers")
    if not isinstance(merged_providers, dict):
        merged_providers = {}
        merged["providers"] = merged_providers

    override_providers = agent_override.get("providers")
    if isinstance(override_providers, dict):
        for provider_name, provider_payload in override_providers.items():
            if isinstance(provider_payload, dict):
                merged_providers[provider_name] = provider_payload

    return merged


def _validate_openclaw_patch_string(field: str, value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    cleaned = value.strip()
    if not cleaned:
        raise ValueError(f"{field} cannot be empty")
    if len(cleaned) > OPENCLAW_PATCH_MAX_STRING_LEN:
        raise ValueError(f"{field} is too long")
    return cleaned


def _validate_openclaw_patch_string_list(field: str, value: Any) -> list[str]:
    if not isinstance(value, list):
        raise ValueError(f"{field} must be an array")
    if len(value) > OPENCLAW_PATCH_MAX_LIST_ITEMS:
        raise ValueError(f"{field} exceeds max size")
    normalized: list[str] = []
    seen: set[str] = set()
    for item in value:
        cleaned = _validate_openclaw_patch_string(field, item)
        if cleaned in seen:
            continue
        seen.add(cleaned)
        normalized.append(cleaned)
    return normalized


def _ensure_openclaw_agents_defaults_model(
    config_payload: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    agents = config_payload.get("agents")
    if not isinstance(agents, dict):
        agents = {}
        config_payload["agents"] = agents

    defaults = agents.get("defaults")
    if not isinstance(defaults, dict):
        defaults = {}
        agents["defaults"] = defaults

    model = defaults.get("model")
    if not isinstance(model, dict):
        model = {}
        defaults["model"] = model
    return agents, defaults, model


def _apply_dashboard_config_patch(
    config_payload: Mapping[str, Any],
    updates: Mapping[str, Any],
) -> tuple[dict[str, Any], list[str]]:
    if not updates:
        raise ValueError("dashboard updates cannot be empty")

    unknown_fields = sorted(set(updates.keys()) - set(DEFAULT_DASHBOARD_CONFIG.keys()))
    if unknown_fields:
        raise ValueError(f"unsupported dashboard updates fields: {', '.join(unknown_fields)}")

    patched: dict[str, Any] = json.loads(json.dumps(config_payload))
    summary_parts: list[str] = []

    if "dashboardBindHost" in updates:
        raw_host = updates["dashboardBindHost"]
        if not isinstance(raw_host, str):
            raise ValueError("dashboardBindHost must be a string")
        host = raw_host.strip()
        if host not in ALLOWED_DASHBOARD_BIND_HOSTS:
            raise ValueError("dashboardBindHost must be one of 127.0.0.1, localhost, ::1")
        before_host = patched.get("dashboardBindHost")
        patched["dashboardBindHost"] = host
        summary_parts.append(f"dashboardBindHost {before_host} -> {host}")

    if "dashboardPort" in updates:
        raw_port = updates["dashboardPort"]
        if not isinstance(raw_port, int):
            raise ValueError("dashboardPort must be an integer")
        if raw_port < 1 or raw_port > 65535:
            raise ValueError("dashboardPort must be between 1 and 65535")
        before_port = patched.get("dashboardPort")
        patched["dashboardPort"] = raw_port
        summary_parts.append(f"dashboardPort {before_port} -> {raw_port}")

    if not summary_parts:
        raise ValueError("dashboard updates cannot be empty")

    return patched, summary_parts


def _apply_openclaw_typed_patches(
    config_payload: Mapping[str, Any],
    patches: list[Any],
) -> tuple[dict[str, Any], list[str]]:
    if not patches:
        raise ValueError("patches cannot be empty")

    patched: dict[str, Any] = json.loads(json.dumps(config_payload))
    summaries: list[str] = []

    for idx, raw_patch in enumerate(patches):
        if not isinstance(raw_patch, dict):
            raise ValueError(f"patches[{idx}] must be an object")

        patch_kind = raw_patch.get("type")
        if not isinstance(patch_kind, str) or patch_kind not in OPENCLAW_TYPED_PATCH_KINDS:
            raise ValueError(f"patches[{idx}].type is not supported")

        if patch_kind == "binding.setAgentId":
            binding_index = raw_patch.get("bindingIndex")
            if not isinstance(binding_index, int) or binding_index < 0:
                raise ValueError(f"patches[{idx}].bindingIndex must be a non-negative integer")

            agent_id = _validate_openclaw_patch_string(f"patches[{idx}].agentId", raw_patch.get("agentId"))
            bindings = patched.get("bindings")
            if not isinstance(bindings, list):
                raise ValueError("openclaw.json bindings must be an array")
            if binding_index >= len(bindings):
                raise ValueError(f"patches[{idx}].bindingIndex out of range")
            target = bindings[binding_index]
            if not isinstance(target, dict):
                raise ValueError(f"patches[{idx}] points to invalid binding entry")

            before_agent_id = target.get("agentId")
            target["agentId"] = agent_id
            summaries.append(f"bindings[{binding_index}].agentId {before_agent_id} -> {agent_id}")
            continue

        if patch_kind == "defaults.model.setPrimary":
            _, _, model = _ensure_openclaw_agents_defaults_model(patched)
            primary = _validate_openclaw_patch_string(f"patches[{idx}].primary", raw_patch.get("primary"))
            before_primary = model.get("primary")
            model["primary"] = primary
            summaries.append(f"agents.defaults.model.primary {before_primary} -> {primary}")
            continue

        if patch_kind == "defaults.model.setFallbacks":
            _, _, model = _ensure_openclaw_agents_defaults_model(patched)
            fallbacks = _validate_openclaw_patch_string_list(f"patches[{idx}].fallbacks", raw_patch.get("fallbacks"))
            before_fallbacks = model.get("fallbacks")
            model["fallbacks"] = fallbacks
            summaries.append(f"agents.defaults.model.fallbacks {before_fallbacks} -> {fallbacks}")
            continue

        if patch_kind == "agent.setAllowAgents":
            agent_id = _validate_openclaw_patch_string(f"patches[{idx}].agentId", raw_patch.get("agentId"))
            allow_agents = _validate_openclaw_patch_string_list(
                f"patches[{idx}].allowAgents",
                raw_patch.get("allowAgents"),
            )

            agents = patched.get("agents")
            agents_obj = agents if isinstance(agents, dict) else {}
            agents_list = agents_obj.get("list")
            if not isinstance(agents_list, list):
                raise ValueError("openclaw.json agents.list must be an array")

            target_agent: dict[str, Any] | None = None
            for item in agents_list:
                if isinstance(item, dict) and item.get("id") == agent_id:
                    target_agent = item
                    break
            if target_agent is None:
                raise ValueError(f"patches[{idx}].agentId does not exist")

            subagents = target_agent.get("subagents")
            if not isinstance(subagents, dict):
                subagents = {}
                target_agent["subagents"] = subagents
            before_allow = subagents.get("allowAgents")
            subagents["allowAgents"] = allow_agents
            summaries.append(f"agents.list[{agent_id}].subagents.allowAgents {before_allow} -> {allow_agents}")
            continue

        raise ValueError(f"patches[{idx}].type is not supported")

    if not summaries:
        raise ValueError("patches cannot be empty")
    return patched, summaries


def _load_dashboard_config_payload() -> tuple[Path, dict[str, Any], bytes, str]:
    from dashboard_backend import DEFAULT_CONFIG_PATH

    path = Path(DEFAULT_CONFIG_PATH).expanduser()
    payload, raw, revision = _load_json_object_payload(path)
    return path, payload, raw, revision


@router.get("/config/openclaw")
def get_openclaw_config() -> dict[str, Any]:
    openclaw_root = _get_openclaw_root()
    try:
        config_path, payload, raw = _load_openclaw_config_payload(openclaw_root)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail={"error": "openclaw.json not found"})
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": f"failed to read openclaw.json: {exc}"})

    return {
        "path": str(config_path),
        "revision": sha256_hex(raw),
        "config": redact_sensitive_data(payload),
        "editable": _build_openclaw_safe_view(payload),
        "patchKinds": sorted(OPENCLAW_TYPED_PATCH_KINDS),
    }


@router.post("/config/openclaw/patch")
def patch_openclaw_config(payload: dict[str, Any]) -> dict[str, Any]:
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail={"error": "DB not initialized"})

    revision = payload.get("revision")
    if not isinstance(revision, str) or not revision:
        raise HTTPException(status_code=400, detail={"error": "revision must be a non-empty string"})

    if set(payload.keys()) != {"revision", "patches"}:
        raise HTTPException(status_code=400, detail={"error": "body must contain only {revision, patches}"})

    patches = payload.get("patches")
    if not isinstance(patches, list):
        raise HTTPException(status_code=400, detail={"error": "patches must be an array"})

    openclaw_root = _get_openclaw_root()
    try:
        config_path, config_payload, before_raw = _load_openclaw_config_payload(openclaw_root)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail={"error": "openclaw.json not found"})
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": f"failed to read openclaw.json: {exc}"})

    current_revision = sha256_hex(before_raw)
    if revision != current_revision:
        raise HTTPException(status_code=409, detail={"error": "revision mismatch", "expected_revision": current_revision})

    try:
        patched_payload, summary_parts = _apply_openclaw_typed_patches(config_payload, patches)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)})

    after_raw = json.dumps(patched_payload, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"
    if after_raw == before_raw:
        return {
            "ok": True,
            "revision": current_revision,
            "editable": _build_openclaw_safe_view(config_payload),
            "message": "No changes applied",
        }

    try:
        write_bytes_atomic(config_path, after_raw)
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": f"failed to write openclaw.json: {exc}"})

    after_revision = sha256_hex(after_raw)
    append_config_audit(
        db,
        kind="openclaw.config.patch",
        path=str(config_path),
        before_sha256=current_revision,
        after_sha256=after_revision,
        summary="; ".join(summary_parts),
    )
    return {"ok": True, "revision": after_revision, "editable": _build_openclaw_safe_view(patched_payload)}


@router.get("/config/models")
def get_models_config() -> dict[str, Any]:
    openclaw_root = _get_openclaw_root()
    try:
        _, openclaw_payload, _ = _load_openclaw_config_payload(openclaw_root)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail={"error": "openclaw.json not found"})
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": f"failed to read openclaw.json: {exc}"})

    global_models = openclaw_payload.get("models")
    global_models_obj = global_models if isinstance(global_models, dict) else {}

    agents = openclaw_payload.get("agents")
    agents_obj = agents if isinstance(agents, dict) else {}
    defaults = agents_obj.get("defaults")
    defaults_obj = defaults if isinstance(defaults, dict) else {}

    runtime_usage = _build_runtime_usage_by_agent(openclaw_root)
    per_agent: dict[str, Any] = {}
    for agent_id, models_path in _discover_agent_model_paths(openclaw_root).items():
        try:
            agent_payload, agent_raw, agent_revision = _load_json_object_payload(models_path)
        except Exception as exc:
            per_agent[agent_id] = {
                "path": str(models_path),
                "error": str(exc),
            }
            continue

        merged = _merge_model_config(global_models_obj, agent_payload)
        per_agent[agent_id] = redact_sensitive_data(
            {
                "path": str(models_path),
                "revision": agent_revision,
                "override": agent_payload,
                "merged": merged,
                "runtime": runtime_usage.get(agent_id),
                "sizeBytes": len(agent_raw),
            }
        )

    dashboard_path, dashboard_payload, dashboard_raw, dashboard_revision = _load_dashboard_config_payload()

    return {
        "globalDefaults": redact_sensitive_data(
            {
                "model": defaults_obj.get("model"),
                "models": defaults_obj.get("models"),
            }
        ),
        "globalModels": redact_sensitive_data(global_models_obj),
        "runtimeUsage": runtime_usage,
        "agents": per_agent,
        "dashboard": redact_sensitive_data(
            {
                "path": str(dashboard_path),
                "revision": dashboard_revision,
                "config": _build_dashboard_config_view(dashboard_payload),
                "sizeBytes": len(dashboard_raw),
            }
        ),
    }


@router.post("/config/models/patch")
def patch_models_config(payload: dict[str, Any]) -> dict[str, Any]:
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail={"error": "DB not initialized"})

    revision = payload.get("revision")
    if not isinstance(revision, dict):
        raise HTTPException(status_code=400, detail={"error": "revision must be an object"})

    updates = payload.get("updates")
    if not isinstance(updates, dict) or not updates:
        raise HTTPException(status_code=400, detail={"error": "updates must be a non-empty object"})

    openclaw_root = _get_openclaw_root()
    response_updates: dict[str, Any] = {"agents": {}}

    dashboard_updates = updates.get("dashboard")
    if dashboard_updates is not None:
        if not isinstance(dashboard_updates, dict):
            raise HTTPException(status_code=400, detail={"error": "updates.dashboard must be an object"})

        expected_dashboard_revision = revision.get("dashboard")
        if not isinstance(expected_dashboard_revision, str) or not expected_dashboard_revision:
            raise HTTPException(status_code=400, detail={"error": "revision.dashboard must be a non-empty string"})

        try:
            dashboard_path, dashboard_payload, dashboard_before_raw, dashboard_current_revision = _load_dashboard_config_payload()
        except Exception as exc:
            raise HTTPException(status_code=500, detail={"error": f"failed to read dashboard config: {exc}"})

        if expected_dashboard_revision != dashboard_current_revision:
            raise HTTPException(
                status_code=409,
                detail={"error": "revision mismatch for dashboard config", "expected_revision": dashboard_current_revision},
            )

        try:
            patched_dashboard, dashboard_summary = _apply_dashboard_config_patch(dashboard_payload, dashboard_updates)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)})

        dashboard_after_raw = _serialize_json_payload(patched_dashboard)
        dashboard_after_revision = sha256_hex(dashboard_after_raw)

        if dashboard_after_raw != dashboard_before_raw:
            dashboard_path.parent.mkdir(parents=True, exist_ok=True)
            try:
                write_bytes_atomic(dashboard_path, dashboard_after_raw)
            except Exception as exc:
                raise HTTPException(status_code=500, detail={"error": f"failed to write dashboard config: {exc}"})

            append_config_audit(
                db,
                kind="dashboard.config.patch",
                path=str(dashboard_path),
                before_sha256=dashboard_current_revision,
                after_sha256=dashboard_after_revision,
                summary="; ".join(dashboard_summary),
            )

        response_updates["dashboard"] = redact_sensitive_data(
            {
                "path": str(dashboard_path),
                "revision": dashboard_after_revision,
                "config": _build_dashboard_config_view(patched_dashboard),
            }
        )

    agent_updates = updates.get("agents")
    if agent_updates is not None:
        if not isinstance(agent_updates, dict) or not agent_updates:
            raise HTTPException(status_code=400, detail={"error": "updates.agents must be a non-empty object"})

        revision_agents = revision.get("agents")
        if not isinstance(revision_agents, dict):
            raise HTTPException(status_code=400, detail={"error": "revision.agents must be an object"})

        for raw_agent_id, raw_update in agent_updates.items():
            agent_id = str(raw_agent_id).strip()
            if not agent_id or any(marker in agent_id for marker in ("..", "/", "\\")):
                raise HTTPException(status_code=400, detail={"error": f"invalid agent id: {raw_agent_id}"})

            expected_agent_revision = revision_agents.get(agent_id)
            if not isinstance(expected_agent_revision, str) or not expected_agent_revision:
                raise HTTPException(status_code=400, detail={"error": f"revision.agents.{agent_id} must be a non-empty string"})

            try:
                validated_update = _validate_agent_models_update(raw_update)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail={"error": str(exc)})

            models_path = _agent_models_path(openclaw_root, agent_id)
            try:
                before_payload, before_raw, current_revision = _load_json_object_payload(models_path)
            except ValueError as exc:
                raise HTTPException(status_code=500, detail={"error": str(exc)})
            except Exception as exc:
                raise HTTPException(status_code=500, detail={"error": f"failed to read {models_path}: {exc}"})

            if expected_agent_revision != current_revision:
                raise HTTPException(
                    status_code=409,
                    detail={"error": f"revision mismatch for agent {agent_id}", "expected_revision": current_revision},
                )

            patched_payload, summary_parts = _apply_agent_models_patch(before_payload, validated_update)
            after_raw = _serialize_json_payload(patched_payload)
            after_revision = sha256_hex(after_raw)

            if after_raw != before_raw:
                models_path.parent.mkdir(parents=True, exist_ok=True)
                try:
                    write_bytes_atomic(models_path, after_raw)
                except Exception as exc:
                    raise HTTPException(status_code=500, detail={"error": f"failed to write {models_path}: {exc}"})

                append_config_audit(
                    db,
                    kind="agent.models.patch",
                    path=str(models_path),
                    before_sha256=current_revision,
                    after_sha256=after_revision,
                    summary=f"agent {agent_id}: {'; '.join(summary_parts)}",
                )

            response_updates["agents"][agent_id] = redact_sensitive_data(
                {
                    "path": str(models_path),
                    "revision": after_revision,
                    "override": patched_payload,
                }
            )

    if "dashboard" not in response_updates and not response_updates["agents"]:
        raise HTTPException(status_code=400, detail={"error": "No supported updates provided"})

    return {"ok": True, "updated": response_updates}


@router.get("/config/audit")
def get_config_audit(request: Request) -> dict[str, Any]:


    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail={"error": "DB not initialized"})

    raw_limit = request.query_params.get("limit", str(DEFAULT_CONFIG_AUDIT_LIMIT))
    try:
        parsed = int(raw_limit)
    except Exception:
        parsed = DEFAULT_CONFIG_AUDIT_LIMIT
    limit = min(max(parsed, 1), MAX_CONFIG_AUDIT_LIMIT)

    with db.get_connection() as conn:
        rows = conn.execute(
            "SELECT id, ts_ms, kind, path, before_sha256, after_sha256, summary FROM config_audit ORDER BY ts_ms DESC LIMIT ?",
            (limit,),
        ).fetchall()

    entries = [
        {
            "id": row["id"],
            "ts_ms": row["ts_ms"],
            "kind": row["kind"],
            "path": row["path"],
            "before_sha256": row["before_sha256"],
            "after_sha256": row["after_sha256"],
            "summary": row["summary"],
        }
        for row in rows
    ]
    return {"entries": entries, "count": len(entries)}
