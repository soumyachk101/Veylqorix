# GitHub Actions: Veylqorix Security Gate

## Reusable workflow

The Veylqorix monorepo ships `.github/workflows/veylqorix-gate.yml` as a
`workflow_call` reusable workflow. A calling repo invokes it like this:

```yaml
# .github/workflows/veylqorix.yml
name: Veylqorix Gate
on:
  push:
  pull_request:

jobs:
  veylqorix:
    uses: your-org/veylqorix/.github/workflows/veylqorix-gate.yml@main
    with:
      root: .
      run-tests: false
      block-on: HIGH,CRITICAL
```

## What the gate does

1. Checks out the calling repo with full history.
2. Builds the CLI from source (monorepo) or uses the installed binary.
3. Runs `veylqorix scan` and captures the exit code.
4. Emits a SARIF report and uploads it to GitHub code scanning.
5. Uploads JSON + stderr as workflow artifacts.
6. Exits non-zero on any blocking finding or incomplete coverage.

## Enforcing the gate

The gate only blocks merges when the calling repo **requires its status check**
via branch protection or a ruleset:

1. In the calling repo: Settings → Branches → Branch protection rules.
2. Add the Veylqorix gate job as a required status check.
3. Optionally enable "Require branches to be up to date" to prevent bypasses.

Until that is configured the gate is advisory: it runs, produces findings, and
exits non-zero, but GitHub will not block the merge.

## Rust engine

The CI workflow (`.github/workflows/ci.yml`) also builds and validates the
Rust security engine in `crates/`: it sets up the Rust toolchain (stable,
with clippy and rustfmt), then runs `cargo fmt --check`, `cargo clippy`,
`cargo test`, and a release build — all before `pnpm test`, because the
TypeScript engine-adapter tests spawn the real engine binary at
`crates/target/release/veylqorix-engine` over its stdio protocol.

The gate workflow builds the release engine in the monorepo branch: when the
CLI is built from source, the engine binary is compiled with
`cargo build --workspace --release` before the scan runs, so the CLI's
engine adapter can find it. If the binary is missing, the engine reports
itself as a skipped scanner in the scan response (never as a non-zero
exit).

As with the rest of the gate, requiring the gate check via branch
protection or a ruleset is the caller's responsibility — the workflows
themselves do not block merges.

## Permissions

The workflow requests `contents: read` and `security-events: write` only.
No secrets are forwarded into the called workflow.

## Limitations

- `@veylqorix/cli` is not yet published to the npm registry. Non-monorepo
  callers cannot `npm install` it. The gate fails loudly in that case rather
  than silently skipping.
- SARIF upload requires `security-events: write`; in some configurations this
  is unavailable and the step will skip.
