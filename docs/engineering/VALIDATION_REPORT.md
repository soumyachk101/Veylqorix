# Veylqorix — Validation Report

Final report for the engineering hardening & release-readiness effort.
Branch: `feat/engineering-hardening`. Companion docs: `BASELINE_AUDIT.md`,
`SECURITY_HARDENING.md`, `STORAGE_AND_OPERATIONS.md`, `SUPPLY_CHAIN.md`,
`RELEASE_READINESS.md`, `ENGINE_PARITY.md`.

## A. Findings fixed

### F-05 — `check` / restricted-scan exit honesty (HIGH, RESOLVED)
- **Problem:** `veylqorix check` (and any audit with `onlyScanners`) could
  exit 0 / PASS on a repo full of secrets: unselected mandatory scanners
  were not recorded in the gate input (Rust path computed the gate before
  appending the stub; TS path recorded no SKIPPED entry at all).
- **Fix:** `packages/core/src/audit.ts` now records every unselected
  *mandatory* scanner as `SKIPPED` **in the gate input**, on both engine and
  TS paths. Restricted audits are INCOMPLETE (exit 2), never PASS.
- **Regression tests:** `tests/integration/audit.test.ts` (engine path via
  `describe.skipIf(!isEngineAvailable)`, TS path always).
- **Docs:** `BASELINE_AUDIT.md` F-05 marked resolved; CLI help text and
  `docs/cli.md` `check` row now state INCOMPLETE/exit 2.

### API exposure, confinement, persistence (HIGH)
- **Auth:** bearer-token gate (401 missing / 403 wrong, timing-safe SHA-256
  digest compare) on all `/api` routes except `/api/health`; loopback-only
  default bind; non-loopback host without a token **refuses to start**.
  `packages/api/src/{index.ts,bin.ts}`.
- **CORS:** exact-origin allowlist (`VEYLQORIX_CORS_ORIGINS`), no
  wildcard, no credentials, consistent preflight.
- **Roots:** `packages/api/src/roots.ts` — realpath + segment containment
  (no string-prefix), fail-closed on invalid roots, shared by registration
  and scan endpoints so registration cannot be bypassed.
- **Limits:** 413 body cap, 400 field-length cap, 429 bounded concurrency
  (rejected scans are never recorded), safe JSON catch-all errors.
- **Persistence:** `packages/api/src/store.ts` — atomic JSON file store
  (temp + fsync + rename + dir-fsync), in-flight scans recover as
  `INTERRUPTED` on reload (never "completed"), schema-version fail-closed.
- **Operational:** graceful shutdown with drain + flush, `/api/health`,
  redacted structured logging, env validation with guidance.
- **Tests:** `packages/api/src/api.test.ts` (auth, CORS, confinement,
  limits, persistence/reload/interrupted, E2E over HTTP).

### Gate workflow honesty (HIGH)
- **Single-scan reporting:** one CLI scan feeds JSON + Markdown + SARIF via
  `renderAllReports` in `packages/core/src/report/index.ts`; the duplicate
  SARIF scan is gone from `veylqorix-gate.yml`.
- **Verdict honesty:** PASS only when required checks completed; INCOMPLETE
  (exit 2) and NO-SCAN (70, no usable CLI) both fail the gate; report-file
  absence is a red `::error`; SARIF is **validated before upload** (2.1.0,
  ≥1 run) and an upload failure fails red — never claimed successful.
- **Supply chain:** all six external actions pinned to commit SHAs;
  `ci.yml` gitleaks download now fails closed on SHA-256 mismatch
  (digest computed live against the v8.30.1 asset).
- **Tests:** `tests/report-gate.test.ts` (PASS/FAIL/INCOMPLETE verdicts,
  malformed scanner output, report write-failure propagation, SARIF
  validity with 0 and many findings, `validateSarifFile`, upload-failure
  simulation, CLI scanner/severity validation).

### TS/Rust engine parity (HIGH)
- **Protocol:** structured error frames on stdout for exit 64/65/70
  (`ok:false`, `error{code,exitCode,message}`); truncated/malformed
  gitleaks output degrades to empty, never panics.
  `crates/veylqorix-engine/src/protocol.rs`.
- **Adapter:** binary discovery (env → PATH → install locations → repo
  walk), spawn-failure classification, stderr never parsed as protocol
  data, protocol version checked both directions.
  `packages/core/src/engine/index.ts`.
- **Fixtures + differential tests:** 15 shared fixtures under
  `tests/fixtures/`; `tests/engine-differential.test.ts` (TS side
  unconditional, engine side explicitly-labeled skip) and
  `crates/veylqorix-engine/tests/parity-fixtures.rs` (same fixtures through
  `parse_request` + `execute`). Covered: PASS/FAIL/INCOMPLETE verdicts,
  soft/strict exit codes, exception expiry, malformed findings (never a
  pass), protocol-version rejection, missing-root 65, byte-identical
  redaction vectors.
- **Honesty:** degraded engine-absent clean runs PASS with an explicit
  "Rust engine unavailable" TS-compat note; INCOMPLETE only for
  coverage-degrading gaps. See `docs/engineering/ENGINE_PARITY.md` for the
  per-behavior coverage table and its limits.

### MCP server confinement & redaction (HIGH)
- `VEYLQORIX_ROOTS` is now **required** (unset → exit 1, no cwd fallback);
  roots canonicalized up front; symlink-escape rejected; PEM private-key
  blocks and assigned-credential patterns scrubbed from all outputs
  (plain, nested, Markdown, structured); truncation never slices the JSON
  payload (status fields preserved); scanner-unavailability is a
  structured condition, never success.
