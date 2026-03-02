from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

OBSERVABILITY_BLOCKED_BASENAMES = frozenset({"MEMORY.md", "auth.json", "auth-profiles.json"})

from services.shared import _read_json_file, redact_sensitive_data

__all__ = [
    "_read_all_sessions",
    "_redact_transcript_entry",
    "_read_transcript_page",
]


def _safe_int(raw: str | None, default: int) -> int:
    try:
        return int(raw) if raw is not None else default
    except Exception:
        return default


def _read_all_sessions(openclaw_root: Path) -> list[dict[str, Any]]:
    sessions: list[dict[str, Any]] = []
    agents_dir = openclaw_root / "agents"
    if not agents_dir.is_dir():
        return sessions

    with os.scandir(agents_dir) as agent_entries:
        for agent_entry in agent_entries:
            if not agent_entry.is_dir():
                continue

            agent_id = agent_entry.name
            sessions_path = Path(agent_entry.path) / "sessions" / "sessions.json"
            if sessions_path.name in OBSERVABILITY_BLOCKED_BASENAMES:
                continue
            if not sessions_path.is_file():
                continue

            sessions_data = _read_json_file(sessions_path)
            if not isinstance(sessions_data, dict):
                continue

            for session_key, raw_entry in sessions_data.items():
                if not isinstance(raw_entry, dict):
                    continue
                sessions.append(
                    {
                        "agentId": agent_id,
                        "sessionKey": str(session_key),
                        "sessionId": raw_entry.get("sessionId"),
                        "updatedAt": raw_entry.get("updatedAt"),
                        "modelProvider": raw_entry.get("modelProvider"),
                        "model": raw_entry.get("model"),
                    }
                )

    sessions.sort(key=lambda item: _safe_int(str(item.get("updatedAt")), 0), reverse=True)
    return sessions


def _redact_transcript_entry(entry: Any) -> Any:
    redacted = redact_sensitive_data(entry)
    if not isinstance(redacted, dict):
        return redacted

    message = redacted.get("message")
    if not isinstance(message, dict):
        return redacted

    if message.get("role") != "toolResult":
        return redacted

    if "content" in message:
        message["content"] = [{"type": "text", "text": "[REDACTED_TOOL_RESULT]"}]
    if "details" in message:
        message["details"] = "[REDACTED_TOOL_RESULT]"
    return redacted


def _read_transcript_page(
    openclaw_root: Path,
    agent_id: str,
    session_id: str,
    *,
    offset: int,
    limit: int,
) -> tuple[list[dict[str, Any]], bool] | None:
    transcript_name = f"{session_id}.jsonl"
    if transcript_name in OBSERVABILITY_BLOCKED_BASENAMES:
        return None

    transcript_path = openclaw_root / "agents" / agent_id / "sessions" / transcript_name
    if not transcript_path.is_file():
        return None

    rows: list[dict[str, Any]] = []
    has_more = False
    seen = 0

    with open(transcript_path, "r", encoding="utf-8") as fh:
        for raw_line in fh:
            line = raw_line.strip()
            if not line:
                continue

            try:
                entry = json.loads(line)
            except Exception:
                continue

            if not isinstance(entry, dict) or entry.get("type") != "message":
                continue

            if seen < offset:
                seen += 1
                continue

            if len(rows) >= limit:
                has_more = True
                break

            redacted_entry = _redact_transcript_entry(entry)
            if isinstance(redacted_entry, dict):
                rows.append(redacted_entry)
            seen += 1

    return rows, has_more
