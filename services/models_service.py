from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Mapping

from services.shared import SENSITIVE_KEY_SUBSTRINGS

MODELS_PATCH_TOP_LEVEL_FIELDS = frozenset({"providers"})
MODELS_PATCH_PROVIDER_FIELDS = frozenset({"baseUrl", "api", "authHeader", "models"})

__all__ = [
    "_validate_model_patch_no_sensitive_keys",
    "_validate_agent_models_update",
    "_apply_agent_models_patch",
    "_agent_models_path",
    "_discover_agent_model_paths",
]


def _validate_model_patch_no_sensitive_keys(value: Any, *, path: str = "") -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            key_str = str(key)
            key_lower = key_str.lower()
            if any(marker in key_lower for marker in SENSITIVE_KEY_SUBSTRINGS):
                raise ValueError(f"sensitive field is not patchable: {path + key_str}")
            _validate_model_patch_no_sensitive_keys(item, path=f"{path}{key_str}.")
        return
    if isinstance(value, list):
        for idx, item in enumerate(value):
            _validate_model_patch_no_sensitive_keys(item, path=f"{path}[{idx}].")


def _validate_agent_models_update(update: Any) -> dict[str, Any]:
    if not isinstance(update, dict) or not update:
        raise ValueError("agent models update must be a non-empty object")

    unknown_top_level = sorted(set(update.keys()) - MODELS_PATCH_TOP_LEVEL_FIELDS)
    if unknown_top_level:
        raise ValueError(f"unsupported models update fields: {', '.join(unknown_top_level)}")

    providers = update.get("providers")
    if not isinstance(providers, dict) or not providers:
        raise ValueError("providers must be a non-empty object")

    normalized: dict[str, Any] = {"providers": {}}
    for provider_name, provider_patch in providers.items():
        name = str(provider_name).strip()
        if not name:
            raise ValueError("provider name cannot be empty")
        if not isinstance(provider_patch, dict) or not provider_patch:
            raise ValueError(f"provider patch for {name} must be a non-empty object")

        unknown_provider_fields = sorted(set(provider_patch.keys()) - MODELS_PATCH_PROVIDER_FIELDS)
        if unknown_provider_fields:
            raise ValueError(f"unsupported provider fields for {name}: {', '.join(unknown_provider_fields)}")

        provider_next: dict[str, Any] = {}
        if "baseUrl" in provider_patch:
            base_url = provider_patch["baseUrl"]
            if not isinstance(base_url, str) or not base_url.strip():
                raise ValueError(f"providers.{name}.baseUrl must be a non-empty string")
            provider_next["baseUrl"] = base_url.strip()

        if "api" in provider_patch:
            api = provider_patch["api"]
            if not isinstance(api, str) or not api.strip():
                raise ValueError(f"providers.{name}.api must be a non-empty string")
            provider_next["api"] = api.strip()

        if "authHeader" in provider_patch:
            auth_header = provider_patch["authHeader"]
            if not isinstance(auth_header, bool):
                raise ValueError(f"providers.{name}.authHeader must be a boolean")
            provider_next["authHeader"] = auth_header

        if "models" in provider_patch:
            models = provider_patch["models"]
            if not isinstance(models, list):
                raise ValueError(f"providers.{name}.models must be an array")
            provider_next["models"] = models

        if not provider_next:
            raise ValueError(f"provider patch for {name} cannot be empty")

        _validate_model_patch_no_sensitive_keys(provider_next, path=f"providers.{name}.")
        normalized["providers"][name] = provider_next

    return normalized


def _apply_agent_models_patch(
    current_payload: Mapping[str, Any],
    update: Mapping[str, Any],
) -> tuple[dict[str, Any], list[str]]:
    patched: dict[str, Any] = json.loads(json.dumps(current_payload))
    providers = patched.get("providers")
    if not isinstance(providers, dict):
        providers = {}
        patched["providers"] = providers

    summaries: list[str] = []
    update_providers = update.get("providers")
    if isinstance(update_providers, dict):
        for provider_name, provider_patch in update_providers.items():
            existing_provider = providers.get(provider_name)
            if not isinstance(existing_provider, dict):
                existing_provider = {}
                providers[provider_name] = existing_provider
            for field, value in provider_patch.items():
                existing_provider[field] = value
            summaries.append(f"provider {provider_name}: {', '.join(sorted(provider_patch.keys()))}")

    return patched, summaries


def _agent_models_path(openclaw_root: Path, agent_id: str) -> Path:
    return openclaw_root / "agents" / agent_id / "agent" / "models.json"


def _discover_agent_model_paths(openclaw_root: Path) -> dict[str, Path]:
    out: dict[str, Path] = {}
    agents_dir = openclaw_root / "agents"
    if not agents_dir.is_dir():
        return out
    with os.scandir(agents_dir) as entries:
        for entry in entries:
            if not entry.is_dir():
                continue
            models_path = Path(entry.path) / "agent" / "models.json"
            if models_path.is_file():
                out[entry.name] = models_path
    return out
