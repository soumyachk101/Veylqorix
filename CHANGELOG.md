# Changelog

All notable changes to Veylqorix are documented here.

## Unreleased

### Plugin SDK (`@veylqorix/plugin`)
- New `packages/plugin`: the **scanner extension SDK**. `definePlugin`
  validates/freezes a plugin (custom scanners + quality checks);
  `toAuditOptions` / `withPlugin` / `runPluginAudit` hand its evidence to
  `runAudit`. Plugins are purely additive: their findings pass through the
  core's `normalizeFindings` (deterministic ids, severity/confidence
  clamping, malformed entries dropped), their exec is the core's shell-free
  `execFileAsync`, and the gate stays single-sourced (Rust engine when the
  binary is available, byte-compatible TypeScript engine otherwise).
- `@veylqorix/core`: `runAudit` accepts optional `externalScanners`
  (`ScannerDefinition[]`, executed under the same safe wrapper — a thrown
  error or overrun becomes an `ERROR` result, never a pass) and
  `externalChecks` (`ExternalCheck[]`, run after the built-in checks, honoring
  `skipQualityChecks`; a failing runner is recorded as an `ERROR` check).
  Defaults are empty, so existing `runAudit` callers are unaffected.
  `ExternalCheck` / `ExternalCheckContext` are exported from the package
  entry; `ExecResult` / `ExecOptions` are now re-exported too.
- Tests: `packages/plugin/src/plugin.test.ts` (20 tests: validation,
  bridge mapping, finding normalization, end-to-end `runPluginAudit` on
  both gate authorities) and
  `packages/core/src/audit-external.test.ts` (7 regression tests pinning
  the no-silent-pass invariant for the extension slots).
- Docs: [docs/plugin.md](docs/plugin.md) (authoring guide + API reference);
  README gains a Plugin SDK section, a "Surfaces at a glance" row, and the
  layout/docs entries. Not yet published to npm — consume from source
  (`workspace:*`) until publish, same as the CLI.

### Release readiness (`@veylqorix/cli` + `@veylqorix/core`)
- Packaging hardened for external publication: `files` set to `["dist"]` on
  both packages (no `src/`, `tsconfig.json`, lockfiles, or test output in the
  tarball), `engines` (`node >=20.18`) and `publishConfig.access` added. The
  `workspace:*` dependency is resolved by publishing `@veylqorix/core`
  alongside the CLI at matching semver (core first, so the range resolves) —
  `workspace:` is never shipped to a consumer.
- `.github/workflows/release.yml` (new, opt-in, no token secret): on `v*`
  tag only, builds, packs, and `npm publish --provenance` via GitHub OIDC
  trusted publishing (no commit/tag push, no write permissions). **Inert
  until the owner registers the trusted publisher for each package** —
  publish fails closed otherwise. No bot user or GitHub App is involved.
- `docs/engineering/RELEASE_READINESS.md`: dry-run pack contents, engine
  binary resolution (`VEYLQORIX_ENGINE` env var + developer-checkout walk,
  no bundled/downloaded binary), the labeled degraded-coverage behavior when
  the engine is absent, owner setup steps, and clean-consumer validation
  commands + expected outputs.
- `docs/cli.md`: install/upgrade, engine prerequisite, cross-platform notes,
  and exit-code examples matching the implementation.
- Status: packaging validated locally (dry-run only). **Owner actions
  remaining:** trusted-publisher setup for each package, first `v*` tag, and an
  engine-binary distribution story (a verified platform artifact or
  documented build step). No publish/release/tag has been performed yet.

### Release fixes (`0.1.1`)
- `@veylqorix/core` and `@veylqorix/cli` are now `0.1.1`. Nothing was
  published at `0.1.0` — the `v0.1.0` release run failed **before** npm was
  ever called, so `0.1.0` remains free on the registry.
- `.github/workflows/release.yml`: the publish job's artifact download now
  extracts into `packaged-tarballs/`, matching the path the publish steps
  glob. This path mismatch is the actual cause of the `v0.1.0` run failure
  (`ls: cannot access 'packaged-tarballs/veylqorix-core-*.tgz'`); npm was
  never invoked and nothing was published. A new step waits until the
  published `@veylqorix/core` version is visible on the registry before the
  CLI is published, so the CLI's concrete core dependency always resolves.
