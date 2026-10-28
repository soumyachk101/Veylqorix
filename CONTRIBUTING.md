# Contributing to Veylqorix

## Setup

```
pnpm install
pnpm build
pnpm test
```

Requires Node 22.13+ (root `engines`) and pnpm 11.9.0 (pinned via the root
`packageManager`; enable it with `corepack enable`). Do not use pnpm 9: the
security-critical `overrides` and `allowBuilds` keys live in
`pnpm-workspace.yaml` and are only read by pnpm >= 11 (see
`docs/engineering/SUPPLY_CHAIN.md` §1.1), so a pnpm 9 install is not
equivalent to the one CI runs.

Engine work (the Rust security engine) additionally requires a stable
Rust toolchain. All cargo commands target the workspace manifest at
`crates/Cargo.toml` (there is no `Cargo.toml` at the repo root):

```
cargo fmt --manifest-path crates/Cargo.toml --all -- --check
cargo clippy --manifest-path crates/Cargo.toml --workspace --all-targets --all-features -- -D warnings
cargo test --manifest-path crates/Cargo.toml --workspace --all-features
cargo build --manifest-path crates/Cargo.toml --workspace --release
```

Engineering reference: `docs/engineering/` (security hardening, engine
parity, release readiness, storage and operations, supply chain, and
baseline audit notes).

## Layout

- `packages/core` — the security engine. All scanner, policy, gate, and report
  logic lives here and must stay independent of CLI/MCP/API/web.
- `apps/cli` — the `veylqorix` binary.
- `packages/mcp-server` — MCP tools (adapters over core, no scanner logic).
- `packages/api` — REST API that runs real scans for the dashboard.
- `packages/plugin` — the scanner extension SDK: custom scanners and checks
  that plug into `runAudit` as purely additive evidence (shell-free exec,
  no silent passes). See `docs/plugin.md`.
- `packages/skills` — the portable AI-agent skill + MCP client configs.
- `apps/web` — Next.js landing page and dashboard; proxies `/api` to the
  server via Next.js rewrites (`NEXT_PUBLIC_API_BASE`).
- `tests/` — unit tests and integration fixtures (fake data only, never real
  credentials).

## Ground rules

1. **No fabricated results.** Every scanner output, severity, or exit code
   must come from a real tool run. If a check cannot run, report SKIPPED or
   ERROR with a reason.
2. **Never weaken the gate to make a test pass.** The gate's INCOMPLETE
   semantics (exit 2, never a pass) are tested on purpose.
3. **Redact secrets everywhere.** A secret value must not appear in any output
   path (findings, reports, logs, API responses).
4. **No new dependencies without justification.** Prefer the standard library
   and already-pinned tools.
5. Add a test for every meaningful change; run `pnpm build && pnpm typecheck &&
   pnpm lint && pnpm test` before opening a PR.

## Naming and style

- TypeScript strict mode is on (`noUncheckedIndexedAccess`,
  `noImplicitOverride`). Match it.
- Scanners are pure functions of (root, options, detection); keep them that way
   so they can be unit-tested with `mockFindings`.

## Releasing

See `CHANGELOG.md` for the release checklist.

## Pull requests

Branches come off `main` and are named by kind: `feat/...`, `fix/...`,
`docs/...`, or `chore/...`. Commits use the repo's existing
conventional-commit style (e.g. `docs(release): ...`, `fix(ci): ...`).

Before opening a PR, run the four-command gate and paste its results into
the PR, per the [pull request
template](.github/PULL_REQUEST_TEMPLATE.md):

```
pnpm build && pnpm typecheck && pnpm lint && pnpm test
```

- `pnpm build` — builds every package (`pnpm -r build`).
- `pnpm typecheck` — `tsc -p tsconfig.json --noEmit`.
- `pnpm lint` — `eslint . --ext .ts --max-warnings 0`.
- `pnpm test` — `vitest run`.

CI (`.github/workflows/ci.yml`) is the full gate: `pnpm install
--frozen-lockfile`, `pnpm -r build`, the cargo workspace checks (fmt,
clippy, test, release build at `crates/Cargo.toml`), then `pnpm test`,
`pnpm typecheck`, and `pnpm lint`. The cargo steps run before `pnpm test`
on purpose: the engine-adapter tests spawn the release binary that the
cargo build produces.
