# Veylqorix CLI

The `veylqorix` binary (`@veylqorix/cli`) runs security audits and quality
gates from the terminal or CI. It is a thin adapter over the core engine:
every result comes from a real scanner run, and a scanner that cannot run is
reported as SKIPPED or ERROR, never as a clean pass.

## Install

Requires Node.js ≥ 20.18.

**Primary install path: the npm registry.** `@veylqorix/core@0.1.1` and
`@veylqorix/cli@0.1.1` are both published to the npm registry (each with a
provenance attestation). The registry also holds a staged `0.0.0-stage`
placeholder for the CLI (staged via `npm stage publish`; its approval is a
2FA-protected owner step and is optional — the `0.1.1` release does not
depend on it).

```
npm install -g @veylqorix/cli@0.1.1   # then: veylqorix --help
```

**Monorepo build (alternative).** Build and run the CLI from source:

```
git clone https://github.com/soumyachk101/Veylqorix
cd Veylqorix
pnpm install
pnpm build
node apps/cli/dist/index.js --help      # or link it: pnpm link
```

**From the npm registry.** `@veylqorix/cli@0.1.1` is published (provenance
attested); the install commands below are usable as written. The registry
also still carries the `0.0.0-stage` placeholder (staged via
`npm stage publish`; its approval is a 2FA-protected owner action and is
optional; see `docs/engineering/RELEASE_READINESS.md`). `@veylqorix/core@0.1.1`
is published (with a provenance attestation).

```
npm install -g @veylqorix/cli   # then: veylqorix --help
```

**No global install?** Run the package locally instead:

```
npm install @veylqorix/cli
npx veylqorix scan
```

**Version discovery.** The CLI has no `--version` flag. The version is in
the package manifest (`apps/cli/package.json` → `version`); in a monorepo
checkout it is the checkout's commit (`git rev-parse --short HEAD`).

## Upgrade

```
npm update -g @veylqorix/cli   # or pin: npm install -g @veylqorix/cli@<version>
```

Check the installed version's behavior with `veylqorix --help` — the usage
block lists the exit-code contract the tool guarantees.

## Engine binary (prerequisite for authoritative results)

Veylqorix's secret scanner and gate are authoritative when the native Rust
engine binary (`veylqorix-engine`) is available; otherwise the CLI degrades
to the byte-compatible TypeScript fallback and **labels the run** (see
below). The binary is **not** bundled in the npm package and is **not**
downloaded automatically. How it is located at runtime, in order:

1. **`VEYLQORIX_ENGINE`** — an environment variable pointing at the binary
   (highest priority; checked fresh on every run). Set it to wherever you
   installed the engine, for example:
   ```
   # built from source:
   cargo build --release --manifest-path crates/Cargo.toml -p veylqorix-engine
   export VEYLQORIX_ENGINE="$PWD/crates/target/release/veylqorix-engine"
   # or, once a platform binary is installed somewhere on your system:
   export VEYLQORIX_ENGINE="$(command -v veylqorix-engine)"
   ```
2. **Developer checkouts only:** the resolver walks upward from the working
   directory (and from the installed package location) looking for
   `crates/Cargo.toml` and then `crates/target/{release,debug}/veylqorix-engine`.
   This is how monorepo development finds a locally built engine — and it is
   why a clean npm consumer never silently picks up a binary they don't have.

**When the engine is absent, the run is labeled — not silently passed.**
The secrets scanner note becomes
`Rust engine unavailable: TypeScript policy engine evaluated the gate
(degraded compatibility mode)`; it appears in the JSON, Markdown, and SARIF
report surfaces. The label is a scanner note, not a completeness gap: a
clean repo with the engine deliberately unavailable still exits `0` (PASS
with FULL coverage) — `tests/engine-adapter.test.ts` asserts exactly that.
Exit `2` (INCOMPLETE) happens only when a mandatory scanner separately
could not run (e.g. `--offline` skips the dependencies scanner, or a tool
is missing). Details: `docs/engine.md` and
`docs/engineering/RELEASE_READINESS.md`.

## Cross-platform notes

- **OS:** the CLI itself is plain Node.js (the package manifest declares
  `engines.node >= 20.18`; the monorepo toolchain needs Node 22.13+ for
  pnpm 11.9.0) and runs on any platform Node supports (Linux, macOS,
  Windows). The authoritative engine is a native binary built per OS/CPU
  architecture — there is no download or install mechanism in the package,
  so on a platform you haven't built it for, you run in the labeled
  degraded compatibility mode described above.
- **External scanners:** `npm audit` (Node projects), `pip-audit` (Python),
  and optionally `gitleaks` and `cargo audit` are invoked when available and
  online; each is reported SKIPPED (with a note) when absent or when
  `--offline` is set. A missing external tool reduces coverage, it does not
  fail the install.
- **Git hooks** (`hooks install`) write shell scripts (`#!/bin/sh`); they
  assume `node` on `PATH`. POSIX (macOS/Linux) is the supported environment
  for hooks; Windows uses Git-Bash.

## Build / run (monorepo)

```
pnpm install
pnpm build
node apps/cli/dist/index.js --help      # or: veylqorix --help once linked
```

## Commands

