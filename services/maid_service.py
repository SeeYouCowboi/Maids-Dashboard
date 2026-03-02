from __future__ import annotations

import datetime as dt
import os
import shutil
from pathlib import Path
from typing import Any

import re

MAID_ID_RE = re.compile(r"^[a-z][a-z0-9-]{1,31}$")

MAID_WORKSPACE_TEMPLATE_FILES: dict[str, str] = {
    "AGENTS.md": "# AGENTS.md - workspace-{agent_id}\n\nHome workspace for `{agent_id}`.\n\n## Session Ritual\n\n1. Read `SOUL.md`\n2. Read `USER.md`\n3. Read recent `memory/YYYY-MM-DD.md` entries\n\n## Safety\n\n- Do not expose secrets\n- Avoid destructive actions without explicit confirmation\n",
    "SOUL.md": "# SOUL\n\nName: {display_name}\nAgent ID: {agent_id}\n\nDescribe personality, operating style, and boundaries here.\n",
    "USER.md": "# USER\n\nPrimary user profile for `{agent_id}`.\n\nTrack communication preferences and context here.\n",
    "HEARTBEAT.md": "# HEARTBEAT\n\n- Check for urgent mentions\n- Check calendar/events\n- Reply `HEARTBEAT_OK` if no action required\n",
    "IDENTITY.md": "# IDENTITY\n\n- Agent ID: `{agent_id}`\n- Display Name: {display_name}\n- Signature Emoji: :robot:\n",
    "TOOLS.md": "# TOOLS\n\nLocal notes, scripts, and utility references for `{agent_id}`.\n",
}

MAID_AGENT_TEMPLATE_FILES: dict[str, str] = {
    "auth.json": "{}\n",
    "auth-profiles.json": "{\n  \"version\": 1,\n  \"profiles\": {},\n  \"lastGood\": {},\n  \"usageStats\": {}\n}\n",
    "models.json": "{\n  \"providers\": {}\n}\n",
}

from services.shared import _read_json_file

__all__ = [
    "_read_maids_from_config",
    "_build_new_maid_config_entry",
    "_render_template_text",
    "_create_maid_directories_and_templates",
    "_archive_and_remove_maid_paths",
    "_is_valid_maid_id",
    "_resolve_local_path",
    "_ensure_path_under_root",
    "_maid_presence",
]


def _is_valid_maid_id(agent_id: str) -> bool:
    return bool(MAID_ID_RE.match(agent_id))


def _resolve_local_path(raw_path: Any, openclaw_root: Path) -> Path | None:
    if raw_path is None:
        return None
    text = str(raw_path).strip()
    if not text:
        return None
    candidate = Path(os.path.expanduser(text))
    if not candidate.is_absolute():
        candidate = (openclaw_root / candidate).resolve()
    return candidate


def _ensure_path_under_root(path: Path, openclaw_root: Path) -> None:
    path_real = path.resolve()
    root_real = openclaw_root.resolve()
    if path_real != root_real and root_real not in path_real.parents:
        raise ValueError(f"Path '{path_real}' escapes openclaw root")


def _maid_presence(workspace_path: Any, agent_dir: Any, openclaw_root: Path) -> dict[str, Any]:
    workspace_resolved = _resolve_local_path(workspace_path, openclaw_root)
    agent_dir_resolved = _resolve_local_path(agent_dir, openclaw_root)

    sessions_resolved: Path | None = None
    if agent_dir_resolved is not None:
        sessions_resolved = agent_dir_resolved.parent / "sessions"

    workspace_exists = workspace_resolved.is_dir() if workspace_resolved is not None else False
    agent_dir_exists = agent_dir_resolved.is_dir() if agent_dir_resolved is not None else False
    sessions_exists = sessions_resolved.is_dir() if sessions_resolved is not None else False

    return {
        "workspace": workspace_exists,
        "agentDir": agent_dir_exists,
        "sessionsDir": sessions_exists,
        "all": workspace_exists and agent_dir_exists and sessions_exists,
        "workspacePathResolved": str(workspace_resolved) if workspace_resolved is not None else None,
        "agentDirResolved": str(agent_dir_resolved) if agent_dir_resolved is not None else None,
    }


def _build_new_maid_config_entry(agent_id: str, display_name: str, openclaw_root: Path) -> dict[str, Any]:
    workspace_path = openclaw_root / f"workspace-{agent_id}"
    agent_dir = openclaw_root / "agents" / agent_id / "agent"
    return {
        "id": agent_id,
        "workspace": str(workspace_path),
        "agentDir": str(agent_dir),
        "memorySearch": {
            "enabled": True,
            "sources": [],
            "extraPaths": [],
        },
        "identity": {
            "name": display_name,
            "theme": f"Agent workspace for {display_name}",
            "emoji": ":robot:",
            "avatar": "avatars/default-agent.png",
        },
        "subagents": {
            "allowAgents": [],
        },
    }


def _render_template_text(template: str, *, agent_id: str, display_name: str) -> str:
    return template.format(agent_id=agent_id, display_name=display_name)


