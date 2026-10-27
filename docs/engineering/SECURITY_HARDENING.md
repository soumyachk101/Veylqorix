# API Security Hardening

Scope: `packages/api` — the Veylqorix REST API that registers repositories,
executes `runAudit` scans, and serves results to the dashboard. Implemented in
Phase 2/3/11; owner: the API head. Last synced with code: 2026-07-08.

## Threat model (summary)

The API process runs with the account that can *read* the configured roots —
it is, by design, a path-reading service. Threats:

1. **Network exposure.** An unauthenticated listener that accepts
   "scan this path" requests is an arbitrary-directory-read oracle. Default
   posture must therefore be loopback-only.
2. **Path escape.** A client-supplied path or a symlink inside the tree must
   never resolve outside the configured roots. Registration-time and
   scan-time checks must use the *same* gate so a pass at registration
   cannot be bypassed at scan time.
3. **Cross-origin abuse.** A wildcard CORS header lets any site the user
   happens to visit drive scans through the dashboard's origin.
4. **Resource exhaustion.** Unbounded request bodies, field lengths, and
   concurrent engine runs (each of which spawns the Rust engine and
   optional external tools) make the API a DoS vector for itself.
5. **State loss / false success.** An in-memory store that is killed mid-scan
   loses history; an in-flight scan that crashes must never surface as
   completed. A file store that races or corrupts must not start silently.
6. **Information leakage.** Error responses and logs must not reveal
   filesystem contents, configuration, stack traces, or token material.

## What was hardened

### Authentication and exposure (`bin.ts`, `index.ts`)

- The listener binds to `127.0.0.1` by default.
- `VEYLQORIX_API_HOST` selects the bind address. Setting a non-loopback host
  **without** `VEYLQORIX_API_TOKEN` refuses to start. With a token set,
  remote binding is allowed; if the token is set and no host is given the
  process logs a startup warning that it is staying loopback-only.
- **Protected mode** (`VEYLQORIX_API_TOKEN`): every `/api` route except the
  liveness probe (`GET /api/health`) requires `Authorization: Bearer <token>`.
  - missing/malformed → `401`; wrong token → `403`. Both responses use
    fixed, value-free wording.
  - Comparison is timing-safe: both tokens are SHA-256 digested first
    (digests are always 32 bytes, so `crypto.timingSafeEqual` is safe), so no
    length or prefix information leaks.
  - The token is never logged; logs carry the request line and outcomes only.
- `GET /api/health` intentionally stays open so orchestrators can probe a
  protected API; it reports liveness plus store health but no configuration.

### CORS

- The wildcard `Access-Control-Allow-Origin: *` is gone.
- `VEYLQORIX_CORS_ORIGINS` (comma-separated exact origins) is the allowlist.
  - approved origin → its exact value reflected, plus `Allow-Methods`,
    `Allow-Headers` (`Content-Type, Authorization`), and `Max-Age`;
  - rejected origin → `Vary: Origin` and **no** `Allow-Origin` header;
  - no `Origin` header → no CORS headers at all (same-origin / non-browser
    clients unaffected);
  - no allowlist configured → no `Allow-Origin` is ever emitted.
- Preflight (`OPTIONS`) is answered with CORS shape only, before auth, since
  browsers do not send `Authorization` on preflight. No `Allow-Credentials`
  is ever set.

### Root confinement (`roots.ts`)

- `VEYLQORIX_ALLOWED_ROOTS` roots are canonicalized with `fs.realpathSync`
  at startup and verified to be existing directories; a bad root aborts the
  start (fail closed). Error messages identify the root by index, not by
  what it contains.
- Every candidate path (registration *and* the one-call
  `POST /api/scan` path) is run through the same confinement gate:
  `realpath(resolve(candidate))` must equal a root or have a
  `path.relative(root, real)` that is non-empty, not absolute, and not
  starting with `..` — a segment comparison, not a string prefix.
  - catches the sibling-prefix trap (`/root-x` against root `/root`);
  - catches symlink escape (a link inside the tree pointing outside is
    followed by `realpath` and rejected);
  - missing or inaccessible candidates are rejected with the same
    generic `403` message — no directory listing side channel.
- Registration responses persist the *canonical* path, so later scans use
  the verified identity.

### Resource limits and error safety (`index.ts`)

