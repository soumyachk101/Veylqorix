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

## Single-scan flow

One authoritative scan feeds every report format. The `Run Veylqorix scan`
step invokes the CLI exactly once:

```
veylqorix scan --root <root> --block-on <severities> --json \
  --report-out veylqorix.md --sarif-out veylqorix.sarif > veylqorix.json
```

The single invocation renders all three artifacts from the same audit
result via the shared `renderAllReports` path in `@veylqorix/core`: JSON to
stdout, Markdown to `veylqorix.md`, SARIF to `veylqorix.sarif`. The gate
never runs a second scan to keep any one format clean — the exit code of
this one run drives the whole gate. Raw stdout, the reports, and stderr
are uploaded as workflow artifacts on both success and failure, so a red
gate is always reproducible from the run page.

## Exit-code semantics

The `Evaluate gate result` step maps the scan's exit code to a verdict; each
outcome is distinct and INCOMPLETE is never treated as green:

| Scan exit | Gate outcome | Step result |
| --- | --- | --- |
| 0 | PASS | green |
| 1 | FAIL — blocking findings present | red |
| 2 | INCOMPLETE — a mandatory scanner could not run to completion; the scan never reports PASS when coverage is degraded | red (distinct message) |
| 70 | REPORT-ERROR — the scan process hit an unexpected error; see `veylqorix.stderr` | red |
| other | UNEXPECTED — the scan exited with an unrecognized code; that code is propagated | red |

If no usable CLI exists in the calling repo (neither this monorepo's
`apps/cli` source nor an installed `veylqorix` binary), the gate reports
NO-SCAN and exits 70 with an explicit `::error` — a gate that cannot scan
cannot be green.

## SARIF policy

The SARIF artifact is validated before it is ever posted, mirroring
`validateSarifFile` in `@veylqorix/core`:

- **Missing file** — if the scan step did not produce a non-empty
  `veylqorix.sarif`, the scan step itself fails with an `::error` context
  and exit 70. The missing file is a visible failure, never a silently
  skipped upload.
- **Validate-then-upload** — the `Validate SARIF artifact` step (an inline
  Node check) requires a valid SARIF 2.1.0 document with at least one run,
  and runs before the upload. An invalid document (wrong version, no runs,
  malformed JSON) fails this step red with the specific reason, instead of
  reaching the upload as a misleading success.
- **Upload failure is a failure** — `Upload SARIF to code scanning`
  (`github/codeql-action/upload-sarif`) requires the
  `security-events: write` permission and an enabled code-scanning
  configuration. If the permission is missing, code scanning is disabled,
  or the upload otherwise fails, the step fails red; the workflow never
  reports a successful upload that did not happen.

The gate workflow's artifact upload step uploads on success and on failure
(its condition is `steps.prepare.outputs.cli-src == 'true' &&
(failure() || !cancelled())`) with `if-no-files-found: ignore` and only the
explicit file paths (`veylqorix.json`, `veylqorix.md`, `veylqorix.sarif`,
`veylqorix.stderr`), so a partially failed scan still preserves whatever
exists.

## Pinned actions

All third-party actions are pinned to full commit SHAs (verified against the
action's tagged commit on GitHub) so a tag rewrite upstream cannot change
what the gate executes:

| Action | Pinned SHA | Version |
| --- | --- | --- |
| `actions/checkout` | `11bd71901bbe5b1630ceea73d27597364c9af683` | v4.2.2 |
| `pnpm/action-setup` | `a7487c7e89a18df4991f7f222e4898a00d66ddda` | v4.1.0 |
| `actions/setup-node` | `1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a` | v4.2.0 |
| `dtolnay/rust-toolchain` | `683b588c487a69d01f6c6ddf40f036ff682cc2c8` | v1 |
| `actions/upload-artifact` | `50769540e7f4bd5e21e526ee35c689e35e0d6874` | v4.4.0 |
| `github/codeql-action/upload-sarif` | `4e828ff8d448a8a6e532957b1811f387a63867e8` | v3.29.4 |

Supply-chain note: beyond action SHAs, the CI workflow
(`.github/workflows/ci.yml`) verifies external download integrity — the
gitleaks v8.30.1 release asset is fetched by SHA-pinned URL and the step
fails closed on any SHA-256 mismatch (recorded digest:
`551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`).

## Permissions rationale

The workflow requests `contents: read` and `security-events: write` only:
read the scanned content, write to code scanning for the SARIF upload.
Nothing else is needed, and no secrets are forwarded into the called
workflow. The restricted permissions also make the SARIF path fail-closed:
if `security-events: write` is unavailable, the upload step fails visibly
rather than being silently skipped.

## Rust engine

The CI workflow (`.github/workflows/ci.yml`) builds and validates the Rust
security engine in `crates/`: it sets up the Rust toolchain (stable, with
clippy and rustfmt), then runs `cargo fmt --check`, `cargo clippy`,
`cargo test`, and a release build — all before `pnpm test`, because the
TypeScript engine-adapter tests spawn the real engine binary at
`crates/target/release/veylqorix-engine` over its stdio protocol.

The gate workflow builds the release engine in the monorepo branch: when
the CLI is built from source, the engine binary is compiled with
`cargo build --manifest-path crates/Cargo.toml --workspace --release`
before the scan runs, so the CLI's engine adapter can find it. If the
binary is missing, the CLI degrades to the labeled TypeScript engine
(`docs/cli.md` § "Engine binary"); the scan
does not fail because of the missing binary — the run carries an explicit
"degraded compatibility mode" note and still exits `0` on a clean tree.
Coverage degrades to `INCOMPLETE` (exit `2`) only when a scanner
separately could not run (offline mode, a missing tool, an errored
check), which is a distinct, reported reason — never a silent pass.

## Manual owner step: enforcing the gate

**Making the gate a required status check is NOT done by the repo.** The
workflows in this repository run, produce findings, and exit non-zero,
but they do not block merges and do not configure any branch protection or
ruleset themselves. Until the repository owner explicitly configures one
of the following, the gate is **advisory only** — a red check does not
prevent a merge:

1. **Branch protection**: Settings → Branches → Branch protection rules →
   add the Veylqorix gate job's check as a *required status check*.
2. **Rulesets**: Settings → Rules → add a required status check for the
   gate job on the protected branches.

This document does not claim that such protection is active on this repo
or on any calling repo; the owner must verify the configuration in the
repository settings.

## Limitations

- `@veylqorix/cli` is not yet published to the npm registry in a working
  version. `@veylqorix/core@0.1.1` is published (with a provenance
  attestation), but the CLI still awaits an owner step (register its
  npm trusted-publisher record, then re-trigger the `v0.1.1` release) — see
  `docs/engineering/RELEASE_READINESS.md` and
  `docs/engineering/NPM_TRUSTED_PUBLISHING_SETUP.md` § 6. Until the CLI is
  published, non-monorepo callers cannot `npm install` a usable CLI; the
  gate fails loudly (NO-SCAN, exit 70) rather than silently skipping the
  scan.
- SARIF upload requires `security-events: write`; in configurations where
  it is unavailable, the upload step fails red with context — the gate is
  never reported green on an unposted SARIF.
