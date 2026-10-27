# Storage Architecture and Operations

Scope: `packages/api` persistence and operational behavior. Owner: the API
head. Last synced with code: 2026-07-08.

## Where data lives

The API persists all state in one JSON file through the `ApiStore`
interface (`packages/api/src/store.ts`):

- registered repositories (`id`, canonical `path`, `name`, `registeredAt`)
- scan records (`id`, `repoId`, `status`, `createdAt`, and when complete:
  the full `AuditResult`, `exitCode`; when not: a short `error`)

The file is **configurable via `VEYLQORIX_STORE_PATH`**. The default is
`.veylqorix-store.json` in the working directory of the API process.
Deliberate properties of the default:

- it is **outside any scanned root** — the store must never live inside the
  tree the engine reads (a scan of its own store is a moving target, and
  root-confinement errors in the store could surface inside audit findings);
- it is local to the operator's machine, which is the only deployment
  model where no token is configured;
- set `VEYLQORIX_STORE_PATH` to a dedicated data directory for anything
  longer-lived than the current working directory.

Schema: versioned (`schemaVersion` field, currently `1`). The loader fails
closed on an unknown, corrupt, or *newer* schema — it will not start on a
file it cannot fully understand. When a breaking layout change lands, bump
`STORE_SCHEMA_VERSION` in `store.ts` and add a migration note here;
read-time auto-migration is intentionally not implemented (a second
writer's view of the file is not recoverable).

## Durability model

Every mutation writes through, atomically:

1. serialize the whole document,
2. write it to a temp file in the **same directory**,
3. `fsync` the temp file,
4. `rename` over the store file,
5. `fsync` the directory where the platform supports it.

The rename makes the store file itself either the old or the new document —
never a partial write. Residual limits, stated plainly:

- **Process crash between the last successful persist and death** loses the
  mutations since that persist. There is no journal: a crash mid-scan loses
  at most the in-progress record update; repositories added but not yet
  persisted are lost.
- **In-flight scans are never faked.** A `RUNNING` record whose owner died
  is re-stamped `INTERRUPTED` at the next load (with a "re-run it" error
  note) and is excluded from "latest completed" views. Nothing in the store
  can read as completed that was not completed.
- **The store file and the machine's disks** are the durability boundary:
  on an un-fsynced OS crash, the renamed file may be the old document,
  which is safe (old-but-valid state), never corrupt.

## Single-process limitation (hard constraint)

The store is **not** safe for concurrent writers. Two API processes with
the same `VEYLQORIX_STORE_PATH` will interleave and lose each other's
writes (each process's final `rename` wins; earlier mutations from the
other process are discarded). Operations rule: **one API process per store
file, period.** Scaling out means upgrading the `ApiStore` implementation
to a real database (the interface exists exactly for that swap) and
pointing `createStore` at it — not running more processes against one file.

## Graceful shutdown

On `SIGTERM` / `SIGINT` the API:

1. stops accepting new connections,
2. waits up to 30 s for in-flight scans to finish (running scans keep
   their `RUNNING` record in the store, so even a drain timeout is
   recoverable on the next start),
3. flushes the store,
4. exits 0.

`GET /api/health` reports `store: true|false` (ok vs. a failed persist) in
addition to liveness, so a degraded but running store is observable.

## Logging

Structured JSON lines on stdout: request outcomes, auth denials,
repository/scan lifecycle events, shutdown markers. **Not logged:**
`Authorization` headers, token values, secret finding contents, raw request
bodies. 500 responses carry a fixed message; the error detail is only in
the log.

## Retention and cleanup

The store grows monotonically (repositories and scans are append-only),
and completed scans embed full `AuditResult` documents (findings, scanner
summaries, detection) — large, and they can reference file contents from
the scanned projects. Guidance:

- **Retention:** keep store files for as long as scan history is needed for
  audit; there is no built-in TTL. A realistic window is 30–90 days of
  scans for a dashboard.
- **Cleanup:** the supported procedure is to stop the API, delete or
  archive the store file, and restart (empty state is a valid state — the
  loader treats a missing file as a fresh one). Do not hand-edit a live
  store file; the running process will overwrite your edits on its next
  mutation.
- **Pruning (not implemented):** `DELETE` endpoints for repositories/scans
  are out of scope for this phase; retention is file-level, not record-level.
  If record-level retention becomes a requirement, add it to the `ApiStore`
  interface and implement it in the file store — do not bolt it onto the
  route layer.
- **Size check:** a finished `runAudit` document is typically well under a
  megabyte; a store in the hundreds of MB means retention has outlived its
  purpose.

## Backup expectations

- The store file is self-contained (repositories + scan history + gate
  results). A periodic file copy is a complete backup of everything the
  dashboard shows; nothing else in the API is stateful.
- Back up a **quiescent** copy: copy the file while the API is stopped, or
  rely on the atomic-rename property (any point-in-time copy is either the
  old or the new document — both parse).
- Do not keep backups across a breaking schema change without the matching
  migration; on restore, a `schemaVersion` newer than the binary aborts
  startup by design.
- Backups contain the same secret-redaction guarantees as live responses
  (the engine redacts before the result reaches the store), but treat them
  as sensitive: gate-result history is security-relevant data.

## Operational runbook (short)

| Symptom | Check |
|---|---|
| `403` on registration | `VEYLQORIX_ALLOWED_ROOTS` paths exist and are directories (bad roots abort startup, not requests — a 403 at a request means the path itself is outside) |
| `429` on `POST /api/scan` | concurrency limit reached; honor `retryAfterSec`; raise `VEYLQORIX_MAX_CONCURRENT_SCANS` if engine throughput allows |
| `413` | body over `VEYLQORIX_BODY_LIMIT_BYTES` (default 1 MiB); these endpoints never need more than a few KB |
| `401`/`403` everywhere | protected mode: token missing or wrong; check the client, not the server |
| scans stuck at `INTERRUPTED` | previous process died mid-scan; re-run — that is the recoverable state, not data loss |
| API refuses to start on store | corrupt/unreadable/store-newer-schema; move the file aside, inspect, restart (fresh state) |
