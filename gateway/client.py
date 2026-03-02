"""Gateway client for RP turn execution via OpenClaw Gateway.

Uses stdlib http.client only. The OPENCLAW_GATEWAY_TOKEN stays backend-only
and is NEVER exposed to the frontend or logged.
"""

from __future__ import annotations

import logging
import http.client
import json
import os
import socket
from typing import Any
from urllib.parse import urlparse

logger = logging.getLogger(__name__)
from core.utils import load_config


def gateway_base_url(openclaw_root: str) -> str:
    """Return the gateway base URL from maids config, or default."""
    cfg = load_config(openclaw_root)
    return cfg.get("gatewayBaseUrl", "http://127.0.0.1:18789")


def resolve_engine_agent_id(openclaw_root: str) -> str:
    """Resolve the engine agent ID for RP turns.

    1. Check MAIDS_DASHBOARD_RP_ENGINE_AGENT_ID env var.
    2. Fall back to the agent with default==true in openclaw.json.
    3. Ultimate fallback: "maidenteacat".
    """
    env_id = os.environ.get("MAIDS_DASHBOARD_RP_ENGINE_AGENT_ID", "").strip()
    if env_id:
        return env_id

    config_path = os.path.join(openclaw_root, "openclaw.json")
    try:
        with open(config_path, encoding="utf-8") as f:
            config = json.load(f)
    except (OSError, json.JSONDecodeError):
        return "maidenteacat"

    agents = config.get("agents", {}).get("list", [])
    for agent in agents:
        if isinstance(agent, dict) and agent.get("default"):
            return str(agent.get("id", "maidenteacat"))

    return "maidenteacat"


def call_gateway_rp_turn(
    room_id: str,
    character_id: str,
    messages: list[dict[str, str]],
    *,
    agent_id: str | None = None,
    openclaw_root: str | None = None,
    timeout_s: int = 60,
) -> dict[str, Any]:
    """Execute one RP turn via the OpenClaw Gateway.

    POSTs to {gatewayBaseUrl}/v1/chat/completions with proper auth headers.
    Returns {"ok": True, "content": "..."} or {"ok": False, "error": "..."}.

    The gateway token (OPENCLAW_GATEWAY_TOKEN) is read from env and NEVER
    returned in the response or logged.
    """
    # Resolve openclaw root
    if openclaw_root is None:
        openclaw_root = os.environ.get(
            "OPENCLAW_ROOT",
            os.path.dirname(
                os.path.dirname(
                    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                )
            ),
        )

    # Resolve engine agent ID
    engine_id = agent_id or resolve_engine_agent_id(openclaw_root)

    # Resolve gateway URL
    base_url = gateway_base_url(openclaw_root)
    parsed = urlparse(base_url)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or (443 if parsed.scheme == "https" else 18789)
    use_https = parsed.scheme == "https"

    # Read token from env (NEVER expose)
    token = os.environ.get("OPENCLAW_GATEWAY_TOKEN", "")

    # Build request body
    body = json.dumps(
        {
            "model": f"openclaw:{engine_id}",
            "stream": False,
            "messages": messages,
            "max_tokens": 2048,
        }
    ).encode("utf-8")

    # Build headers
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
        "x-openclaw-agent-id": engine_id,
        "x-openclaw-session-key": f"rp:{room_id}:{character_id}",
    }

    # Make the HTTP request using stdlib http.client
    try:
        if use_https:
            conn = http.client.HTTPSConnection(host, port, timeout=timeout_s)
        else:
            conn = http.client.HTTPConnection(host, port, timeout=timeout_s)

        conn.request("POST", "/v1/chat/completions", body=body, headers=headers)
        resp = conn.getresponse()
        raw = resp.read()
        conn.close()
    except socket.timeout:
        return {"ok": False, "error": "gateway request timed out (60s)"}
    except OSError as e:
        return {"ok": False, "error": f"gateway connection error: {e}"}
    except Exception as e:
        return {"ok": False, "error": f"gateway request failed: {e}"}

    # Check HTTP status
    if resp.status != 200:
        # Don't leak raw gateway response — extract safe error info only
        try:
            err_data = json.loads(raw)
            err_msg = err_data.get("error", {})
            if isinstance(err_msg, dict):
                err_msg = err_msg.get("message", f"HTTP {resp.status}")
            elif not isinstance(err_msg, str):
                err_msg = f"HTTP {resp.status}"
        except (json.JSONDecodeError, Exception):
            err_msg = f"HTTP {resp.status}"
        return {"ok": False, "error": f"gateway error: {err_msg}"}

    # Parse response — extract only assistant text
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {"ok": False, "error": "invalid JSON in gateway response"}

    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return {"ok": False, "error": "unexpected gateway response structure"}

    if not isinstance(content, str):
        return {"ok": False, "error": "gateway returned non-string content"}

    return {"ok": True, "content": content}