def _create_maid_directories_and_templates(openclaw_root: Path, agent_id: str, display_name: str) -> dict[str, str]:
    workspace_dir = openclaw_root / f"workspace-{agent_id}"
    memory_dir = workspace_dir / "memory"
    agent_root = openclaw_root / "agents" / agent_id
    agent_dir = agent_root / "agent"
    sessions_dir = agent_root / "sessions"

    targets = (workspace_dir, agent_root, agent_dir)
    for target in targets:
        if target.exists():
            raise FileExistsError(f"Target already exists: {target}")

    memory_dir.mkdir(parents=True, exist_ok=True)
    sessions_dir.mkdir(parents=True, exist_ok=True)

    for filename, template in MAID_WORKSPACE_TEMPLATE_FILES.items():
        content = _render_template_text(template, agent_id=agent_id, display_name=display_name)
        (workspace_dir / filename).write_text(content, encoding="utf-8")

    for filename, template in MAID_AGENT_TEMPLATE_FILES.items():
        content = _render_template_text(template, agent_id=agent_id, display_name=display_name)
        (agent_dir / filename).write_text(content, encoding="utf-8")

    return {
        "workspace": str(workspace_dir),
        "agentDir": str(agent_dir),
        "sessionsDir": str(sessions_dir),
    }


def _archive_and_remove_maid_paths(openclaw_root: Path, agent_id: str, paths: list[Path]) -> dict[str, Any]:
    archive_root = openclaw_root / "backups" / f"{dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d-%H%M%S')}-maid-{agent_id}"
    archive_root.mkdir(parents=True, exist_ok=False)

    archived: list[dict[str, str]] = []
    for path in paths:
        if not path.exists():
            continue
        _ensure_path_under_root(path, openclaw_root)
        rel = path.resolve().relative_to(openclaw_root.resolve())
        archive_dst = archive_root / rel
        archive_dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(path, archive_dst)
        shutil.rmtree(path)
        archived.append({"source": str(path), "archivedTo": str(archive_dst)})

    return {
        "archiveRoot": str(archive_root),
        "archived": archived,
    }


def _read_maids_from_config(openclaw_root: Path) -> list[dict[str, Any]]:
    config_path = openclaw_root / "openclaw.json"
    config_data = _read_json_file(config_path)
    if not isinstance(config_data, dict):
        return []

    agents_config = config_data.get("agents")
    if not isinstance(agents_config, dict):
        return []

    defaults = agents_config.get("defaults")
    defaults_obj = defaults if isinstance(defaults, dict) else {}
    defaults_workspace = defaults_obj.get("workspace")
    defaults_agent_dir = defaults_obj.get("agentDir")
    defaults_sandbox = defaults_obj.get("sandbox")
    defaults_sandbox_mode = (
        defaults_sandbox.get("mode") if isinstance(defaults_sandbox, dict) else "off"
    )

    bindings = config_data.get("bindings")
    bindings_list = bindings if isinstance(bindings, list) else []
    bindings_by_agent: dict[str, int] = {}
    for binding in bindings_list:
        if not isinstance(binding, dict):
            continue
        agent_id_raw = binding.get("agentId")
        if not isinstance(agent_id_raw, str):
            continue
        bindings_by_agent[agent_id_raw] = bindings_by_agent.get(agent_id_raw, 0) + 1

    agents_list = agents_config.get("list")
    if not isinstance(agents_list, list):
        return []

    maids: list[dict[str, Any]] = []
    for item in agents_list:
        if not isinstance(item, dict):
            continue
        agent_id = str(item.get("id") or "").strip()
        if not agent_id:
            continue

        identity = item.get("identity")
        identity_obj = identity if isinstance(identity, dict) else {}
        display_name = str(identity_obj.get("name") or agent_id)

        workspace_path = item.get("workspace")
        if workspace_path is None:
            workspace_path = defaults_workspace

        agent_dir = item.get("agentDir")
        if agent_dir is None:
            agent_dir = defaults_agent_dir

        sandbox_cfg = item.get("sandbox")
        sandbox_mode = (
            sandbox_cfg.get("mode") if isinstance(sandbox_cfg, dict) else defaults_sandbox_mode
        )

        subagents_cfg = item.get("subagents")
        allow_agents: list[str] = []
        if isinstance(subagents_cfg, dict):
            allow_raw = subagents_cfg.get("allowAgents")
            if isinstance(allow_raw, list):
                allow_agents = [str(value) for value in allow_raw]

        tools_cfg = item.get("tools")
        deny_count = 0
        if isinstance(tools_cfg, dict):
            deny = tools_cfg.get("deny")
            if isinstance(deny, list):
                deny_count = len(deny)

        maids.append(
            {
                "id": agent_id,
                "displayName": display_name,
                "workspacePath": str(workspace_path) if workspace_path is not None else None,
                "agentDir": str(agent_dir) if agent_dir is not None else None,
                "sandboxMode": str(sandbox_mode) if sandbox_mode is not None else "off",
                "allowAgents": allow_agents,
                "toolsDenyCount": deny_count,
                "bindingsCount": bindings_by_agent.get(agent_id, 0),
                "disabled": bindings_by_agent.get(agent_id, 0) == 0,
                "presence": _maid_presence(workspace_path, agent_dir, openclaw_root),
            }
        )

    return maids
