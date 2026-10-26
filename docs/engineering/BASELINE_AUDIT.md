# Veylqorix — Baseline Architectural Audit

- **Date:** 2026-07-10
- **Branch:** `main` (read-only audit; no source files modified)
- **Method:** every claim below is grounded in a file that was actually read in this audit. Items the auditor could not fully verify are marked **UNCERTAIN** rather than asserted.

## Executive summary

Veylqorix is a pnpm monorepo with five TypeScript workspaces (`packages/core`, `packages/api`, `packages/mcp-server`, `apps/cli`, plus root tooling) and a Rust security engine (`crates/veylqorix-engine`) that the TypeScript core delegates the secret scan and gate evaluation to, with an honest degradation path when the binary is absent.

**Headline findings:**

1. **The pnpm workspace file contains a placeholder `allowBuilds` block whose values are the literal strings `set this to true or false`.** The key itself is valid pnpm ≥ 10.13.0 (parsing confirmed against the locally installed pnpm 11.9.0), but the placeholder string values are not booleans. Since pnpm 10.14+, a non-`true` value means "do not build" — i.e. `sharp` (and anything else listed here) would be **explicitly blocked** from running install scripts, which is the opposite of the intended allow-list. This is the single most actionable defect in the audit.
2. **`apps/cli/src/index.ts` does not use `apps/cli/src/cli-args.ts`.** The two files contain two parallel implementations of the same parser, and the executable one (`index.ts`) is missing flags the shared one has (`--strict`, `--path`, `--config`, `hooks remove`). There is no in-repo test that exercises either path (vitest's `apps/*/src/**/*.test.ts` glob matches nothing today — no CLI test file exists).
3. **The API's `createStore` is in-memory-only in production.** `dir` is unused, so the advertised JSON persistence ("the dashboard shows real, historical data") is lost on every restart; all repositories and scan history disappear.
4. **The API has no authentication and CORS `Access-Control-Allow-Origin: *`.** The `VEYLQORIX_ALLOWED_ROOTS` confinement exists and is enforced (403 on `POST /api/repositories`), but the default is an empty allow-list = no confinement.
5. **The `check` CLI command is contradictory.** `check` sets `onlyScanners: []` and `skipQualityChecks: false`, which runs zero scanners and zero quality checks.
6. **The reusable gate workflow is advisory-only** unless the calling repo wires its status check into branch protection (the workflow's own header comment says so).

**Well-grounded positives (verified, no defect):** the Rust-engine adapter's error taxonomy (a failed engine run is never read as a pass), the gate's completeness logic (skipped/errored scanners can never yield INCOMPLETE-AND-PASS), byte-deterministic `toJson`/`toSarif`, MCP server root confinement + redaction + output caps (tested in `tests/mcp-server.test.ts`), and the CI pipeline which builds the release engine **before** `pnpm test` (so `tests/engine-adapter.test.ts` exercises the real binary).

## Findings table

| ID | Severity | Area | Files | Test coverage |
|----|----------|------|-------|---------------|
| F-01 | **High** | pnpm-workspace `allowBuilds` placeholder values block `sharp` build | `pnpm-workspace.yaml:4-6` | None (no install-time test). Verify: `pnpm install` and check whether `sharp` postinstall ran (its optional `@img/sharp-*` binaries are present in `pnpm-lock.yaml`). |
| F-02 | **High** | API store is in-memory; documented persistence is not implemented | `packages/api/src/index.ts:56-91` (`createStore`), header comment lines 5-10 | `packages/api/src/api.test.ts` and `tests/integration/api-routes.test.ts` both use in-memory `createStore()`; no persistence test exists (none could — the feature is absent). |
| F-03 | **Medium** | API: no auth, wildcard CORS, default `allowedRoots` = no confinement | `packages/api/src/index.ts:125-127,175-181,111-114`; `packages/api/src/bin.ts:6-9` | 403 confinement is tested (`packages/api/src/api.test.ts:62-71`, `tests/integration/api-routes.test.ts:119`). No test for CORS headers, OPTIONS preflight, or default-open behavior. |
| F-04 | **Medium** | CLI: `index.ts` ignores `cli-args.ts` — two divergent parsers; `--strict`/`--path`/`--config` unusable from the executable | `apps/cli/src/index.ts:72-178` (self-contained parser) vs `apps/cli/src/cli-args.ts:67-203` (shared, richer parser); `apps/cli/dist/cli-args.js` proves `cli-args.ts` was once compiled as part of the build | No test under `tests/` or `apps/cli/src/` references either parser (searched: zero hits in `apps/`, `tests/`, `packages/` outside `dist/`). |
| F-05 | **Medium** | ~~CLI `check` command runs nothing~~ **RESOLVED** — `check` passes `onlyScanners: []`; every unselected mandatory scanner is now recorded as SKIPPED in the gate input, so the gate is `INCOMPLETE` (exit 2) and a secrets-laden repo can never read as a clean pass. | `apps/cli/src/index.ts:350-351` (`onlyScanners: command === 'check' ? [] : …`); `packages/core/src/audit.ts` (unselected-mandatory SKIPPED recording in the gate input) | **Regression-tested** on both engine paths: `tests/integration/audit.test.ts` → `runAudit` describe block "unselected scanners degrade the gate, never exit 0 (F-05 regression)" (Rust-path test behind `skipIf(!isEngineAvailable())`; TS compatibility-path test always runs). Both assert INCOMPLETE / exit 2 / `secrets` SKIPPED note. |
| F-06 | **Low** | Reusable gate workflow is advisory unless wired into branch protection | `.github/workflows/veylqorix-gate.yml:1-9` (explicit comment) | Not testable in-repo; it's a design property, documented in the workflow. |
| F-07 | **Low** | API scan reports return `content-type: text/plain` for all markdown/sarif/json report documents on `/api/scan/:id/report` | `packages/api/src/index.ts:118-130` (`send()`), 246-255 | `tests/integration/api-routes.test.ts:177,188` assert the report body content, not the header. **UNCERTAIN** whether this is a defect: `Content-Length` is correct and a SARIF-over-`text/plain` is merely a header inconsistency (the dedicated `/api/reports/:scanId` route sets proper types, lines 340-361). |
| F-08 | **Info** | `strictExitCode` maps `INCOMPLETE` and `PASS` identically (exit 2); coverage `NONE` never emitted by the TS gate path | `packages/core/src/gate/index.ts:163-186`; `packages/core/src/audit.ts:309` | `tests/unit/gate.test.ts:226` covers `exitCodeFor` only; no test distinguishes strict-mode INCOMPLETE vs PASS. Not a bug per the documented contract ("a degraded audit never exits 0 in strict mode") — noted for completeness. |
| F-09 | **Info** | Engine `resolveEngineBinary` caches nothing across audits, but `binaryCache` in `isEngineAvailable()` is keyed only on the env var, not on `startDir` | `packages/core/src/engine/index.ts:220-233` | `tests/engine-adapter.test.ts:48-64` covers the honest-reporting behavior of `isEngineAvailable()`. Low impact: the cache key is env-only by design; the adapter itself is constructed fresh per `runAudit` (`packages/core/src/audit.ts:186`). |

## Per-area notes

### 1. API server — `packages/api/src/index.ts`

**Auth.** None. No route requires any credential; `createServer`'s `ApiOptions` (`index.ts:93-104`) exposes `store`, `auditDefaults`, and `allowedRoots` only. A caller that can reach the port can register any allowed-root path, trigger scans, and download reports. **Severity: High for any network exposure; acceptable for localhost-only use** (the binary's default is `http://localhost:4173`, `bin.ts:5,25`). **Reproduce:** start the server (`pnpm --filter @veylqorix/api start` after build), then `curl http://localhost:4173/api/repositories`.

**CORS.** `send()` unconditionally sets `Access-Control-Allow-Origin: *` for every response (`index.ts:125`), the `OPTIONS` handler does the same (`index.ts:175-181`), and `/api/reports/:scanId` adds it again (`index.ts:360`). The API performs mutations (`POST /api/repositories`, `POST /api/scan`), so a wildcard with POST allowed means any web origin can trigger scans from a browser and read responses. This compounds F-03.

**Store type.** `createStore(dir?)` (line 60) takes an optional directory but **never uses it** — `_dir` is unused, and the function body is pure in-memory structures (`repositories` array, `scans` Map, lines 61-62). The file header (lines 4-10) says the API "persists repositories and scan results to a JSON store" and "persistence is isolated behind `createStore` so the JSON implementation can be swapped" — that contract is not met by the implementation. Both `bin.ts:11-18` and the tests construct it with no `dir`, so **production is in-memory** and everything is lost on restart. **Remediation:** either implement the JSON file backing (one load at construction, write-through on `putScan`/`addRepository`, matching the header's stated design) or rewrite the header comment to say the store is in-memory and persistence is not yet implemented. Note also the comment "JSON file store. Loads once at construction" (line 57) is factually wrong for the code.

**Root confinement.** Real and working: `allowedRoots` default `[]` means *no* restriction (`index.ts:114,107-108`); when non-empty, `POST /api/repositories` (lines 198-201) and the implicit-register path in `POST /api/scan` (lines 214-217) both reject out-of-tree paths with 403 / undefined-respectively. `bin.ts:6-9` populates it from `VEYLQORIX_ALLOWED_ROOTS` (comma/whitespace-separated, `path.resolve`d). The `isUnderAny` check (line 106-109) is correct: `candidate === r || candidate.startsWith(r + '/')` avoids the classic prefix-truncation bug (`/etc` is not "under" `/etc2`). **Gap:** scannable roots are confined, but a registered repo's *path* is stored and then handed verbatim to `runAudit({ root: repo.path })` (line 136-142) — a path registered before `allowedRoots` is set is still scanned. This is inherent to the design (register-time check) and not exploitable if `allowedRoots` is set before any POST, which it is in `bin.ts`.

**Routes.** Full list verified: `GET /api/health`, `GET|POST /api/repositories`, `POST /api/scan`, `GET /api/scan/:id[?format]`, `GET /api/scan/:id/findings`, `GET /api/scan/:id/report?format=`, `GET /api/scans?repoId=`, `GET /api/scans/:id`, `GET /api/reports/:scanId?format=`, `GET /api/repo/:id/latest|history`, and a structured 404 fallback (lines 398-400). Scan execution is fire-and-forget with a `running` Map (lines 116, 229-231) and results are polled; a failure of the engine/scanner inside a scan is recorded as `status: 'ERROR'` on the record and **never** as a pass — matching the core's contract. Errors on the wire: any unhandled throw returns `500 { error: message }` (lines 401-404), which can leak internal detail (error messages) — minor, no test.

**`bin.ts`.** `#!/usr/bin/env node`; port from `VEYLQORIX_API_PORT` (default 4173); `VEYLQORIX_OFFLINE=1` → offline; `VEYLQORIX_INCLUDE_TESTS=1` → include tests; `VEYLQORIX_TIMEOUT_MS` (default 120000). The module is also the package's `bin` entry (`packages/api/package.json` → `"bin": { "veylqorix-api": "dist/bin.js" }`, script `start: node dist/bin.js`).

**Tests that cover this area.** `packages/api/src/api.test.ts` (unit-ish, 83-line file: register/scan/403-root/reject-scan-without-registered-repo/404-unknown-route, using in-memory store + `online: false`) and `tests/integration/api-routes.test.ts` (register → scan → poll → SARIF/markdown/json reports → unknown-format 400 → unknown-route 404, real `runAudit` against `tests/fixtures`). Neither test touches CORS headers, OPTIONS, persistence, or the `500` catch-all.

### 2. Rust engine adapter — `packages/core/src/engine/index.ts` (535 lines)

**Discovery.** `resolveEngineBinary(startDir?)` (lines 178-218): (1) `VEYLQORIX_ENGINE` env var if it points at an existing file; (2) upward walk from `startDir` → `process.cwd()` → package-`..` → package-`../..`, bounded at 12 hops, looking for `crates/Cargo.toml` then `crates/target/{release,debug}/veylqorix-engine`; (3) first candidate that `statSync().isFile()` wins. `isEngineAvailable()` (lines 227-233) caches per-env-var only (see F-09). The **adapter** itself (`RustEngineAdapter`, lines 246-528) re-resolves per construction and is created fresh per `runAudit` call (`packages/core/src/audit.ts:186`), so `VEYLQORIX_ENGINE` takes effect per audit with no cross-call cache on the hot path.

**Subprocess protocol.** One JSON request on stdin, one JSON response on stdout, `\n`-terminated. Byte cap `MAX_RESPONSE_BYTES = 16 MiB` (line 37) — exceeding it rejects the round-trip as `EngineProtocolError` (lines 358-377). Wall-clock budget = per-tool `timeoutMs` + `WALL_CLOCK_OVERHEAD_MS` 30 s (lines 46, 288-296), on the rationale that the engine may run up to two external tools (gitleaks, cargo audit) sequentially. Timeout → `SIGKILL` + `EngineTimeoutError` (lines 332-340, 385-387). Exit-code taxonomy (lines 48-54): 0 ok; 64 malformed; 65 root-not-found; 70 internal — all rejected as `EngineProtocolError`, plus "any other non-zero code" (lines 394-404) and "exit 0 with no/invalid JSON / version mismatch / `ok: false`" (lines 407-451) — i.e. **a failed or unparseable engine run is never read as a pass**. EPIPE on stdin is tolerated post-close (lines 455-469).

**Fallback behavior.** `packages/core/src/audit.ts:187-271`: if `adapter.available && !secretsMocked`, the engine is authoritative for the secret scanner and gate; dependency/license evidence + checks are handed off via `engineScan`, or `engineEvaluate` when the secret scanner was deselected. Otherwise the **TypeScript compatibility path** (`audit.ts:274-326`) runs `scanSecrets` locally and `evaluateGate`, and — only when the TS scanner actually executed and the engine was *unavailable* — appends `TS_COMPAT_NOTE` to the secrets scanner notes (lines 77-78, 293-297): "Rust engine unavailable: TypeScript policy engine evaluated the gate (degraded compatibility mode)". `mocks['secrets']` forces the TS path even when the engine is available, and the note is **not** appended in that case (line 295 guards on `engineUnavailable`) — correct: a mock is a test, not a degradation.

**Tests.** `tests/engine-adapter.test.ts` — 2 suites: "engine availability reporting (always runs)" (49-64) plus a `describe.skipIf(!engineAvailable)` suite (65-192+) that pings, scans a clean fixture, scans a secret fixture, classifies garbage/exit-64 responses, and checks `runAudit`'s strict/soft exit-code mapping with the real binary. `ci.yml:41-97` guarantees the release binary exists before `pnpm test` (builds at line 96, tests at line 99), and `cargo test` at line 93 exercises `crates/veylqorix-engine/tests/` (`protocol-e2e.rs`, `gate-differential.rs`, `secret-parity.rs`, `golden.rs`, `external-tools.rs`). `external-tools.rs` probes gitleaks/cargo-audit at run time and SKIPs honestly when absent (`ci.yml:64-84` explains the non-fatal install steps).

### 3. Gate — `packages/core/src/gate/index.ts` (186 lines)

`evaluateGate` (lines 29-149): exceptions suppress matched findings and are recorded in `appliedExceptions` (lines 42-54); blocking = `blockOnSeverity`-match OR `blockOnSecrets` (line 56-58); scanner ERROR / skipped-mandatory / check-FAIL / check-ERROR are bucketed into `blockingReasons` vs `hardFailReasons` per the strict flags, with the deliberate rule that a *skipped mandatory scanner under `blockOnSkippedCheck`* adds to `blockingReasons` but **not** `hardFailReasons` (lines 104-106) — so it degrades coverage to INCOMPLETE rather than forcing FAIL, and the comment (lines 69-76) states the invariant: INCOMPLETE-AND-PASS is impossible. Coverage mapping (lines 109-117): no gaps → `FULL`; gaps → `PARTIAL` if skipped∧errored else `LIMITED`. Result: any `hardFailReason` → `FAIL`; else any gap → `INCOMPLETE`; else `PASS` (lines 132-139).

`exitCodeFor` (lines 163-168): 0 PASS, 1 FAIL, 2 INCOMPLETE-or-LIMITED. `strictExitCode` (lines 182-186): 1 if any `blockingReasons`, else 2 if any `incompleteReasons` or LIMITED/NONE coverage, else 0 — so in strict mode a fully clean audit is the only exit-0 case; INCOMPLETE and PASS map to the same code, which is the documented contract, not a bug (F-08).

**Tests.** `tests/unit/gate.test.ts` (17 cases, lines 54-227) covers clean-pass, blocking-severity FAIL, secret blocking on/off, exception suppression with expiry, scanner-ERROR → INCOMPLETE vs FAIL by flag, skipped-mandatory → INCOMPLETE, report-only policies, and `exitCodeFor` mapping. **Not covered:** `strictExitCode` (no test in `tests/unit/` references it; `tests/engine-adapter.test.ts:191` exercises it end-to-end only when the engine binary is present). `crates/veylqorix-engine/tests/gate-differential.rs` and `secret-parity.rs` verify the Rust engine agrees with this TS reference implementation.

### 4. Reports — `packages/core/src/report/index.ts` + `sarif.ts`

**`toJson`** (lines 9-40): deterministic (sorted findings via `sortBySeverity`), embeds `schemaVersion: 1`, the gate decision, per-scanner status, policy snapshot, and `coverage`. Used by the API report route and the CLI `--json`.

**`toMarkdown`** (lines 64-158): gate icon, coverage, blocking/incomplete/exception sections, scanner table, quality-check table, severity-sorted findings with rule/advisory/remediation, a "findings that block the gate" subsection, and an explicit non-certification footer (lines 153-155: "reports what its scanners found; it does not certify the absence of vulnerabilities"). Empty-findings case is handled with an explicit disclaimer (lines 130-133).

**`toSarif`** (lines 21-72): SARIF 2.1.0, `veylqorixRoot` originalUriBase with root-relative artifact URIs, Windows `\`→`/` conversion (line 138-140), confidence-adjusted level scale (lines 8-14: an unconfirmed CRITICAL degrades from 1.0 to 0.9; INFO never exceeds 0.0), deterministic ordering (rules by id, results by ruleId+resultId, artifacts by uri), and `clean()` (lines 143-153) to drop undefined keys so the output is stable byte-for-byte. Secret values are already redacted by the scanners, so the serializer doesn't reintroduce them (comment line 60-62 of `report/index.ts`; asserted in `tests/unit/report.test.ts:104`).

**Tests.** `tests/unit/report.test.ts` — `toJson` determinism + gate exposure (lines 77-92), `toSarif` validity/redaction/determinism (93-118), `toMarkdown` structure + zero-findings disclaimer (120-129+). The API-layer report route behavior (format switching, 400 on unknown format) is covered in `tests/integration/api-routes.test.ts:177-204`.

### 5. CLI — `apps/cli/src/index.ts` + `cli-args.ts`

**`index.ts` (384 lines) is the executable** (`package.json` → `"bin": { "veylqorix": "dist/index.js" }`). Commands: `scan` (default), `check`, `report`, `config validate`, `hooks install|uninstall`, with legacy aliases `audit|deps|secrets|gate` → `scan`, `checks` → `check` (lines 181-193). It defines its **own** `parseArgs` (lines 91-173) and `ParsedArgs` (72-89), and `main` calls that local parser (line 260).

**`cli-args.ts` (212 lines) is not imported anywhere in `src/` or `tests/`.** Its header says "isolated from the executable entry point so tests can exercise dispatch and flag handling… `index.ts` re-uses these definitions verbatim" (lines 1-4) — that is not what the code does. `apps/cli/dist/cli-args.js` exists, so `cli-args.ts` is compiled by `tsc` (it's in the `tsconfig` glob) and shipped in `dist/`, but nothing consumes it. Divergences in the *executable* path:

- `index.ts` **has no `--strict` flag** (`cli-args.ts` has one, line 165-167) even though `AuditOptions.strict` is a real core option (`packages/core/src/audit.ts:53`) and the engine has `strictExitCode`. So strict mode is unreachable from the CLI.
- `index.ts` **has no `--path` / `--config` aliases** (`cli-args.ts:103-105` has all three: `--root`/`--path`/`--config`), no `hooks remove` alias, and its `hooks` subcommand detection is `argv[1] === 'uninstall'` only (`index.ts:94`), so `hooks remove` is not recognized.
- `index.ts`'s help handling **exits the process** (`process.exit(0)` at line 156) whereas `cli-args.ts` returns a value and exposes `wantsHelp()` (line 206) — the shared version is testable by design, the inline one is not.
- `index.ts` derives `hooksSub` from `process.argv[3] === 'uninstall'` (line 268) — reading raw argv instead of the parsed structure, so `veylqorix hooks install uninstall` would be misread.

**The `check` command (F-05).** **RESOLVED.** Lines 346-354: `onlyScanners: command === 'check' ? [] : parsed.scanners` and `skipQualityChecks: command === 'check' ? false : undefined`. Traced into `runAudit` (`audit.ts:139-158`): `onlyScanners: []` filters `selected` to **zero scanners** (the `filter(s => options.onlyScanners?.includes(s.name))` on an empty array), so no dependency/license scanner runs; `skipQualityChecks: false` means checks **are** detected and run. The net effect is "run only quality checks", which matches the documented intent (`index.ts:7` header: "check [root] — Run only the quality checks") — **but** when a project has *no* applicable checks, the result is an empty scan: zero scanners (secrets was filtered out, so the engine's secret scanner doesn't run either — `audit.ts:180` `secretsSelected` is false → engine goes down the `engineEvaluate` path with no scanners) and an empty checks list. The gate then passes with `FULL` coverage and zero findings, which is *technically* consistent (nothing was requested) but means `veylqorix check` can return exit 0 on a repo full of secrets, because no scanner was asked to look. **Remediation:** document that `check` verifies build/test checks only, or (better) run at least the secret scanner by default for `check`, or make `check` with no applicable checks report `INCOMPLETE` rather than `PASS`. **Note:** this is a semantics question more than a crash; flagged for product decision.

**F-05 outcome (verified 2026-07-10, Bo).** Both paths of `runAudit({onlyScanners: []})` previously exposed the F-05 hole: the Rust-engine path built its gate input from `scannerResults` **before** appending the `secrets` SKIPPED stub (the stub only went into `finalScanners` after the gate was computed, so the engine never saw it and returned `PASS`/exit 0), and the TypeScript compatibility path added no SKIPPED note at all. Fix: when `onlyScanners` (or `skipScanners`) deselects a **mandatory** scanner, `runAudit` now records it as SKIPPED with an explicit note *in the gate input* — the gate then reports `INCOMPLETE` (exit 2, coverage `LIMITED`) on **both** paths. No flag combination (`blockOnSkippedCheck` on/off, `strict` on/off, coverage level) can suppress this: skipped-mandatory is a completeness gap, not a content violation, and `strictExitCode` independently forces exit 2. `check` is now documented as quality-only with `INCOMPLETE`/exit 2 and "secrets unverified" (see `docs/cli.md` command table, and the CLI usage block in `apps/cli/src/index.ts`). Regression tests: `tests/integration/audit.test.ts` → "unselected scanners degrade the gate, never exit 0 (F-05 regression)" — the Rust-path test is gated on `skipIf(!isEngineAvailable())` and the TypeScript compatibility-path test always runs; both assert `INCOMPLETE`, exit 2, non-`FULL` coverage, and the `secrets` SKIPPED "not selected for this audit" note on `tests/fixtures/secret-repo`.

**`hooks` command.** `installHooks`/`uninstallHooks` from `packages/core/src/util/hooks.ts` (exported at `packages/core/src/index.ts:21`), dry-run by default, `--yes` to write, `--pre-push` to add the pre-push hook, `--force` to overwrite, `VEYLQORIX_OVERRIDE=1` emergency bypass baked into the generated hook scripts (lines 279-286). The generated pre-commit hook runs `scan --staged --no-tests --scanners secrets` (line 276) — local convenience only; the authoritative boundary is the GitHub gate (comment, line 279).

**Tests.** None exist for the CLI: `vitest.config.ts` includes `apps/*/src/**/*.test.ts` and no such file is present in `apps/cli/src/` (only `index.ts` and `cli-args.ts`). `tests/integration/audit.test.ts` exercises `runAudit` directly, not the CLI dispatch. **This is the biggest coverage gap in the audit.**

### 6. MCP server — `packages/mcp-server/src/index.ts` (566 lines)

Six tools: `scan_repository`, `scan_dependencies`, `scan_secrets`, `run_security_checks`, `get_findings`, `validate_fix` (lines 209-500). Verified properties:

- **Confinement:** `createServer` throws without ≥1 root (lines 126-128); every tool's `root` goes through `validatePath(requested, roots, { allowMissing: true })` (lines 143-152, from `packages/core/src/util/paths.ts`) which rejects `..` traversal and symlink escapes.
- **Redaction:** defense-in-depth `redactText`/`redactDeep` over all returned payloads (lines 43-112) — AWS, GitHub, Slack, Anthropic, generic `sk-`, Google API key, and private-key blocks.
- **Caps:** `MAX_FINDINGS_PER_RESPONSE` 200, `get_findings` limit default 100 / max 500 (lines 28-30), `MAX_TEXT_CHARS` 60 000 with explicit truncation marker (lines 83-86).
- **No shell:** scanner/check command sets are server-chosen from the project config; caller cannot inject commands (comment lines 120-121; echoed in each tool's `description`).
- **Scanner unavailability is honest:** SKIPPED/ERROR with a note, never a pass (comment lines 122-123; `summarizeDependency`'s unavailable branch at lines 532-534).

**Tests.** `tests/mcp-server.test.ts` — in-memory MCP client against the real server (6 tools enumerated, `/etc` escape rejected, redaction, caps), `beforeAll` uses `roots: [tests/fixtures]` with `online: false` and a 20 s timeout. `vitest.config.ts:1-24` has a dedicated alias shim for `@modelcontextprotocol/sdk` (pnpm hard-links it only into `packages/mcp-server`). `packages/mcp-server/src/` itself may have a second test file; the repo-level one is the one confirmed here.

### 7. GitHub Actions — `.github/workflows/`

**`veylqorix-gate.yml`** (reusable `workflow_call`): least-privilege `permissions: { contents: read, security-events: write }` (lines 33-35), all third-party actions pinned to commit SHAs with verified tag comments. Monorepo detection: `apps/cli/` present → `pnpm install --frozen-lockfile && pnpm build` + `cargo build --workspace --release` for the engine (lines 64-101); otherwise require a global `veylqorix` and **fail loudly if absent** (lines 77-79). The scan step (lines 104-128) runs the CLI twice with identical flags — once to JSON (exit code captured under `set +e`) and once to `--sarif-out` — then a distinct failure ladder (lines 148-171): 0 → green, 1 → FAIL, 2 → INCOMPLETE-with-distinct-message, other → pass-through. SARIF upload is conditional on the file being non-empty (line 142). **Verified design property:** the header (lines 5-8) explicitly states the gate is advisory until the calling repo requires this workflow's status check via branch protection/rulesets.

**`ci.yml`**: install → build → (Rust: fmt check, clippy `-D warnings`, `cargo test`, release build) → `pnpm test` → `pnpm typecheck` → `pnpm lint` (lines 38-105). pnpm 9 pinned, Node 20, all actions SHA-pinned (lines 25-36). gitleaks pinned to v8.30.1 with a non-fatal install (`continue-on-error: true`, lines 74-84) — the engine's tests probe-and-skip when it's absent. **One risk worth noting:** `pnpm-action-setup version: 9` in both workflows vs pnpm 11.9.0 in the local dev env — the workspace `allowBuilds` key is only valid in pnpm ≥ 10.13.0; under pnpm 9 in CI the key is **ignored** (unknown top-level key), which is benign for CI installs (nothing is blocked) but means the placeholder-value problem (F-01) only bites local/dev installs on pnpm 10.14+. (The local pnpm used to verify parsing behavior was 11.9.0.)

**Note:** `ci.yml`'s "Install gitleaks" installs it under `/opt/gitleaks` with a `/usr/local/bin` symlink — the engine test `external-tools.rs` probes for it on PATH at run time, which the symlink satisfies.

### 8. `pnpm-workspace.yaml` (the "odd `allowBuilds`" question)

The file:

```yaml
packages:
  - "apps/*"
  - "packages/*"
allowBuilds:
  esbuild: set this to true or false
  sharp: set this to true or false
```

**Verification of key validity** (done, not assumed):

- The key `allowBuilds` is a real, supported top-level `pnpm-workspace.yaml` setting. pnpm's own error messages in the installed pnpm 11.9.0 binary (`dist/pnpm.mjs`) literally say: *"Add the package to \"allowBuilds\" in your project's pnpm-workspace.yaml to allow it to run scripts. For example: `allowBuilds: ${depPath}: true`"*.
- It was added to the workspace-manifest schema in pnpm 10.13.0 (successor to `onlyBuiltDependencies` / `ignoredBuiltDependencies`).
- **The values are the problem.** The schema is `{ packageName: boolean }`. The YAML here gives the YAML string `set this to true or false`, which parses as a string, not a boolean. pnpm treats a non-`true` value as "do not build this package". So the current file **explicitly blocks `esbuild` and `sharp` from running their postinstall scripts** — the opposite of an allow-list. **Reproduce/verify:** `pnpm install` and confirm `sharp`'s native binary is not linked (`node -e "require('sharp')"` from a workspace package that depends on it, or inspect `node_modules/.pnpm` for the `@img/sharp-*` optional-dep link state). `esbuild` similarly. **Impact today is likely low** — esbuild is a transitive dev dep of vitest/vite (its postinstall just verifies the platform binary, which vite also gets via its optionalDependencies) and `sharp` may not even be in the active dep tree — but the file is actively wrong and will misbehave the moment either package becomes install-critical.
- **Remediation:** set the values to explicit booleans, e.g. `esbuild: true, sharp: true` (if their builds are wanted) or delete the block entirely (pnpm 10.14+ default behavior is to skip all builds unless allowed). Note the mismatch with `ci.yml`/`veylqorix-gate.yml` pinning pnpm 9, which predates the key and will ignore it.

### 9. `apps/cli/package.json`

```json
{
  "name": "@veylqorix/cli",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "bin": { "veylqorix": "dist/index.js" },
  "scripts": { "build": "tsc -p tsconfig.json", "typecheck": "tsc -p tsconfig.json --noEmit" },
  "dependencies": { "@veylqorix/core": "workspace:*" }
}
```

Verified: `bin` points at the compiled entry (shebang present at `apps/cli/src/index.ts:1`). The **only** runtime dependency is `@veylqorix/core` via `workspace:*`; there is no `files` field, so publishing this package would ship the entire directory (a packaging concern for when it's first published; the gate workflow's comment at `veylqorix-gate.yml:61-63` acknowledges it is not yet published). No `devDependencies` — `typescript` comes from the root. The `dist/` folder is committed to the working tree (evidenced by `apps/cli/dist/cli-args.js` existing) — **UNCERTAIN** whether that's intentional or a build artifact that wandered in; it does contain a compiled copy of `cli-args.js`, which is what proves `cli-args.ts` is part of the tsc glob.

## Baseline command list

Commands and checks that establish the current truth-of-state, per the areas above. (None were run as part of this read-only audit except the file reads; they are listed as the verification harness.)

```bash
# Engine binary resolution (the whole engine story hangs off this)
ls -la crates/target/release/veylqorix-engine   # does it exist?
VEYLQORIX_ENGINE=/nonexistent node -e "console.log(process.env.VEYLQORIX_ENGINE)"
cargo build --manifest-path crates/Cargo.toml --workspace --release   # rebuild
cargo test  --manifest-path crates/Cargo.toml --workspace --all-features

# TypeScript test matrix
pnpm test          # vitest run (root): tests/** + packages/*/src/** + apps/*/src/**
pnpm typecheck     # tsc -p tsconfig.json --noEmit
pnpm lint          # eslint . --ext .ts --max-warnings 0

# API behavior
pnpm --filter @veylqorix/api build && node packages/api/dist/bin.js
curl -s http://localhost:4173/api/health
curl -s -X POST http://localhost:4173/api/repositories -H 'content-type: application/json' -d '{"path":"/tmp"}'
curl -s -i -X OPTIONS http://localhost:4173/api/scan | grep -i access-control

# CLI
pnpm --filter @veylqorix/cli build
node apps/cli/dist/index.js scan --root tests/fixtures/secret-repo --offline; echo "exit=$?"
node apps/cli/dist/index.js check --root tests/fixtures/clean-repo --offline; echo "exit=$?"   # F-05 probe
node apps/cli/dist/index.js scan --root tests/fixtures/clean-repo --offline --strict          # F-04 probe (expect "Unknown option")

# pnpm-workspace allowBuilds (F-01)
pnpm install --frozen-lockfile
node -e "try{require('sharp')}catch(e){console.log('sharp status:', e.message)}"   # from a dep on sharp, if any
```

## Uncertain items (explicitly not verified)

- Whether `apps/cli/dist/` is intentionally committed or an accidental build-output commit (only `dist/cli-args.js` existence was observed, not `git log` on the folder).
- Whether `sharp` or `esbuild` currently have any package in the active dep tree that actually depends on them directly — the lockfile has `@img/sharp-*` optional-dep entries and `esbuild@0.28.2` as a vite/vitest transitive, but I did not enumerate which `package.json` declares them.
- The contents of `packages/mcp-server/src/` beyond `index.ts` (only `index.ts` was read).
- The full bodies of `crates/veylqorix-engine/tests/*` (only their names and the CI wiring were confirmed).
- Whether `docs/engineering/` is a new convention or an established directory (it did not exist before this audit; `docs/` contains `api.md cli.md dashboard.md engine.md faq.md github-actions.md mcp.md troubleshooting.md`).
