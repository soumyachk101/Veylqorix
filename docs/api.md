# Veylqorix API

Base URL (default): `http://localhost:4173` (loopback-only unless
`VEYLQORIX_API_HOST` is set with a token — see Authentication below).

All request/response bodies are JSON unless stated otherwise.
`Content-Type: application/json`. Every error is structured JSON:
`{ "error": "<message>" }` with the appropriate HTTP status. Paths are
resolved, canonicalized, and validated against `VEYLQORIX_ALLOWED_ROOTS`
when set (a `403` means the path is outside the allowed roots or does not
resolve to a usable directory — the response deliberately does not say which).
Secret values are redacted in every response.

State (repositories and scans, including their status transitions) persists
to the JSON store at `VEYLQORIX_STORE_PATH` (default
`./.veylqorix-store.json` in the server's working directory). On restart,
scans that were in flight are reported as `INTERRUPTED`, never `DONE`. See
`docs/engineering/STORAGE_AND_OPERATIONS.md`.

## Endpoints

### `GET /api/health`
Liveness probe. Returns `{"ok": true, "store": true, "schemaVersion": 1, "time": "..."}`.
`store` is `false` when the last store persist failed. This endpoint is open
even in protected mode (no token), so orchestrators can probe it.

### `POST /api/repositories`
Register a repository for scanning.

| Field  | Type   | Required | Notes |
|--------|--------|----------|-------|
| `path` | string | yes      | Path to the project root (resolved against the server's CWD, then canonicalized; the stored `path` is the canonical one) |
| `name` | string | no       | Display name; defaults to the basename of `path` |

Returns `201` with the registered repository. Returns `403` when the
canonical path is outside `VEYLQORIX_ALLOWED_ROOTS` (if set) or does not
resolve to a usable directory. Returns `400` for a missing `path` or a field
longer than the configured maximum (default 4096, `VEYLQORIX_MAX_FIELD_LENGTH`).

### `GET /api/repositories`
List all registered repositories.

### `POST /api/scan`
Start a scan.

| Field  | Type   | Required | Notes |
|--------|--------|----------|-------|
| `repoId` | string | no*    | A previously registered repository id |
| `path`   | string | no*    | Register + scan in one call; the path passes the same root-confinement check as registration, so a check that passed at registration cannot be bypassed here |

\* One of `repoId` or `path` is required.

Returns `202` with `{"scan": {"id": "scan-…", "status": "RUNNING", "repoId": "…"}}`.
Poll `GET /api/scan/:id` until `status` is `DONE`, `ERROR`, or
`INTERRUPTED`.

Concurrent runs are bounded (default 2, `VEYLQORIX_MAX_CONCURRENT_SCANS`):
when the limit is reached the request is rejected with `429`
`{"error": "...", "retryAfterSec": 5}` and **no scan is recorded** — a
rejected scan can never appear in `GET /api/scans` or report success.

### `GET /api/scan/:id`
Return the full scan result when complete: gate decision, coverage, exit code,
findings, scanner summaries, and detection. `status` is always present so
clients can poll on a stable field. `status` can be `RUNNING`, `DONE`,
`ERROR`, or `INTERRUPTED` (a scan whose process died before it finished;
re-trigger the scan).

### `GET /api/scan/:id/findings`
Return only the findings array for a completed scan. While running or
interrupted, returns `202` with an empty findings array.

### `GET /api/scan/:id/report`
Return the scan report inline. Query params: `?format=markdown` (default),
`?format=json`, `?format=sarif`. For a downloadable file, use
`GET /api/reports/:scanId` instead.

### `GET /api/scans`
List scans, newest first. Optional `?repoId=<id>` filters to one repository.
Each entry is a summary: `id`, `repoId`, `status`, `createdAt`, `gate`
(`PASS`/`FAIL`/`INCOMPLETE` when complete), `coverage`, `exitCode`,
`findingCount`, and `error` (only when `ERROR` or `INTERRUPTED`).

### `GET /api/scans/:id`
Full detail for one scan (same payload as `GET /api/scan/:id`, plus
`createdAt`). Poll until `status` is `DONE` or `ERROR`.

### `GET /api/reports/:scanId`
Downloadable report document. Query param `?format=markdown` (default),
`?format=json`, `?format=sarif`. Responds with the document body and a
`Content-Disposition: attachment` header so it downloads as a file
(`veylqorix-report-<scanId>.md` / `.json` / `.sarif`). Returns `202` while the
scan is still running or interrupted, `404` for an unknown scan id, and `400`
for an unknown format. Secret values are redacted in every format.

### `GET /api/repo/:id/latest`
Return the most recent completed scan for a repository. `RUNNING` and
`INTERRUPTED` scans are not "latest" — they are not results. Returns
`latest: null` when the repository has no completed scan yet.

### `GET /api/repo/:id/history`
Return the full scan history for a repository, newest first.

## Authentication

Loopback-only deployments (the default) need no token: the server binds to
`127.0.0.1`, and a non-loopback `VEYLQORIX_API_HOST` without a token refuses
to start.

Remote/protected mode: set `VEYLQORIX_API_TOKEN` and (for remote access)
`VEYLQORIX_API_HOST`. Then every `/api` route except `GET /api/health`
requires the header `Authorization: Bearer <token>`:

| Condition | Response |
|---|---|
| No token / malformed header | `401` `{"error": "Authentication required. ..."}` |
| Wrong token | `403` `{"error": "The provided token was rejected."}` |

The comparison is timing-safe (SHA-256 digests, `crypto.timingSafeEqual`);
the token value never appears in logs or responses. Generate with
`openssl rand -hex 32`. Rotation is restart-based: deploy the new token,
clients pick it up on the next request. Full provisioning guidance:
`docs/engineering/SECURITY_HARDENING.md`.

## CORS

The wildcard CORS header has been removed. Set
`VEYLQORIX_CORS_ORIGINS` (comma-separated exact origins, e.g.
`http://localhost:3000,http://dashboard.example.com`) to enable cross-origin
use by the dashboard:

- an allowlisted `Origin` is reflected exactly (never `*`, never with
  credentials); allowed preflight methods: `GET, POST, OPTIONS`, allowed
  headers: `Content-Type, Authorization`;
- a disallowed `Origin` receives `Vary: Origin` and no
  `Access-Control-Allow-Origin` header;
- requests without an `Origin` header receive no CORS headers at all
  (same-origin and non-browser clients are unaffected).

With no allowlist configured, no `Access-Control-Allow-Origin` header is ever
sent.

## Limits and operational behavior

| Control | Env var | Default | Behavior at the limit |
|---|---|---|---|
| Concurrent scans | `VEYLQORIX_MAX_CONCURRENT_SCANS` | 2 | `429` with `retryAfterSec`; nothing recorded |
| Request body size | `VEYLQORIX_BODY_LIMIT_BYTES` | 1 MiB | `413` |
| Field length (`path`/`name`/`repoId`) | `VEYLQORIX_MAX_FIELD_LENGTH` | 4096 | `400` |
| Scanner wall-clock budget | `VEYLQORIX_TIMEOUT_MS` | 120000 | pass-through to the engine; the scan ends `ERROR`, never as a pass |

Errors are safe JSON only: 500s carry a fixed message and the detail is in
the server's structured log, not in the response. `SIGTERM`/`SIGINT` stop
accepting connections, drain in-flight scans (up to 30 s), flush the store,
and exit. In-flight scans that outlive the drain recover as `INTERRUPTED`.
