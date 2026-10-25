# Veylqorix API

Base URL (default): `http://localhost:4173`

All request/response bodies are JSON unless stated otherwise.
`Content-Type: application/json`. Every error is structured JSON:
`{ "error": "<message>" }` with the appropriate HTTP status. Paths are
resolved and validated against `VEYLQORIX_ALLOWED_ROOTS` when set (a `403`
means the path is outside the allowed roots). Secret values are redacted in
every response.

## Endpoints

### `GET /api/health`
Liveness probe. Returns `{"ok": true, "time": "..."}`.

### `POST /api/repositories`
Register a repository for scanning.

| Field  | Type   | Required | Notes |
|--------|--------|----------|-------|
| `path` | string | yes      | Absolute path to the project root |
| `name` | string | no       | Display name; defaults to the basename of `path` |

Returns `201` with the registered repository. Returns `403` when the path is
outside the configured `VEYLQORIX_ALLOWED_ROOTS` (if set).

### `GET /api/repositories`
List all registered repositories.

### `POST /api/scan`
Start a scan.

| Field  | Type   | Required | Notes |
|--------|--------|----------|-------|
| `repoId` | string | no*    | A previously registered repository id |
| `path`   | string | no*    | Register + scan in one call |

\* One of `repoId` or `path` is required.

Returns `202` with `{"scan": {"id": "scan-…", "status": "RUNNING"}}`.
Poll `GET /api/scan/:id` until `status` is `DONE` or `ERROR`.

### `GET /api/scan/:id`
Return the full scan result when complete: gate decision, coverage, exit code,
findings, scanner summaries, and detection. `status` is always present so
clients can poll on a stable field.

### `GET /api/scan/:id/findings`
Return only the findings array for a completed scan.

### `GET /api/scan/:id/report`
Return the scan report inline. Query params: `?format=markdown` (default),
`?format=json`, `?format=sarif`. For a downloadable file, use
`GET /api/reports/:scanId` instead.

### `GET /api/scans`
List scans, newest first. Optional `?repoId=<id>` filters to one repository.
Each entry is a summary: `id`, `repoId`, `status`, `createdAt`, `gate`
(`PASS`/`FAIL`/`INCOMPLETE` when complete), `coverage`, `exitCode`,
`findingCount`, and `error` (only when `ERROR`).

### `GET /api/scans/:id`
Full detail for one scan (same payload as `GET /api/scan/:id`, plus
`createdAt`). Poll until `status` is `DONE` or `ERROR`.

### `GET /api/reports/:scanId`
Downloadable report document. Query param `?format=markdown` (default),
`?format=json`, `?format=sarif`. Responds with the document body and a
`Content-Disposition: attachment` header so it downloads as a file
(`veylqorix-report-<scanId>.md` / `.json` / `.sarif`). Returns `202` while the
scan is still running, `404` for an unknown scan id, and `400` for an unknown
format. Secret values are redacted in every format.

### `GET /api/repo/:id/latest`
Return the most recent completed scan for a repository.

### `GET /api/repo/:id/history`
Return the full scan history for a repository, newest first.

## Authentication

The API has no built-in authentication. In a deployment behind a trusted
network, set `VEYLQORIX_ALLOWED_ROOTS` to restrict which paths may be registered
and scanned. In production, place a gateway with authentication in front.
