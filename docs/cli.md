# Veylqorix CLI

The `veylqorix` binary (`@veylqorix/cli`, `apps/cli`) runs security audits and
quality gates from the terminal or CI. It is a thin adapter over the core
engine: every result comes from a real scanner run, and a scanner that cannot
run is reported as SKIPPED or ERROR, never as a clean pass.

## Build / run

```
pnpm install
pnpm build
node apps/cli/dist/index.js --help      # or: veylqorix --help once linked
```

## Commands

```
veylqorix scan [root]                  full audit + quality gate (default)
veylqorix check [root]                 quality checks only (type, lint, tests)
veylqorix report [root]                human-readable Markdown report
veylqorix config validate FILE         validate a policy JSON file
veylqorix hooks install|uninstall      safe Git hook installer (dry-run by default)
```

Legacy aliases still work: `audit`, `deps`, `secrets`, and `gate` map to
`scan`; `checks` maps to `check`.

## Options

| Option | Applies to | Effect |
|--------|-----------|--------|
| `--root PATH` | scan/check/report | Repository root to audit (also the positional argument). |
| `--staged` | scan | Scope the secret scan to Git-staged files (used by the pre-commit hook). |
| `--json` | scan/report | Machine-readable JSON on stdout. |
| `--format markdown\|json\|sarif` | report | Human-readable or machine-readable report. |
| `--report-out FILE` | scan/report | Write the Markdown report to a file. |
| `--sarif-out FILE` | scan | Write a SARIF 2.1.0 report to a file. |
| `--offline` | scan/check | Skip network-dependent scanners (no advisory DB pull). |
| `--no-tests` | scan/check | Skip test/build quality checks (faster). |
| `--scanners a,b` | scan | Restrict which scanners run. |
| `--block-on a,b` | scan | Severities that block the gate (e.g. `HIGH,CRITICAL`). |
| `--policy FILE` | scan/check/report | Load a custom policy JSON file. |
| `--pre-push` | hooks | Also install a `pre-push` hook alongside `pre-commit`. |
| `--force` | hooks | Overwrite an existing non-Veylqorix hook (it is backed up first). |
| `-y` / `--yes` | hooks | Actually write hooks. Without it, `hooks install` is a dry run that only prints the scripts. |
| `-h` / `--help` | all | Print usage. |

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | PASS — gate passed, no blocking findings. |
| `1` | FAIL — blocking findings present. |
| `2` | INCOMPLETE — coverage degraded (a scanner errored or a mandatory check was skipped). **Never** treated as green. |
| `64` | Usage error (bad flags, invalid policy, hook error). |
| `65` | Bad root / missing policy file. |
| `70` | Unexpected error. |

The 0/1/2 semantics drive the GitHub Actions gate: INCOMPLETE exits `2`
on purpose so an incomplete scan is never mistaken for a clean pass.

## Examples

```
# Full audit of the current directory, JSON on stdout
node apps/cli/dist/index.js scan --root . --json

# Dependency + secret scan only, SARIF for code scanning, skip tests
node apps/cli/dist/index.js scan --root . --no-tests \
  --scanners dependencies,secrets --sarif-out veylqorix.sarif

# Markdown report to a file
node apps/cli/dist/index.js report --root . --report-out report.md

# Validate a policy file before relying on it
node apps/cli/dist/index.js config validate veylqorix-policy.json
```

## Git hooks

Hooks are a **local convenience, not a security boundary** — a determined
actor can bypass them (`git commit --no-verify`, or `VEYLQORIX_OVERRIDE=1`).
The authoritative enforcement point is the GitHub Actions gate plus branch
protection (see `docs/github-actions.md`).

```
node apps/cli/dist/index.js hooks install --help   # dry run: prints the scripts
node apps/cli/dist/index.js hooks install          # dry run (default, nothing written)
node apps/cli/dist/index.js hooks install --yes    # writes .git/hooks/pre-commit
node apps/cli/dist/index.js hooks install --yes --pre-push
node apps/cli/dist/index.js hooks uninstall        # remove Veylqorix hooks
```

The installer:

- never touches `git config`;
- backs up any non-Veylqorix hook before replacing it;
- writes a marker so it can recognize and manage its own hooks;
- supports an emergency local override via `VEYLQORIX_OVERRIDE=1`.

Run `hooks install` from inside a Git work tree; it requires `.git/` and will
not create a repository for you.
