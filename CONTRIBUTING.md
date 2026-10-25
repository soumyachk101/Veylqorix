# Contributing to Veylqorix

## Setup

```
pnpm install
pnpm build
pnpm test
```

Requires Node 20.18+ and pnpm 9+.

## Layout

- `packages/core` — the security engine. All scanner, policy, gate, and report
  logic lives here and must stay independent of CLI/MCP/API/web.
- `apps/cli` — the `veylqorix` binary.
- `packages/mcp-server` — MCP tools (adapters over core, no scanner logic).
- `packages/api` — REST API that runs real scans for the dashboard.
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
