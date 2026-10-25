# Pull Request

**Related issue:** #

## Summary

What this PR changes and why, in 1–3 sentences.

## Type of change

- [ ] New feature / scanner / tool
- [ ] Bug fix
- [ ] Docs
- [ ] Refactor (no behavior change)
- [ ] CI / tooling
- [ ] Other:

## Affected surfaces

- [ ] `packages/core` (engine)
- [ ] `apps/cli`
- [ ] `packages/mcp-server`
- [ ] `packages/api`
- [ ] `apps/web`
- [ ] `packages/skills`
- [ ] `.github/workflows`
- [ ] `tests/`
- [ ] Docs / community files

## Verification

Per [CONTRIBUTING.md](CONTRIBUTING.md), all four must pass — paste the results:

```
pnpm build && pnpm typecheck && pnpm lint && pnpm test
```

- [ ] All commands passed
- [ ] New behavior covered by a test (fixtures use fake data only — never
      real credentials)

## Ground-rules check

- [ ] No fabricated results — scanner outputs, severities, and exit codes come
      from real runs; skipped checks report SKIPPED / ERROR, not a pass
- [ ] Gate semantics not weakened (INCOMPLETE = exit 2 is still not a pass)
- [ ] No secret value appears in any output path
- [ ] No new dependencies without justification

## Screenshots / samples

Optional: sample CLI output, dashboard state, or report excerpts (secrets
redacted).
