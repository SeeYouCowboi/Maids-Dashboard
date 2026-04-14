# Maids Dashboard

Native console for [MaidsClaw](../MaidsClaw) — a Bun/React/Vite SPA that connects directly to the MaidsClaw gateway.

> For operational details, see [RUNBOOK.md](./RUNBOOK.md).

---

## Stack

**Frontend** — React 19, TypeScript 5, Tailwind CSS v4, Vite 6, Recharts, motion/react
**Runtime** — Bun, BrowserRouter (SPA), TanStack Query
**Gateway** — [MaidsClaw](../MaidsClaw) (sibling repo, pinned via `.maidsclaw-version`)

---

## Requirements

- [Bun](https://bun.sh/) 1.x
- [MaidsClaw](../MaidsClaw) checked out as a sibling directory (`../MaidsClaw`)
- MaidsClaw gateway running on port 18790

---

## Sibling Repo Topology

Both repos must live side-by-side:

```
workspace/
  MaidsClaw/        <- gateway server
  Maids-Dashboard/  <- this repo (SPA)
```

The Dashboard's `@maidsclaw/contracts` TypeScript path alias resolves to `../MaidsClaw/src/contracts/cockpit/`. If MaidsClaw is not present as a sibling, the build will fail.

---

## Environment Variables

### Required (production)

| Variable        | Description                                                             |
| --------------- | ----------------------------------------------------------------------- |
| `VITE_API_BASE` | URL of the MaidsClaw gateway (default in dev: `http://localhost:18790`) |

### .env files

| File               | Purpose                                                               |
| ------------------ | --------------------------------------------------------------------- |
| `.env.development` | Dev defaults — `VITE_API_BASE=http://localhost:18790`                 |
| `.env.production`  | Production gateway URL — set `VITE_API_BASE` to your deployed gateway |
| `.env.example`     | Reference template                                                    |

---

## Quickstart

```bash
# 1. Ensure MaidsClaw is running
cd ../MaidsClaw && bun run start

# 2. Install dependencies
cd ../Maids-Dashboard && bun install

# 3. Start the dev server
bun run dev
```

Open `http://localhost:5173` in a browser. Log in with a MaidsClaw bearer token.

---

## Commands

| Command                  | Description                                           |
| ------------------------ | ----------------------------------------------------- |
| `bun run dev`            | Start Vite dev server (HMR, proxies to MaidsClaw)     |
| `bun run build`          | Typecheck + Vite production build into `dist/`        |
| `bun run preview`        | Preview `dist/` locally                               |
| `bun run typecheck`      | Run TypeScript type checking                          |
| `bun run lint`           | Run ESLint                                            |
| `bun run test`           | Run Vitest unit tests                                 |
| `bun run test:watch`     | Run tests in watch mode                               |
| `bun run bump:maidsclaw` | Update `.maidsclaw-version` to current MaidsClaw HEAD |

---

## Rooms

| Room            | Status | Purpose                                                 |
| --------------- | ------ | ------------------------------------------------------- |
| **Welcome**     | v1     | Health status, auth state, quick navigation             |
| **Grand Hall**  | v1     | Sessions, agents, chat with streamed turns              |
| **Library**     | v1     | Persona & lore studio (create/edit/delete)              |
| **Study**       | v1     | Read-only memory browser (core blocks, episodes, etc.)  |
| **Observatory** | v1     | Aggregated read-only overview (charts, health cards)    |
| **War Room**    | v1     | Logs, request traces, blackboard state inspector        |
| **Garden**      | v1     | Jobs, runtime config, providers, agents, local prefs    |
| **Kitchen**     | v2     | Task submission & scheduled agent tasks                 |
| **Ballroom**    | v2     | Multi-agent interaction (requires MaidsClaw extensions) |

---

## Authentication

The Dashboard uses bearer token authentication:

1. Open the app — if no token is in `localStorage`, a login screen appears
2. Enter your MaidsClaw bearer token
3. Token is stored in `localStorage` (`mc:token`) — persists across tabs and reloads
4. `401` responses automatically clear the token and return to login

Tokens are never sent over non-HTTPS non-localhost origins.

---

## Project Structure

```
src/               React SPA source
  api/             Typed API clients (one per resource)
  auth/            AuthProvider, LoginScreen, AuthGuard
  components/      Shell, sidebar, shared UI primitives
  contracts/       Re-exports from @maidsclaw/contracts
  hooks/           useHealth, useOffline, usePrefs
  lib/             storage.ts, observatory-aggregations.ts
  pages/           One file per room
  query/           TanStack Query client and keys
  schemas/         Local Zod v3 form schemas
  stream/          POST SSE turn stream client
dist/              Production build output (git-ignored)
.maidsclaw-version Pinned MaidsClaw SHA for builds
scripts/           bump-maidsclaw.sh
docs/              Architecture and consensus docs
```

---

## MaidsClaw Version Pin

`.maidsclaw-version` contains the Git SHA of the MaidsClaw commit this build was tested against. The CI workflow checks out MaidsClaw at exactly this SHA before building.

To update the pin:

```bash
bun run bump:maidsclaw
```

---

## Deployment

See [RUNBOOK.md](./RUNBOOK.md) and [deploy/DEPLOY_GUIDE.md](./deploy/DEPLOY_GUIDE.md).

Production builds are static files in `dist/`. The server must:

1. Serve `dist/` as static files
2. Redirect all 404s to `dist/index.html` (SPA fallback)
3. Set `Cache-Control: no-cache` on `index.html`
