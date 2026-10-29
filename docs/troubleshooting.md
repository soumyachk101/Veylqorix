# Troubleshooting

## The gate reports INCOMPLETE (exit 2) instead of PASS

INCOMPLETE means coverage was degraded: a scanner errored, a mandatory check was
skipped, or a scanner could not run. This is by design — Veylqorix refuses to
treat an incomplete scan as clean.

Common causes:
- `--offline` was passed, so `npm audit` / `pip-audit` were skipped.
- `pip-audit` binary is not installed.
- `npm audit` errored (no lockfile, no network) and the dependencies
  scanner is recorded `ERROR`, degrading coverage.

Fix: ensure the required scanner can run (install the binary, allow network
access, or add a lockfile), then re-run without `--offline`.

## No dependency findings even though a CVE is published

- Offline mode: advisory DB not reached. Remove `--offline`.
- The dependency scanner audits the tree recorded in the lockfile (Node
  projects use `npm audit --package-lock-only` when a lockfile is
  present). Transitive advisories are only visible when the lockfile
  reflects them — if it is missing or out of date, update it
  (`npm install` / `pnpm install`) before scanning.
- The CVE may be newer than the last advisory-DB pull.

## Secret not detected

The built-in rule set covers common formats (AWS keys, GitHub tokens, Slack
tokens, OpenAI/Anthropic keys, PEM private keys, Google API keys). Unknown
formats are not covered. For higher-fidelity detection, Gitleaks delegation
already exists in the Rust engine, but it is **opt-in** behind the
`preferGitleaks` protocol option (`docs/engine.md` § "External tools"). There
is no CLI flag or MCP tool parameter that turns it on yet: installing
`gitleaks` on `PATH` alone does **not** make the engine delegate — the option
must also be set, which is only reachable today by driving the engine binary's
stdio protocol directly (or `runAudit` with `preferGitleaks: true`). Until
that surface lands, rely on the built-in offline rule set.

## Dashboard shows sample data

The banner in the top-right of the dashboard says which mode is active:
- **SAMPLE DATA** (gold): the API is not reachable; labeled sample
  data is shown. Start the API with `node packages/api/dist/bin.js`.
- **LIVE** (green): real scan data is being displayed.

## API refuses to start: "non-loopback host without a token"

Starting the API with a non-loopback `VEYLQORIX_API_HOST` (for example
`0.0.0.0`) but no `VEYLQORIX_API_TOKEN` fails with exit 1 — by design,
exposing a root-reading API without authentication is never a safe
default. Fix: set `VEYLQORIX_API_TOKEN` (protected mode: every `/api`
route except `GET /api/health` then requires the bearer token), or bind
to loopback only (`127.0.0.1`/`localhost`, the default) for local use.

## CLI `hooks install` says "not a Git repository"

Run the command from inside a Git work tree. The installer requires `.git/` to
be present; it will not create a repo for you.

## Honest limitations

For the "what can't Veylqorix do" questions — scanner unavailable / degraded
coverage, and the advisory-gate question — see [FAQ: Honest
limitations](faq.md#honest-limitations-read-this-first). The short version:

- **Scanner unavailable** is never green-washed. A skipped or errored scanner
  degrades coverage and makes the gate INCOMPLETE (exit 2), not PASS.
- **The gate is advisory until you enforce it.** The `veylqorix-gate` workflow
  only blocks a merge when the calling repo requires its status check via
  branch protection or a ruleset. Git hooks are a local convenience, not a
  boundary. See `docs/github-actions.md` for the enforcement steps.

## Filing a bug: what to attach

The bug-report template (`.github/ISSUE_TEMPLATE/bug_report.md`) collects
specific fields. Mirror it one-to-one so a reporter needs no further
guidance:

- **Surface** — which of: CLI (`veylqorix`), MCP server, API / dashboard,
  GitHub Actions gate, Git hooks, Rust engine, or Plugin SDK.
- **Exact command + exit code** — e.g. `node apps/cli/dist/index.js
  scan --root /path --json` exiting `2` (INCOMPLETE).
- **`--json` output** — the machine-readable audit result, with any
  credentials redacted (Veylqorix redacts in its own output, but pasted
  issue text does not).
- **Version / commit** — the CLI has no `--version` flag; use
  `git rev-parse --short HEAD` in a checkout, or the npm version for an
  installed binary.
- **Engine status** — whether the Rust engine binary was present
  (`VEYLQORIX_ENGINE` or `crates/target/{release,debug}`) and whether the
  secrets scanner carried the labeled degraded-compatibility note or a
  `SKIPPED`/`ERROR` engine result (see `docs/cli.md` § "Engine binary").
- **Policy file** — if a custom `--policy` was in play, attach it.

Scanner status notes (SKIPPED / ERROR) and the policy file are the two
fields that most often turn a "why did it fail" question into a
diagnosable one.