- **Tests:** `packages/mcp-server/src/mcp.test.ts` + `tests/mcp-server.test.ts`.

### CLI release readiness (MEDIUM)
- `files: ["dist"]`, `engines node >=20.18`, `publishConfig.access: public`
  on `@veylqorix/cli` and `@veylqorix/core`; `pnpm pack --dry-run` lists
  recorded in `RELEASE_READINESS.md`.
- `.github/workflows/release.yml`: on-tag, OIDC trusted publishing,
  **inert until the owner registers an npm trusted publisher**. No publish,
  release, or tag was created.
- Rust engine documented honestly: build from source or set
  `VEYLQORIX_ENGINE`; no assumed developer-local path; reduced coverage is
  labeled in the result, never silent.

### Path confinement bug found in review (HIGH)
- `packages/core/src/util/paths.ts` `validatePath` did its containment test
  on the *lexical* candidate against *realpath*'d roots using string-prefix
  matching — on macOS (where `/var` → `/private/var`) any valid path under a
  symlinked root was rejected `PATH_ERROR`, and sibling-prefix paths were
  admitted by prefix. Replaced with canonical-vs-canonical, path-aware
  containment (`path.relative` segment check). Regression tests in
  `tests/unit/paths.test.ts`.

### Supply chain & workspace (MEDIUM)
- `pnpm-workspace.yaml` `allowBuilds` placeholder strings replaced with real
  booleans (`esbuild: true`, `sharp: true`); `pnpm-workspace.yaml.bak`
  deleted; `.env.example` reconciled (dead vars removed, real vars
  documented).
- `pnpm audit`: 8 vulns, all transitive under `next` in `apps/web`
  (postcss/sharp) — **BLOCKED**, needs an owner decision (bump `next` vs
  `overrides` + lockfile regen). `cargo audit`: 0 vulnerabilities.

## B. Validation matrix

All commands run on `feat/engineering-hardening`, 2026-10-26.

| # | Command | Result |
|---|---|---|
| 1 | `pnpm install --frozen-lockfile` | PASS |
| 2 | `pnpm build` | PASS |
| 3 | `pnpm typecheck` | PASS |
| 4 | `pnpm lint` | PASS (0 errors, 0 warnings) |
| 5 | `pnpm test` (vitest) | PASS — 16 files, **281 tests** |
| 6 | `cargo fmt --manifest-path crates/Cargo.toml --all -- --check` | PASS |
| 7 | `cargo clippy --manifest-path crates/Cargo.toml --workspace --all-targets --all-features -- -D warnings` | PASS |
| 8 | `cargo test --manifest-path crates/Cargo.toml --workspace --all-features` | PASS — 9 test targets, 0 failures |
| 9 | `cargo build --manifest-path crates/Cargo.toml --workspace --release` | PASS |
| 10 | `pnpm pack --dry-run` (`@veylqorix/cli`, `@veylqorix/core`) | PASS — file lists recorded in RELEASE_READINESS.md |

Notes:
- The TS differential suite (100 tests) **ran the engine-backed groups** in
  this environment (release binary present). In a clean CI checkout the
  engine groups skip with explicit labels after the cargo build step.
- `apps/web` vitest integration (`tests/integration/api-routes.test.ts`)
  uses the prebuilt `packages/api` — it passes against the rebuilt
  `dist/`. No website changes.
- Engine-side assertions that cannot run without gitleaks/external tools
  are labeled skips, not passes.

## C. Remaining work

### Code issues fixed but worth a follow-up
- `tests/fixtures/rust-clean` / `rust-vulnerable` predate the fixtures
  convention; they are used by `external-tools.rs` only. Optional
  consolidation.

### Deployment / owner actions (not done here, by design)
- **npm publish + release:** `release.yml` is inert; registering an npm
  trusted publisher (OIDC) and the first tag are owner actions. Nothing was
  published.
- **Branch protection:** making the Veylqorix gate a *required* status
  check must be configured by the repo owner (branch protection or ruleset);
  the workflow is advisory until then. Documented in `docs/github-actions.md`.
- **`apps/web` vulnerabilities (8, transitive postcss/sharp under next):**
  blocked on the owner's choice between a `next` bump and `overrides` +
  lockfile regeneration. Recorded in `SUPPLY_CHAIN.md`.
- **Multi-instance / shared-filesystem deployments:** the JSON file store
  is single-process by design (documented). A horizontally scaled API needs
  the SQLite/Postgres adapter the `ApiStore` interface is ready for.
- **CI gitleaks digest:** the pinned SHA-256 was computed against the
  v8.30.1 asset at commit time; re-verify if the pinned version ever changes.

### Production security checks unverified in this environment
- Live remote-mode smoke test (bind non-loopback + token from a second
  machine) — covered by unit/integration tests, not a real network path.
- `upload-sarif` behavior against a real code-scanning-enabled repo —
  simulated at unit level; the owner's first real run is the final check.

## D. Scope confirmation

The website's UI/UX, styling, copy, SEO metadata, sitemap, `robots.txt`,
AEO/GEO content, and Google/Bing webmaster configuration were **not
changed**. `apps/web` and `veylqorix-website` contain no modified files in
this branch; the dashboard was documented, not touched. No packages were
published, no releases or tags created, no repository settings changed,
and no commits were pushed — all work lives on the local branch
`feat/engineering-hardening` for review.
