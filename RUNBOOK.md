# Maids Dashboard — Operator Runbook

## Overview

Maids Dashboard v2.0.0 is a Bun/React/Vite SPA that connects directly to the MaidsClaw gateway. There is no Python backend — only static files served by a web server.

---

## Prerequisites

| Requirement       | Notes                                                          |
| ----------------- | -------------------------------------------------------------- |
| Bun 1.x           | [bun.sh](https://bun.sh/)                                      |
| MaidsClaw gateway | Running at `VITE_API_BASE` (default: `http://localhost:18790`) |
| MaidsClaw repo    | Checked out as sibling `../MaidsClaw`                          |

---

## Environment Variables

| Variable        | Default                  | Description                |
| --------------- | ------------------------ | -------------------------- |
| `VITE_API_BASE` | `http://localhost:18790` | MaidsClaw gateway base URL |

No other environment variables are required at runtime. Build-time variables (`__APP_VERSION__`, `__MAIDSCLAW_SHA__`) are injected by Vite during `bun run build`.

---

## Local Development

```bash
# Start MaidsClaw first
cd ../MaidsClaw && bun run start

# In a separate terminal
cd ../Maids-Dashboard
bun install
bun run dev          # Dev server at http://localhost:5173
```

Dev server HMR is active. The `@maidsclaw/contracts` alias resolves to `../MaidsClaw/src/contracts/cockpit/` — MaidsClaw must be present as a sibling.

---

## Building for Production

```bash
bun run build        # -> dist/
```

`dist/` is the deployable artifact. It contains `index.html` plus versioned JS/CSS chunks.

---

## Authentication

- Login: enter a MaidsClaw bearer token in the login screen
- Token stored in `sessionStorage` (`mc:token`) — evicted when tab closes
- Offline: read-only cached data remains visible; write affordances are disabled
- `401` from gateway: token is cleared, login screen shown

---

## Offline Mode

When the gateway at `VITE_API_BASE/healthz` is unreachable:

- An offline banner appears at the top of the screen
- Cached query data remains visible
- All write actions (create/edit/delete) are disabled
- Navigation continues to work

---

## Static Deployment

1. Run `bun run build` — produces `dist/`
2. Copy `dist/` to web server root
3. Configure web server to serve `index.html` for all 404s (SPA fallback)
4. Set `Cache-Control: no-cache` on `index.html`; allow caching on JS/CSS chunks

See [deploy/DEPLOY_GUIDE.md](./deploy/DEPLOY_GUIDE.md) for Nginx configuration.

---

## MaidsClaw Version Pin

`.maidsclaw-version` pins the MaidsClaw commit SHA this build was tested against.

```bash
bun run bump:maidsclaw    # Updates pin to current ../MaidsClaw HEAD
```

CI automatically checks out MaidsClaw at this SHA before building.

---

## Rollout Checklist

Use this checklist for every production cutover:

### Pre-Deploy Gates

- [ ] `.maidsclaw-version` is up to date and the SHA is reachable in the MaidsClaw repo
- [ ] MaidsClaw gateway has ~37 v1 routes available (check `/v1/runtime` for agent list)
- [ ] Welcome room shows correct health status and MaidsClaw SHA
- [ ] Grand Hall: create session, send turn, streamed response visible
- [ ] Library: create persona, edit, delete (typed confirmation) all succeed
- [ ] `bun run typecheck && bun run test && bun run build` all pass from repo root
- [ ] `dist/index.html` exists and is < 30 days old

### CORS / Network Gates (Release Blockers)

- [ ] Preview deployment `OPTIONS` preflight from preview origin returns `204` with correct `Access-Control-Allow-Origin`
- [ ] `GET /v1/personas` from preview origin returns `200` (not CORS error)
- [ ] Deep-link to `/grand-hall`, `/library`, `/study` returns `200 text/html` (SPA fallback active)
- [ ] Token sent only over HTTPS or localhost — verify no `401`/CORS loop on prod

### Post-Deploy Smoke

- [ ] Login with valid MaidsClaw token succeeds
- [ ] Welcome room shows gateway as online
- [ ] Grand Hall loads session list
- [ ] Library loads persona list
- [ ] Bad token returns to login screen (no infinite redirect)
- [ ] Gateway offline shows offline banner, navigation unbroken

### Old Stack Removal Confirmation

- [ ] Python `dashboard_backend.py` is absent from the deployment
- [ ] No `pyproject.toml`, `api/`, `services/`, `tests/` Python directories present
- [ ] `frontend/` legacy subtree is absent
- [ ] `MAIDS_DASHBOARD_CONFIRM_SECRET` is not referenced anywhere in active config
- [ ] No systemd `maids-dashboard` service is running or enabled

---

## Troubleshooting

### Gateway Unreachable

1. Check MaidsClaw is running: `curl http://localhost:18790/healthz`
2. Verify `VITE_API_BASE` in `.env.development` or `.env.production`
3. Check CORS: is the preview/production origin in MaidsClaw's CORS allowlist?

### Login Loop

1. Open browser DevTools, go to Application, then sessionStorage
2. Clear the `mc:token` key manually
3. Hard-reload the page
4. Try a fresh bearer token

### Build Fails

1. Ensure `../MaidsClaw` exists as sibling directory
2. Run `bun run bump:maidsclaw` to confirm pin is valid
3. Run `bun run typecheck` for type errors before building

### SPA 404 on Refresh

- Web server must redirect all 404s to `index.html`
- See Nginx config in `deploy/DEPLOY_GUIDE.md`
