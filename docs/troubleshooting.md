# Troubleshooting

## The gate reports INCOMPLETE (exit 2) instead of PASS

INCOMPLETE means coverage was degraded: a scanner errored, a mandatory check was
skipped, or a scanner could not run. This is by design — Veylqorix refuses to
treat an incomplete scan as clean.

Common causes:
- `--offline` was passed, so `npm audit` / `pip-audit` were skipped.
- `pip-audit` binary is not installed.
- The project has no lockfile and `npm audit` failed with code 2.

Fix: ensure the required scanner can run (install the binary, allow network
access, or add a lockfile), then re-run without `--offline`.

## No dependency findings even though a CVE is published

- Offline mode: advisory DB not reached. Remove `--offline`.
- The advisory may be in a transitive dependency not covered by `npm
  audit --package-lock-only`. Run a full `npm install` first, then scan.
- The CVE may be newer than the last advisory-DB pull.

## Secret not detected

The built-in rule set covers common formats (AWS keys, GitHub tokens, Slack
tokens, OpenAI/Anthropic keys, PEM private keys, Google API keys). Unknown
formats are not covered. For higher-fidelity detection, install Gitleaks and
point Veylqorix's scanners registry at it (future adapter).

## Dashboard shows demo data

The banner in the top-right of the dashboard says which mode is active:
- **DEMO MODE** (amber): the API is not reachable. Start it with
  `node packages/api/dist/bin.js`.
- **LIVE** (green): real scan data is being displayed.

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
