# Veylqorix Dashboard

The dashboard (`apps/web`) shows **real** scan data from the Veylqorix API.
When the API is unreachable it renders clearly-labeled sample data with a
**DEMO MODE** banner — it never presents a demo as a live result.

> `apps/web` is a Next.js 15 + React 19 app. It proxies `/api/*` to the API
> server via Next.js rewrites (`next.config.mjs`), targeting
> `NEXT_PUBLIC_API_BASE` (default `http://localhost:4173`).

## Run it

Two processes: the API (source of truth) and the web app.

```
# 1. Build once
pnpm install
pnpm build

# 2. Start the API (default port 4173)
node packages/api/dist/bin.js
#    -> veylqorix-api listening on http://localhost:4173

# 3. Start the web app (default port 3000)
pnpm --filter @veylqorix/web dev
#    -> landing page + dashboard on http://localhost:3000
```

Open <http://localhost:3000/dashboard> (or use **Dashboard** in the landing
page header).

For a production build instead of dev mode:

```
pnpm --filter @veylqorix/web build
pnpm --filter @veylqorix/web start
```

### Environment

| Variable | Default | Effect |
|----------|---------|--------|
| `VEYLQORIX_API_PORT` | `4173` | Port the API listens on. |
| `VEYLQORIX_ALLOWED_ROOTS` | none | Restrict which paths the API may scan. |
| `VEYLQORIX_OFFLINE` | unset | `1` skips network-dependent scanners. |
| `VEYLQORIX_INCLUDE_TESTS` | unset | `1` includes test/build checks in scans. |
| `VEYLQORIX_TIMEOUT_MS` | `120000` | Per-scanner timeout. |
| `NEXT_PUBLIC_API_BASE` | `http://localhost:4173` | Base URL the Next.js rewrites proxy `/api/*` to. |

The API server reads the `VEYLQORIX_*` variables; `NEXT_PUBLIC_API_BASE` is a
build-time variable read by the web app. `.env.example` documents both sets.

## What the dashboard shows

- **Mode banner** — top-right: **LIVE** (green, real API data) or
  **DEMO MODE** (amber, labeled sample data).
- **Gate result** — PASS / FAIL / INCOMPLETE with the blocking reasons and
  coverage level.
- **Findings** — normalized findings sorted by severity, with scanner, rule,
  advisory, and remediation. Secret values are redacted.
- **Scanner summaries** — per-scanner status, finding counts, and notes, so
  you can see which checks actually ran.
- **History** — previous scans for the selected repository.

## Using the API from the dashboard

The dashboard registers a repository, starts a scan, polls it to completion,
and renders the result. The underlying endpoints (see `docs/api.md`):

```
POST /api/repositories      { "path": "/abs/path/to/repo", "name": "my-repo" }
POST /api/scan              { "repoId": "repo-…" }        -> 202 { "scan": { "id": "scan-…" } }
GET  /api/scans/:id                              -> poll until status is DONE/ERROR
GET  /api/scans                          -> list scans
GET  /api/reports/:scanId?format=sarif    -> SARIF download
```

The dashboard requests hit `/api/*` same-origin on port 3000; Next.js rewrites
forward them to the API at `NEXT_PUBLIC_API_BASE`.

## If you only want the API

Run just `node packages/api/dist/bin.js` and exercise it with curl:

```
curl -s http://localhost:4173/api/health
curl -s -X POST http://localhost:4173/api/repositories \
     -H 'Content-Type: application/json' \
     -d '{"path":"/abs/path/to/repo"}'
```

## Troubleshooting

- **Dashboard stuck in DEMO MODE.** The web app cannot reach the API. Confirm
  `NEXT_PUBLIC_API_BASE` points at a running API (and re-run `pnpm --filter
  @veylqorix/web build` after changing it, since it is a build-time variable)
  and that the API port is not blocked.
- **403 on repository register.** The path is outside `VEYLQORIX_ALLOWED_ROOTS`.
  Add the path to the allowed roots, or clear the variable for local dev.
- **Scan returns INCOMPLETE / degraded coverage.** A scanner could not run
  (offline, missing binary, no lockfile). This is intentional — Veylqorix
  surfaces incomplete audits rather than green-washing them.
