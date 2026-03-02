# Maids Dashboard - Operator Runbook

## Overview

Maids Dashboard is a local-only unified control plane for OpenClaw work and roleplay. It provides a web UI for monitoring agent sessions, dispatching RP turns, managing characters and lorebooks, viewing system metrics, and controlling cron schedules. It binds exclusively to `127.0.0.1` and is never meant to be exposed to the network.

---

## Required Environment Variables

### `OPENCLAW_ROOT`

Path to the openclaw root directory.

- Default: `~/.openclaw` (resolved at startup)
- Example: `set OPENCLAW_ROOT=C:\Users\TeaCat\.openclaw`

### `OPENCLAW_GATEWAY_TOKEN`

Bearer token for authenticating with the OpenClaw gateway. This is used server-side only. The browser never sees it.

- **NEVER log or expose this value.**
- Found in `openclaw.json` under `gateway.auth.token`
- Example: `set OPENCLAW_GATEWAY_TOKEN=your_token_here`

### `MAIDS_DASHBOARD_CONFIRM_SECRET`

Required for ALL write operations (POST/PATCH/DELETE). If this is not set, every mutating request returns 403.

- The frontend stores this in `sessionStorage` only (evicted when the tab closes)
- Example: `set MAIDS_DASHBOARD_CONFIRM_SECRET=my-secret-value`

---

## Optional Environment Variables

### `MAIDS_DASHBOARD_MAX_SSE_CLIENTS`

Maximum number of concurrent SSE connections. New connections beyond this cap receive 503.

- Default: `10`
- Example: `set MAIDS_DASHBOARD_MAX_SSE_CLIENTS=5`

### `MAIDS_DASHBOARD_RP_TRANSCRIPT_WINDOW`

Maximum number of messages included per RP turn context window. Values below 5 are clamped to 5.

- Default: `30`
- Example: `set MAIDS_DASHBOARD_RP_TRANSCRIPT_WINDOW=50`

### `MAIDS_DASHBOARD_RP_ENGINE_AGENT_ID`

Override which agent handles RP gateway calls. By default the dashboard auto-detects the first agent marked `default: true` in `openclaw.json`.

- Default: auto-detected from `openclaw.json`
- Example: `set MAIDS_DASHBOARD_RP_ENGINE_AGENT_ID=maidenteacat`

---

## Starting the Dashboard

**Step 1: Ensure the OpenClaw gateway is running.**

The dashboard proxies several calls through the gateway. Nothing works correctly if the gateway is down.

**Step 2: Set required environment variables.**

```powershell
set OPENCLAW_ROOT=C:\Users\TeaCat\.openclaw
set OPENCLAW_GATEWAY_TOKEN=your_token_here
set MAIDS_DASHBOARD_CONFIRM_SECRET=your_secret_here
```

**Step 3: Start the backend.**

```bash
cd workspace/tools/maids-dashboard
python dashboard_backend.py
```

The server binds to `127.0.0.1:18889`.

**Step 4: Open the dashboard in a browser.**

```
http://127.0.0.1:18889/
```

---

## Health Checks

### Dashboard health

```bash
# curl
curl http://127.0.0.1:18889/api/v1/health

# PowerShell
Invoke-RestMethod http://127.0.0.1:18889/api/v1/health
```

Returns status for the database, event bus, and SSE subsystem.

### Gateway connectivity

```bash
# curl
curl http://127.0.0.1:18889/api/v1/gateway/health

# PowerShell
Invoke-RestMethod http://127.0.0.1:18889/api/v1/gateway/health
```

Proxies a health ping to the OpenClaw gateway and reports back.

---

## Feature Reference

### Grand Hall

The main overview screen. Shows all agents, their current sessions, recent activity, and connection status at a glance.

### Observatory

Metrics, event log, and activity timeline. Includes plot branch inspector for reviewing RP story structure.

### War Room

Surfaces dispatch failures and agent conflicts. Use this when something went wrong and you need to see what failed and why.

### Garden

Cron job toggles, heartbeat configuration, and general settings. Enable or disable scheduled tasks without touching config files.

### Library

RP world management: characters, lorebook entries, and plot graph. Supports Character Card V2 import/export, keyword/regex lorebook triggers, and branching plot nodes.

### Kitchen

RP commit editor. Review and edit AI-generated RP turns before they're committed to canon. Useful for quality control or light revision.

### Ballroom

Multi-agent RP group chat. Create rooms, add participants, send messages. The dashboard fans out each message to all participant agents via the gateway and broadcasts responses over SSE.

### Stats

Usage analytics: model call histogram, cron job reliability, delivery retry distribution, and RP activity summary.

---

## Security Notes

**Gateway token stays server-side.** `OPENCLAW_GATEWAY_TOKEN` is read from the environment at startup and used only in backend-to-gateway calls. The browser never receives it, and it's never included in API responses.

**All writes require a confirm secret.** Every POST/PATCH/DELETE endpoint checks the `X-Confirm-Secret` header against `MAIDS_DASHBOARD_CONFIRM_SECRET`. Missing or wrong secret returns 403.

**Session storage only.** The frontend stores the confirm secret in `sessionStorage`. It's cleared when the tab closes and is never written to `localStorage` or cookies.

**CSRF defense via Origin validation.** Mutating endpoints validate the `Origin` header. Only `http://127.0.0.1:18889` and `http://localhost:18889` are allowed. Everything else is rejected with 403. Same-origin requests that omit `Origin` are permitted.

**XSS defense via textContent.** All API-sourced text is rendered using `textContent` in the frontend, never `innerHTML`. The API doesn't strip HTML, so the rendering contract is the safety boundary.

**Loopback only.** The backend rejects non-loopback bind addresses. If something tries to start it on a public interface, it overrides to `127.0.0.1` and logs a warning.

**Sensitive data is redacted.** API responses pass through `redact_sensitive_data()` before being sent. Keys containing `token`, `secret`, `password`, `api_key`, `apikey`, `authorization`, `auth`, `credential`, `access_token`, `refresh_token`, `bearer`, or `jwt` are replaced with `[REDACTED]`. Redaction applies recursively to nested objects and lists.

**MEMORY.md is never served.** Memory files, `auth.json`, and `auth-profiles.json` are explicitly excluded from all observability API endpoints.

---

## Running Tests

```bash
cd workspace/tools/maids-dashboard
python -m pytest tests/ -v
```

Expected: 179+ tests pass. Run with `--tb=short` for compact failure output if something breaks.

---

## Troubleshooting

### Port 18889 already in use

Find what's using it and kill it, or just restart:

```powershell
netstat -ano | findstr 18889
# note the PID, then:
taskkill /PID <pid> /F
```

### DB locked errors

SQLite locks up when multiple processes open the same database. Make sure only one instance of the backend is running. Check for zombie Python processes:

```powershell
Get-Process python
```

### Gateway connection failed

1. Confirm the gateway is running (check `openclaw gateway status` or the gateway process)
2. Verify the token is set: `echo %OPENCLAW_GATEWAY_TOKEN%`
3. Check gateway logs for auth errors

### Missing MAIDS_DASHBOARD_CONFIRM_SECRET

If write operations return 403 and you're sure the header is being sent, the most likely cause is the env var wasn't set before starting the backend. Restart the backend after setting it.

### SSE connections returning 503

The `MAIDS_DASHBOARD_MAX_SSE_CLIENTS` cap has been hit. Close browser tabs that have the dashboard open but idle, or raise the limit:

```powershell
set MAIDS_DASHBOARD_MAX_SSE_CLIENTS=20
```