```
veylqorix scan [root]                  full audit + quality gate (default)
veylqorix check [root]                 quality checks only (type, lint, tests);
                                        no scanners run — the gate is INCOMPLETE
                                        (exit 2), secrets unverified; use
                                        `veylqorix scan` for secret coverage
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
| `--json` | scan/check/report | Machine-readable JSON on stdout. |
| `--format markdown\|json\|sarif` | scan/check/report | Force a report format on stdout (default: summary, `report` is Markdown). |
| `--report-out FILE` | scan/check/report | Write the Markdown report to a file. |
| `--sarif-out FILE` | scan/check/report | Write a SARIF 2.1.0 report to a file. |
| `--offline` | scan/check | Skip network-dependent scanners (no advisory DB pull); reported SKIPPED. |
| `--no-tests` | scan/check | Skip test/build quality checks (faster). |
| `--scanners a,b` | scan | Run only the listed scanners. |
| `--block-on a,b` | scan | Severities that block the gate (e.g. `HIGH,CRITICAL`). |
| `--policy FILE` | scan/check/report | Load a custom policy JSON file (overrides discovered defaults). |
| `--pre-push` | hooks | Also install a `pre-push` hook alongside `pre-commit`. |
| `--force` | hooks | Overwrite an existing non-Veylqorix hook (it is backed up first). |
| `-y` / `--yes` | hooks | Actually write hooks. Without it, `hooks install` is a dry run that only prints the scripts. |
| `-h` / `--help` | all | Print usage. |

## Exit codes

The scan/check/report commands exit with the gate's decision; the other codes
are out-of-band. This is what CI should branch on.

| Code | Meaning | Example |
|------|---------|---------|
| `0` | PASS — gate passed, no blocking findings. | `veylqorix scan . --no-tests` on a clean tree. |
| `1` | FAIL — blocking findings present. | A CRITICAL dependency advisory the policy blocks on. |
| `2` | INCOMPLETE — coverage degraded (a mandatory scanner errored or was skipped, a required check failed to run, or a scanner result is missing that the gate needs). **Never** treated as green. A missing Rust engine binary alone does *not* cause exit `2` — it produces the labeled degraded run, which still exits `0` when nothing else is incomplete. | `--offline` skips `npm audit`; `pip-audit` missing. |
| `64` | Usage error — bad flag, invalid policy file, or hook error. | `veylqorix scan --format xml` (unknown format value); `config validate` on a malformed policy. |
| `65` | Bad root / missing policy file / nothing staged. | `veylqorix scan /nonexistent`; `config validate missing.json`; `scan --staged` with no staged changes. |
| `70` | Unexpected error. | Anything thrown outside the known paths. |

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

# Point at a Rust engine you built (authoritative results)
VEYLQORIX_ENGINE=~/veylqorix-engine/target/release/veylqorix-engine \
  node apps/cli/dist/index.js scan --root .
```

## Git hooks

Hooks are a **local convenience, not a security boundary** — a determined
actor can bypass them (`git commit --no-verify`, or `VEYLQORIX_OVERRIDE=1`).
The authoritative enforcement point is the GitHub Actions gate plus branch
protection (see `docs/github-actions.md`).

```
node apps/cli/dist/index.js hooks install          # dry run: prints the scripts, writes nothing
node apps/cli/dist/index.js hooks install --yes    # writes .git/hooks/pre-commit
node apps/cli/dist/index.js hooks install --yes --pre-push
node apps/cli/dist/index.js hooks uninstall        # remove Veylqorix hooks
```

The installer:

- never touches `git config`;
- backs up any non-Veylqorix hook before replacing it;
- writes a marker so it can recognize and manage its own hooks;
- supports an emergency local override via `VEYLQORIX_OVERRIDE=1`.

`hooks uninstall` removes only Veylqorix-installed hooks (hooks carrying the
installer's marker); non-Veylqorix hooks are left untouched and reported as
skipped. Worktree and submodule `.git` layouts are not supported by the
installer — run it from the main work tree.

Run `hooks install` from inside a Git work tree; it requires `.git/` and will
not create a repository for you.

## Troubleshooting

| Symptom | What it means / what to do |
|---------|---------------------------|
| A `Rust engine unavailable … (degraded compatibility mode)` note on the secrets scanner | The engine binary is not resolvable; the run was labeled, not failed. Set `VEYLQORIX_ENGINE` (see *Engine binary* above) for authoritative results, or accept the labeled degraded run. A clean tree with the engine absent still exits `0`; exit `2` appears only if a mandatory scanner also could not run. |
| Exit `2` with a scanner `SKIPPED: … offline …` note | `--offline` (or no network) skips `npm audit`/`pip-audit`. Run online for full advisory coverage; `--no-tests` is fine but still degrades test coverage. |
| Exit `64` "Unknown option" / "Policy file … is invalid" | Typo in a flag or flag value, or the policy JSON failed validation. Fix the input; see the emitted issues for the exact fields. |
| Exit `65` "Root directory does not exist" | The root path (positional or `--root`) doesn't exist — check that you're in the repo or pass an absolute path. |
| Exit `65` "No staged files found" with `--staged` | `git add` something first; `--staged` only makes sense inside a Git repo with staged changes. |
| `veylqorix` not found after `npm install -g` | The global `node_modules/.bin` dir isn't on `PATH`, or you installed under a different Node via nvm/fnm. `npm config get prefix` tells you where to look. |
| Hooks did nothing / dry-run keeps printing | `hooks install` is a dry run unless you pass `--yes` (or `-y`). Re-run with `--yes` inside the repo. |
| `VEYLQORIX_ENGINE` set but the run still says engine unavailable | The path doesn't point at an existing file. `stat "$VEYLQORIX_ENGINE"` — it must be the binary itself, not a directory or a stale build. |

## See also

- `docs/engine.md` — Rust engine protocol, binary resolution, compatibility mode.
- `docs/engineering/RELEASE_READINESS.md` — packaging status, publication steps,
  clean-consumer validation.
- `docs/github-actions.md` — the CI gate and branch-protection boundary.