- Request bodies are capped (default 1 MiB, `VEYLQORIX_BODY_LIMIT_BYTES`);
  over-limit bodies get `413`.
- `path` / `name` / `repoId` fields are length-capped (default 4096,
  `VEYLQORIX_MAX_FIELD_LENGTH`); oversized fields get `400`.
- Concurrent scans are bounded (default 2, `VEYLQORIX_MAX_CONCURRENT_SCANS`).
  Excess requests get **`429` with `retryAfterSec`** — and are *not*
  recorded, so a rejected scan can never be read as a started or completed
  one.
- `auditDefaults.scannerTimeoutMs` (default 120 s, `VEYLQORIX_TIMEOUT_MS`)
  passes through to the engine's per-scanner wall-clock budget.
- The catch-all handler returns a fixed safe JSON 500; full detail goes to
  the structured log, never to the response. No stack traces, no config, no
  internal paths in any response.

### Persistence and honest recovery (`store.ts`)

- File-backed JSON store, atomic writes (temp file in the same directory,
  `fsync`, rename; directory `fsync` where the platform allows it).
- On load: a scan still `RUNNING` is re-stamped `INTERRUPTED` with a
  "re-run it" note. `INTERRUPTED` is treated as a non-result everywhere
  (lists, `latest`, detail endpoints), so a dead scan can never show as
  `DONE` or as a pass.
- Store load failures (corrupt file, newer schema, unreadable file) abort
  startup rather than silently starting empty.
- Health endpoint reports `store` ok. See `STORAGE_AND_OPERATIONS.md` for the
  durability and retention model.

### Startup validation and shutdown (`bin.ts`)

- Unknown/invalid env values fail fast with guidance: ports, concurrency,
  limits and timeouts must be numeric; `VEYLQORIX_OFFLINE` and
  `VEYLQORIX_INCLUDE_TESTS` must be `0`/`1` when set.
- `SIGTERM`/`SIGINT`: stop accepting connections, drain in-flight scans
  (bounded to 30 s), flush the store, exit 0. Scans not finished by the
  deadline stay `RUNNING` on disk and recover as `INTERRUPTED` on restart.

## Residual risks (owner actions)

- **Single-process store.** Two API processes sharing one store file lose
  interleaved writes. Do not run two instances against the same
  `VEYLQORIX_STORE_PATH`; document in `STORAGE_AND_OPERATIONS.md`.
- **Static bearer token.** Rotation means restart; there is no
  per-token revocation, audit, or scoping. For multi-user remote
  deployments, terminate TLS and authenticate at a gateway; keep the API
  loopback-only.
- **Token transmission.** Bearer tokens are only as safe as the transport;
  non-TLS remote exposure will put them on the wire in the clear. Owner
  action: require a TLS-terminating reverse proxy for remote mode.
- **Symlink race.** Containment is checked at request time; a symlink that
  is re-pointed between the check and the engine read is a TOCTOU window.
  Mitigation (owner action): run the API and the engine as a user whose
  write access is limited to the roots, so an attacker who can re-point a
  symlink has already broken the boundary that matters.
- **Engine execution.** Scans spawn the Rust engine and (optionally)
  gitleaks/cargo audit with network advisory fetches. The online/offline
  switch is operator-controlled (`VEYLQORIX_OFFLINE=1`); treat "online"
  scans as data exfiltration of file contents to advisory services.
- **CORS allowlist size.** There is no cap on `VEYLQORIX_CORS_ORIGINS`
  entries; an operator error (wildcard-looking origin string) is simply not
  reflected. Owner action: keep the list to the dashboard origin(s).

## Token provisioning and rotation

1. **Generate** a long random token on the server host:
   `openssl rand -hex 32` (or `crypto.randomBytes(32)` in Node).
2. **Distribute** it to clients out-of-band (env var, secret manager,
   dashboard config). Clients send it as `Authorization: Bearer <token>`.
3. **Deploy**: set `VEYLQORIX_API_TOKEN` and, for remote access,
   `VEYLQORIX_API_HOST` on the listening host. Loopback-only deployments do
   not need either.
4. **Rotate**: generate a new value and restart the API process; all clients
   pick up the new token on their next request. There is no dual-accept
   window — rotation is restart-based by design (a static token cannot be
   revoked mid-life without a code change). Keep rotation intervals short
   enough that a leaked token's exposure is bounded.