- `.github/workflows/veylqorix-gate.yml`: `root` and `block-on` inputs are
  passed through the environment and validated, instead of being
  interpolated into the shell source. A calling repository could previously
  break out of the quotes and run arbitrary commands in the gate job.
- `@veylqorix/core` no longer declares `semver` and `zod`: neither is
  imported by the package's source or its build output. The published core
  tarball now has zero runtime dependencies.
- Root `engines.node` raised to `>=22.13` (the floor pnpm 11.9.0 requires);
  the published packages keep `>=20.18`, which is the consumer runtime floor.
- Docs: `NPM_PUBLICATION_AUDIT.md`, `NPM_PUBLICATION_REPORT.md`,
  `NPM_TRUSTED_PUBLISHING_SETUP.md` and `RELEASE_READINESS.md` reconciled
  with the verified state of the registry, the Actions history and the
  release procedure.

### Rust security engine (`crates/veylqorix-engine`)
- New pure-Rust engine crate (`crates/`, workspace manifest at
  `crates/Cargo.toml`): deterministic policy resolution, gate evaluation,
  exit-code mapping (0 PASS / 1 FAIL / 2 INCOMPLETE, plus the strict variant),
  and the offline secret scanner, exposed over a bounded JSON-over-stdio
  protocol (`PROTOCOL_VERSION` 1, `SCHEMA_VERSION` 1; 8 MiB input / 16 MiB
  output caps; process exit 0/64/65/70 — a scanner failure inside a scan is a
  `SKIPPED`/`ERROR` result, never a non-zero exit).
- Byte-compatible with the TypeScript core: same stable finding ids (e.g.
  `SECRETS-8C5562BA`), same redaction format (`AKIA…CDEF (20 chars,
  redacted)`), same gate and `exitCodeFor`/`strictExitCode` mapping —
  cross-verified by 60 passing tests (`cargo test` in `crates/`), including
  golden vectors, gate differential tests, secret-parity tests, and
  protocol e2e tests that spawn the real binary.
- Gitleaks delegation (`preferGitleaks`, opt-in; built-in offline rules stay
  the authoritative default) and `cargo audit` for Rust ecosystems
  (`runCargoAudit`); missing tools or a missing lockfile are reported
  `SKIPPED`, timeouts `ERROR` — never a silent pass.
