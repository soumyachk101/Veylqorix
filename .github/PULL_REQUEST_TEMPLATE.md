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
- [ ] `packages/plugin` (scanner extension SDK)
- [ ] `crates/` (Rust security engine)
- [ ] `.github/workflows`
- [ ] `tests/`
- [ ] Docs / community files

## Verification

Per [CONTRIBUTING.md](CONTRIBUTING.md), all four must pass — paste the results:

```
pnpm build && pnpm typecheck && pnpm lint && pnpm test
```

Rust engine changes (anything under `crates/`): the cargo steps below run
before `pnpm test` in CI, and `pnpm test` depends on the release binary they
build. All four must pass — paste the results:

```
cargo fmt --manifest-path crates/Cargo.toml --all -- --check
cargo clippy --manifest-path crates/Cargo.toml --workspace --all-targets --all-features -- -D warnings
cargo test --manifest-path crates/Cargo.toml --workspace --all-features
cargo build --manifest-path crates/Cargo.toml --workspace --release
```

- [ ] All commands passed
- [ ] New behavior covered by a test (fixtures use fake data only — never
      real credentials)

CI (`.github/workflows/ci.yml`) and the `veylqorix-gate` status check are the
actual gate: CI must be green before merge, and the gate blocks a merge only
where a branch-protection rule or ruleset requires its check. Do not weaken
the gate to make it green.

## Ground-rules check

- [ ] No fabricated results — scanner outputs, severities, and exit codes come
      from real runs; skipped checks report SKIPPED / ERROR, not a pass
- [ ] Gate semantics not weakened (INCOMPLETE = exit 2 is still not a pass)
- [ ] No secret value appears in any output path
- [ ] No new dependencies without justification

## Screenshots / samples

Optional: sample CLI output, dashboard state, or report excerpts (secrets
redacted).
