from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

DISPATCH_DIAGNOSIS_DISCLAIMER = "Diagnosis is based on current known configuration rules..."

from services.config_service import _load_openclaw_config_payload


def explain_dispatch(hypothetical: Mapping[str, Any], openclaw_root: Path) -> dict[str, Any]:
    payload = dict(hypothetical)
    channel = str(payload.get("channel") or "").strip()
    account_id = str(payload.get("accountId") or payload.get("account_id") or "").strip()
    tool_name = str(payload.get("tool") or payload.get("toolName") or "").strip()
    requested_agent_id = str(payload.get("agentId") or payload.get("agent_id") or "").strip()

    blockers: list[dict[str, Any]] = []
    suggested_fixes: list[dict[str, Any]] = []

    try:
        _, config_payload, _ = _load_openclaw_config_payload(openclaw_root)
    except Exception as exc:
        return {
            "allowed": False,
            "resolvedAgentId": None,
            "blockers": [
                {
                    "code": "CONFIG_UNAVAILABLE",
                    "reason": f"Failed to load openclaw.json: {exc}",
                    "configPath": "openclaw.json",
                    "field": "<root>",
                }
            ],
            "suggestedFixes": [
                {
                    "summary": "Ensure openclaw.json is readable and valid JSON",
                    "configPath": "openclaw.json",
                    "field": "<root>",
                }
            ],
            "disclaimer": DISPATCH_DIAGNOSIS_DISCLAIMER,
            "confidence": 0.3,
        }

    bindings = config_payload.get("bindings")
    bindings_list = bindings if isinstance(bindings, list) else []
    matched_binding: Mapping[str, Any] | None = None
    if channel and account_id:
        for entry in bindings_list:
            if not isinstance(entry, Mapping):
                continue
            match_obj = entry.get("match")
            if not isinstance(match_obj, Mapping):
                continue
            if str(match_obj.get("channel") or "").strip() != channel:
                continue
            if str(match_obj.get("accountId") or "").strip() != account_id:
                continue
            matched_binding = entry
            break

    resolved_agent_id = requested_agent_id
    if not resolved_agent_id and matched_binding is not None:
        resolved_agent_id = str(matched_binding.get("agentId") or "").strip()

    if channel and account_id and matched_binding is None:
        blockers.append(
            {
                "code": "BINDING_NOT_FOUND",
                "reason": f"No binding matches channel={channel} and accountId={account_id}",
                "configPath": "openclaw.json",
                "field": "bindings",
            }
        )
        suggested_fixes.append(
            {
                "summary": "Add or update a binding for this channel/account pair",
                "configPath": "openclaw.json",
                "field": "bindings[]",
                "suggestedValue": {"agentId": "<agent-id>", "match": {"channel": channel, "accountId": account_id}},
            }
        )

    if requested_agent_id and matched_binding is not None:
        bound_agent_id = str(matched_binding.get("agentId") or "").strip()
        if bound_agent_id and bound_agent_id != requested_agent_id:
            blockers.append(
                {
                    "code": "BINDING_AGENT_MISMATCH",
                    "reason": f"Binding routes this dispatch to {bound_agent_id}, not {requested_agent_id}",
                    "configPath": "openclaw.json",
                    "field": "bindings[]",
                }
            )
            suggested_fixes.append(
                {
                    "summary": "Update binding agentId or dispatch to the bound agent",
                    "configPath": "openclaw.json",
                    "field": "bindings[].agentId",
                    "suggestedValue": requested_agent_id,
                }
            )

    agents_obj = config_payload.get("agents")
    agents_cfg = agents_obj if isinstance(agents_obj, Mapping) else {}
    agents_list_raw = agents_cfg.get("list")
    agents_list = agents_list_raw if isinstance(agents_list_raw, list) else []
    agent_by_id: dict[str, Mapping[str, Any]] = {}
    for entry in agents_list:
        if isinstance(entry, Mapping):
            agent_id = str(entry.get("id") or "").strip()
            if agent_id:
                agent_by_id[agent_id] = entry

    target_agent = agent_by_id.get(resolved_agent_id) if resolved_agent_id else None
    if resolved_agent_id and target_agent is None:
        blockers.append(
            {
                "code": "AGENT_NOT_FOUND",
                "reason": f"Configured agent '{resolved_agent_id}' does not exist",
                "configPath": "openclaw.json",
                "field": "agents.list",
            }
        )
        suggested_fixes.append(
            {
                "summary": "Use an existing agent id or add this agent definition",
                "configPath": "openclaw.json",
                "field": "agents.list[].id",
                "suggestedValue": resolved_agent_id,
            }
        )

    channels_obj = config_payload.get("channels")
    channels_cfg = channels_obj if isinstance(channels_obj, Mapping) else {}
    if channel:
        channel_cfg = channels_cfg.get(channel)
        if not isinstance(channel_cfg, Mapping):
            blockers.append(
                {
                    "code": "CHANNEL_CONFIG_MISSING",
                    "reason": f"Channel '{channel}' is not configured",
                    "configPath": "openclaw.json",
                    "field": f"channels.{channel}",
                }
            )
            suggested_fixes.append(
                {
                    "summary": "Define this channel configuration",
                    "configPath": "openclaw.json",
                    "field": f"channels.{channel}",
                }
            )
        else:
            if channel_cfg.get("enabled") is False:
                blockers.append(
                    {
                        "code": "CHANNEL_DISABLED",
                        "reason": f"Channel '{channel}' is disabled",
                        "configPath": "openclaw.json",
                        "field": f"channels.{channel}.enabled",
                    }
                )
                suggested_fixes.append(
                    {
                        "summary": "Enable the channel for routing",
                        "configPath": "openclaw.json",
                        "field": f"channels.{channel}.enabled",
                        "suggestedValue": True,
                    }
                )

            if account_id:
                accounts = channel_cfg.get("accounts")
                account_cfg = accounts.get(account_id) if isinstance(accounts, Mapping) else None
                if account_cfg is None:
                    blockers.append(
                        {
                            "code": "ACCOUNT_NOT_FOUND",
                            "reason": f"Account '{account_id}' is not configured for channel '{channel}'",
                            "configPath": "openclaw.json",
                            "field": f"channels.{channel}.accounts",
                        }
                    )
                    suggested_fixes.append(
                        {
                            "summary": "Add this account under the channel accounts map",
                            "configPath": "openclaw.json",
                            "field": f"channels.{channel}.accounts.{account_id}",
                        }
                    )

    if tool_name and target_agent is not None:
        tools_obj = target_agent.get("tools")
        tools_cfg = tools_obj if isinstance(tools_obj, Mapping) else {}
        deny_raw = tools_cfg.get("deny")
        deny_tools = [str(item) for item in deny_raw] if isinstance(deny_raw, list) else []
        if tool_name in deny_tools:
            blockers.append(
                {
                    "code": "TOOL_DENIED",
                    "reason": f"Tool '{tool_name}' is denied for agent '{resolved_agent_id}'",
                    "configPath": "openclaw.json",
                    "field": f"agents.list[id={resolved_agent_id}].tools.deny",
                }
            )
            suggested_fixes.append(
                {
                    "summary": "Remove the tool from deny list or dispatch via another agent",
                    "configPath": "openclaw.json",
                    "field": f"agents.list[id={resolved_agent_id}].tools.deny",
                    "suggestedValue": [item for item in deny_tools if item != tool_name],
                }
            )

    allowed = len(blockers) == 0
    confidence = 0.86 if allowed else 0.74
    return {
        "allowed": allowed,
        "resolvedAgentId": resolved_agent_id or None,
        "blockers": blockers,
        "suggestedFixes": suggested_fixes,
        "disclaimer": DISPATCH_DIAGNOSIS_DISCLAIMER,
        "confidence": confidence,
    }