- CI (`.github/workflows/ci.yml`) sets up the Rust toolchain and runs
  `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, and a
  release build before the TypeScript suite.
- Compatibility: CLI exit codes (0/1/2/64/65/70), MCP tool contracts, API
  routes, the finding schema, and redaction behavior are unchanged.
- TypeScript adapter (`packages/core/src/engine/index.ts`): resolves the
  binary (`VEYLQORIX_ENGINE` env var, then `crates/target/release`, then
  `crates/target/debug`), spawns it with one JSON request on stdin and one
  JSON response on stdout under a byte cap and a wall-clock timeout, and
  classifies failures into structured errors
  (`EngineUnavailableError`, `EngineProtocolError`, `EngineResponseError`,
  `EngineTimeoutError`). Invoked by `runAudit` in
  `packages/core/src/audit.ts`, so the CLI, MCP server, and API all use the
  engine when the binary is present.
- Status: the engine is implemented, integrated, and verified. When the
  binary is available, `runAudit` is authoritative through the engine
  (secret scanner + gate + exit codes); when it is unavailable (or a caller
  requests deterministic secret mocks), `runAudit` degrades to the
  byte-compatible TypeScript secret scanner/policy engine and records a
  **labeled** compatibility-mode note on the secret scanner result, never a
  silent pass. Details: `docs/engine.md`.

## 0.1.1 (2026-10-25)

Next.js dashboard, MCP tooling, CLI/hooks hardening, CI pinning.

### API (`packages/api`)
- New read routes for the dashboard: `GET /api/scans` (list, optional
  `?repoId` filter), `GET /api/scans/:id` (scan detail), and
  `GET /api/reports/:scanId` with `?format=markdown|json|sarif` serving the
  report as a downloadable attachment (202 while running, 404 unknown scan,
  400 unknown format).
- All error responses are structured JSON; registered/scanned paths are
  validated against `allowedRoots`; secrets stay redacted in every response.
- New integration suite `tests/integration/api-routes.test.ts`: register the
  `secret-repo` fixture, run a real scan, verify the redacted secret finding,
  and verify the SARIF report round-trip.

### CI (`.github`)
- Added `.github/workflows/ci.yml`: `pnpm install` → `pnpm -r build` →
  `pnpm test` → `pnpm typecheck` → `pnpm lint`, with every action pinned to a
  commit SHA.
- `veylqorix-gate.yml`: all action pins corrected to the real tag commit SHAs
  (verified against GitHub), SARIF now included in the uploaded artifact, and
  an enforcement comment documenting that the gate blocks merges only when a
  branch-protection rule requires its status check.

### Docs & configuration
- New `docs/mcp.md` (MCP setup + example `.mcp.json`), `docs/cli.md`
  (commands, options, exit codes, hooks install), `docs/dashboard.md`
  (run API + web app), and `docs/faq.md` (honest "scanner unavailable" /
  "advisory gate" limitations, cross-linked from `docs/troubleshooting.md`).
- README quick start now covers build → test → run API → open dashboard, plus
  an integrations table (CLI, MCP, GitHub Actions, Skills, Dashboard) with
  verified status.
- `.env.example` covers the API, web, and MCP environment variables
  (including `NEXT_PUBLIC_API_BASE`), with no real credentials.

## 0.1.0 (2026-10-25)

First public build of the Veylqorix security platform.

### Core engine (`packages/core`)
- Project detection across Node, Python, Go, Rust, Java, Ruby, PHP, and .NET manifests.
- Dependency scanner backed by `npm audit` (Node) and `pip-audit` (Python) with a
  deterministic mock mode for offline tests.
- Offline secret scanner with 9 rule families; matched values are redacted in
  every output surface.
- License scanner for manifest-level license declarations and copyleft risk.
- Quality check runner for TypeScript, ESLint, Ruff, and project test scripts.
- Normalized `Finding` schema, SARIF 2.1.0 export, and a JSON report with the
  gate decision embedded for CI branching.
- Quality gate with deterministic exit codes: 0 PASS, 1 FAIL, 2 INCOMPLETE.
- Configurable policy with documented, auditable, expirable exceptions capped by
  `maxExceptions`.

### CLI (`apps/cli`)
- `scan`, `check`, `report`, `config validate`, and `hooks install|uninstall`.
- Staged-scan mode (git-index scoped), `--format json|markdown|sarif`, and
  machine-readable `--json` output.
- Safe hook installer that never touches `git config` and backs up non-Veylqorix
  hooks before replacing them.

### MCP server (`packages/mcp-server`)
- Six tools: `scan_project`, `check_dependencies`, `detect_secrets`,
  `run_quality_checks`, `get_audit_report`, `verify_quality_gate`.
- Zod-validated inputs; filesystem access confined to configured workspace
  roots; symlink-escape protection.

### API (`packages/api`)
- REST endpoints: repository registration, scan creation, status polling,
  finding retrieval, and report export in JSON, Markdown, or SARIF.
- Optional `allowedRoots` for least-privilege path restriction.

### Web dashboard (`apps/web`)
- Premium landing page and security dashboard backed by the API.
- Live scan data when the API is reachable; clearly-labeled demo data otherwise.
- Original design system: accessible color contrast, keyboard navigation, no
  emoji, responsive down to 360px.

### Skill (`packages/skills`)
- Portable `SKILL.md` in Agent Skills format plus MCP client configs for
  Claude Code, Codex, and Cursor.

### CI
- Reusable `veylqorix-gate` GitHub Actions workflow with SARIF upload and
  least-privilege permissions.

---

## Release checklist

- [x] `pnpm build` — all packages compile
- [x] `pnpm typecheck` — strict TypeScript, zero errors
- [x] `pnpm lint` — zero warnings
- [x] `pnpm test` — 69 tests across 9 files
- [x] Dashboard demo flow verified end-to-end
- [ ] `@veylqorix/cli` published to the registry (non-monorepo callers need it)
- [ ] Gitleaks integration for higher-fidelity secret detection
- [ ] GitHub Actions `branch protection` docs with screenshots
