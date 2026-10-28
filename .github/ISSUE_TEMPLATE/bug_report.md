---
name: Bug report
about: Report a bug or unexpected behavior in Veylqorix
title: 'bug: '
labels: bug
assignees: soumyachk101
---

## What happened?

A clear description of the bug — what you expected, and what actually happened
including any exit codes (0 PASS / 1 FAIL / 2 INCOMPLETE / 64 / 65 / 70).

## Reproduction steps

```
# exact commands to reproduce, e.g.
node apps/cli/dist/index.js scan --root /path/to/repo --json
```

## Environment

- Veylqorix version / commit:
- OS / arch:
- Node version:
- pnpm version:

## Which surface?

- [ ] CLI (`veylqorix`)
- [ ] MCP server
- [ ] API / dashboard
- [ ] GitHub Actions gate
- [ ] Git hooks
- [ ] Rust engine (`crates/veylqorix-engine`)
- [ ] Plugin SDK (`packages/plugin`)
- [ ] Other:

## Engine status

The Rust engine is the leading cause of `INCOMPLETE` or degraded secret
scans. Note which applies:

- Is `veylqorix-engine` built and present (`VEYLQORIX_ENGINE` set, or
  `crates/target/release/veylqorix-engine` / `crates/target/debug/`)?
- Does the secret-scanner result carry the labeled **degraded
  compatibility mode** note (engine binary unavailable → in-process
  TypeScript fallback), or a `SKIPPED`/`ERROR` engine result?
- Which gate authority ran — the Rust engine, or the byte-compatible
  TypeScript fallback?

## Additional context

Add any other context (scanner status — SKIPPED / ERROR notes, policy file,
redacted findings). **Never paste real credentials**; Veylqorix redacts
secrets in its own output, but templates in issues do not.
