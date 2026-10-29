# Veylqorix — Validation Report

Release-validation scaffold, generated 2026-10-28 by the security sweep.
Section C (docs/diagram verification, D1–D5) was **executed 2026-10-29** in
the diagrams + security workstream and its results are filled in below —
those commands are read-only and were run in this checkout; D6–D7 (Cargo.lock
in-sync + gitignore-drift checks, 2026-10-29 re-sweep) were also executed
read-only and are recorded PASS. Sections A (Rust), B (TS), and D
(package inspection, P1–P4) were **executed 2026-10-29 in this checkout**
and carry real results with evidence of each run. Section E (sign-off) is
updated accordingly: everything runnable locally is now executed and PASS
(or honestly labeled); the npm-side post-publish step (P5) is complete, and
the tag-push `test` job was observed in release run `40932201210`. The only
item not executed is the optional, 2FA-gated approve/reject of the staged
`0.0.0-stage` bootstrap placeholders — it has no effect on the `0.1.1`
release.
The per-branch validation log from the earlier `feat/engineering-hardening`
effort was a session report; it no longer represents the current tree and
has been superseded by this scaffold.

Status values allowed when the lead fills in: `PASS`, `FAIL (evidence)`,
`SKIP (<reason>)`.

## A. Rust engine (`crates/`)

All commands target the workspace manifest at `crates/Cargo.toml` (there is no
`Cargo.toml` at the repo root), mirroring `.github/workflows/ci.yml`.

| # | Command | Result |
|---|---|---|
| R1 | `cargo fmt --manifest-path crates/Cargo.toml --all -- --check` | PASS (2026-10-29) — exit 0, no diff reported |
| R2 | `cargo clippy --manifest-path crates/Cargo.toml --workspace --all-targets --all-features -- -D warnings` | PASS (2026-10-29) — `Finished dev profile` with no warning emitted; `-D warnings` clean |
| R3 | `cargo test --manifest-path crates/Cargo.toml --workspace --all-features` | PASS (2026-10-29) — 0 failed, 0 ignored across 7 test binaries: lib 41, external-tools 3, gate-differential 10, golden 3, parity-fixtures 5, protocol-e2e 8, secret-parity 5 (75 tests total) |
| R4 | `cargo build --manifest-path crates/Cargo.toml --workspace --release` (produces `crates/target/release/veylqorix-engine`; the TS engine-adapter tests spawn this binary, so R4 must pass before T4) | PASS (2026-10-29) — `Finished release profile in 7.32s`; binary written to `crates/target/release/veylqorix-engine` (2,798,352 bytes) |
| R5 | `cargo audit --file crates/Cargo.lock` (optional; external tool — honest SKIP allowed when the tool is absent; last recorded result 0 vulns per `docs/engineering/SUPPLY_CHAIN.md` §1.2, 2026-10-26) | PASS (2026-10-29) — cargo-audit 0.22.2 present; scanned 37 crate dependencies against 1386 advisories, exit 0, **0 vulnerabilities** |

Notes:
- R3 external-tool probes (gitleaks, cargo-audit) log a SKIP when the tool is
  absent — record that as `SKIP (<tool> unavailable)`, not a failure. On this
  run both tools were installed (`cargo-audit` 0.22.2, `gitleaks` at
  `/opt/homebrew/bin/gitleaks`), so the external-tools probe ran for real
  rather than skipping.
- `crates/Cargo.lock` must remain in sync (no dependency bumps pending on
  `main`) — confirmed by D6.
- No warning was suppressed and no test was weakened or skipped to reach these
  results; every command above ran with its documented flags as-is.

## B. TypeScript / pnpm workspace

| # | Command | Result |
|---|---|---|
| T1 | `pnpm install --frozen-lockfile` (proves the lockfile matches every `package.json` and the `pnpm-workspace.yaml` `overrides`/`allowBuilds` resolve under pnpm 11.9.0) | PASS (2026-10-29) — pnpm 11.9.0, "Scope: all 8 workspace projects", "Already up to date", exit 0; no lockfile mutation |
| T2 | `pnpm build` (root script → `pnpm -r build`) | PASS (2026-10-29) — all workspace packages built (core, api, cli, mcp-server, plugin, skills) plus `apps/web` (`next build` → 4 routes prerendered, 103 kB shared First Load JS), exit 0 |
| T3 | `pnpm lint` (`eslint . --ext .ts --max-warnings 0`) | PASS (2026-10-29) — exit 0, zero errors and zero warnings (`--max-warnings 0`) |
| T4 | `pnpm typecheck` (`tsc -p tsconfig.json --noEmit`) | PASS (2026-10-29) — exit 0, no diagnostics |
| T5 | `pnpm test` (vitest: `tests/**`, `packages/*/src/**`, `apps/*/src/**` — engine-backed groups require R4's binary first; they self-skip with explicit labels when absent) | PASS (2026-10-29) — **18 test files, 308 tests, 0 failed**, duration 1.78 s. The Rust-engine-backed group ran for real against the R4 binary (e.g. `ping reports protocol version 1 and a string engine version`, `classifies an engine exit-64 as a protocol error carrying the exit code`) — no engine-backed group self-skipped, because R4 ran first |
| T6 | `pnpm audit` (record the vuln count; `docs/engineering/SUPPLY_CHAIN.md` §1.1 documents the `postcss`/`sharp` overrides; both must still resolve to the patched versions `postcss@8.5.31` / `sharp@0.35.5` in the tree) | PASS (2026-10-29) — "No known vulnerabilities found", exit 0, **0 vulns** (the 8 vulns the overrides closed stay closed). Override resolution confirmed with `pnpm why`: `postcss@8.5.31` (1 version) and `sharp@0.35.5` (1 version) are the only versions in the tree |
| T7 | `node -e "require('sharp')"` from `apps/web` (confirms the sharp native binary actually built under `allowBuilds: { sharp: true }`) | PASS (2026-10-29) — with a caveat on where it resolves: `apps/web/node_modules` holds no direct `sharp` entry, because `sharp` is an **optional dependency of `next@15.5.28`**, not a direct `apps/web` dependency. The native binary loads and reports its bundled libvips: `require('sharp')` from the Next package directory returned `sharp native OK "8.18.7"`, and the platform package `@img/sharp-darwin-arm64@0.35.5` + `@img/sharp-libvips-darwin-arm64@1.3.4` are present in the store. A bare `require('sharp')` from `apps/web` itself fails with `MODULE_NOT_FOUND` — that is correct dependency placement, not a broken native build |

Note on T7: the documented command assumes `sharp` is a direct `apps/web`
dependency. It is not — it is pulled in optionally by Next. The intent of the
check (the native binary actually built under `allowBuilds: { sharp: true }`)
is verified above by loading it from the Next package directory and reading
the resolved libvips version. No dependency was added to make the literal
command work, because that would change the dependency graph for no reason.

## C. Docs / diagram validation

| # | Command | Result |
|---|---|---|
| D1 | Verify every image/diagram referenced by `docs/` and `README.md` exists on disk: `grep -rEoh '\(Veylqorix_Diagrams/[A-Za-z0-9_./-]+\)' README.md docs -r \| sed 's/^(//;s/)$//' \| sort -u \| while read -r p; do [ -f "$p" ] \|\| echo "MISSING $p"; done` (the 2026-10-29 run must exclude this file's own command text: `grep -rl 'Veylqorix_Diagrams/\[' README.md docs` → only `docs/engineering/VALIDATION_REPORT.md` matched and was excluded). No output = pass | PASS (2026-10-29) — no MISSING lines; all referenced diagram files exist |
| D2 | Verify every cross-referenced `docs/engineering/*.md` link target exists: `for f in $(grep -rEoh 'docs/engineering/[A-Z_]+\.md' docs README.md CHANGELOG.md \| sort -u); do [ -f "$f" ] \|\| echo "MISSING $f"; done` | PASS (2026-10-29) — no MISSING lines |
| D3 | `Veylqorix_Diagrams/` inventory: the five architecture screenshots (`01_…05_`) plus `reference-screenshot-{1,2}.png` are tracked and their `README.md` legend matches the filenames | PASS (2026-10-29, re-verified) — `git ls-files Veylqorix_Diagrams` → exactly 7 PNGs (5 numbered + 2 reference) plus `README.md`; no SVG, no Mermaid, no generator script in the tree. The README legend lists exactly those files and states the PNG-only constraint as permanent. `Veylqorix_Diagrams/SHA256SUMS` was **restored** as the integrity manifest for the 7 PNGs (it had been deleted in `0dd7cf3`): `shasum -a 256 -c SHA256SUMS` run from inside the directory reports **OK for all 7**. No PNG byte was modified |
| D4 | Confirm no doc claims a version/state not true on `main`: `git tag -l` (expect `v0.1.0`, `v0.1.1`), `grep -n '"version"' packages/core/package.json apps/cli/package.json` (expect both at `0.1.1`) | PASS (2026-10-29) — tags `v0.1.0`, `v0.1.1`; both manifests `"version": "0.1.1"`; `CHANGELOG.md` references `0.1.1` (11 occurrences) |
| D5 | Launch-film assets under `video/`: source (compositions, assets, README) tracked; generated caches untracked-or-ignored (`.gitignore` now lists `video/**/.hyperframes/` and `video/**/*.mp4`) — verify with `git status --porcelain \| grep '^??'` for no new generated files | PASS (2026-10-29, re-verified) — **corrected scope**: `git ls-files video` returns **0 files** — the entire `video/` tree (film source, assets, audio, and the former HyperFrames generated cache alike) is now untracked and gitignored. The earlier claim that the film's source and `.media/` audio "remain tracked" is no longer true and has been corrected in `REPOSITORY_AUDIT.md` A3. `git status --porcelain \| grep '^??'` shows 0 untracked `hyperframes`/`.mp4` entries; the whole tree is covered by the `video/` rule |
| D6 | Verify `crates/Cargo.lock` is tracked and in sync with `crates/` dependency ranges: `git ls-files -- crates/Cargo.lock` (expect 1 path) and `git diff --exit-code -- crates/Cargo.lock` (expect clean, no pending bumps on `main`) | PASS (2026-10-29) — `crates/Cargo.lock` is tracked and unmodified against `main` (no pending dependency bumps). R5 (`cargo audit`) has since been executed separately: 0 vulnerabilities |
| D7 | Verify no generated/stray path drifts into git: `git status --porcelain \| grep '^??'` returns only intentionally-untracked items; `.gitignore` now lists `apps/web/tsconfig.tsbuildinfo` and the root `/SHA256SUMS` decoy; `git check-ignore -v apps/web/tsconfig.tsbuildinfo /SHA256SUMS` confirms both are ignored; `git ls-files \| grep -E '\.env$|/\.env\.|DS_Store'` returns no tracked env/OS files | PASS (2026-10-29, re-verified) — `git ls-files \| grep -E '\.env$\|/\.env\.\|DS_Store'` returns **nothing**: no tracked `.env`, `.env.*`, or `.DS_Store` file. `git check-ignore -v` confirms `apps/web/.env.local` and `apps/web/tsconfig.tsbuildinfo` are both ignored. The root `/SHA256SUMS` decoy **no longer exists on disk** (it was gitignored and has since been removed); its `.gitignore` entry is retained defensively. `git status --porcelain` shows only the intended working-tree edits and the new `Veylqorix_Diagrams/SHA256SUMS` |

## D. Package inspection (npm publication)

| # | Command | Result |
|---|---|---|
| P1 | `pnpm --filter @veylqorix/core pack --dry-run` and `pnpm --filter @veylqorix/cli pack --dry-run` — record the tarball file lists; expect **only** `dist/**` + `LICENSE` + `package.json` (no `src/`, `tsconfig.json`, lockfiles, `.env*`, fixtures, or test output) | PASS (2026-10-29) — filtering the dry-run listing down to non-`dist/` entries yields **only** `package.json` and `LICENSE` for both packages. Core tarball: 86 entries, all under `package/dist/**` plus `package/package.json` + `package/LICENSE`. CLI tarball: 10 entries — `package/dist/{index,cli-args}.{js,d.ts,js.map,d.ts.map}`, `package/package.json`, `package/LICENSE`. No `src/`, no `tsconfig.json`, no lockfile, no `.env*`, no fixtures, no test output |
| P2 | `pnpm --filter @veylqorix/cli pack --pack-destination /tmp/vqx-inspect && tar -xOf /tmp/vqx-inspect/veylqorix-cli-*.tgz package/package.json` — confirm the packed CLI manifest carries a **concrete** `@veylqorix/core` version, never the unresolvable `workspace:` protocol | PASS (2026-10-29) — the packed CLI manifest carries `"dependencies": { "@veylqorix/core": "0.1.1" }`. The `workspace:*` protocol is rewritten to the concrete version; no `workspace:` spec survives in the tarball |
| P3 | Inspect both packed `package.json`s: `"files": ["dist"]`, `"engines": { "node": ">=20.18" }`, `publishConfig` `{ "access": "public", "provenance": true }`, CLI `bin` → `dist/index.js` with shebang present in `dist/index.js` | PASS (2026-10-29) — core: `files: ["dist","LICENSE"]`, `engines.node ">=20.18"`, `publishConfig {access: public, provenance: true}`, `license "MIT"`, `main dist/index.js`, `types dist/index.d.ts`, and an `exports` map with `.`, `./scanners/*`, `./gate`, `./report`, `./engine`. CLI: same `files`/`engines`/`publishConfig`/`license`, `main dist/index.js`, `bin.veylqorix → dist/index.js`. `tar -xOf .../package/dist/index.js | head -2` → `#!/usr/bin/env node` (shebang present) |
| P4 | Clean-consumer smoke (registry-free variant, safe to run pre-publish): `cd /tmp && mkdir vqx-consumer && cd vqx-consumer && npm init -y && npm install <core-tgz> <cli-tgz> && ./node_modules/.bin/veylqorix --help` (expect usage text, exit 0) — per the procedure in the former §6 of this file's predecessor, now in `docs/engineering/NPM_PUBLICATION_REPORT.md` | PASS (2026-10-29) — clean dir `/tmp/vqx-consumer`, `npm init -y`, `npm install` of both freshly packed tarballs → "added 2 packages, and audited 3 packages", "found 0 vulnerabilities". `node_modules/.bin/veylqorix` → symlink to `../@veylqorix/cli/dist/index.js`. `./node_modules/.bin/veylqorix --help` printed the full usage block (commands, options, exit-code contract `0=PASS 1=FAIL 2=INCOMPLETE 64=usage 65=bad root 70=error`) and exited **0**. Additionally, the core `exports` map resolves from the installed package: `@veylqorix/core` (59 root exports), `@veylqorix/core/report`, `@veylqorix/core/gate`, and `@veylqorix/core/engine` all imported successfully |
| P5 | Post-publish-only (after the CLI trusted-publisher step in `RELEASE_READINESS.md` §C): `npm view @veylqorix/cli@0.1.1 dist.integrity` + provenance attestation visible on both npm package pages. **Core half verified** — `@veylqorix/core@0.1.1` is on the registry with a signed provenance attestation (run `40558927305`); the CLI half was completed once the owner created the CLI trusted-publisher record and the release was re-triggered (run `40932201210`) | **Both halves verified** (2026-10-29, read-only registry probe + release run): core `@veylqorix/core` lists `0.0.0-stage` and `0.1.1`; the `0.1.1` publish carried a signed provenance attestation (run `40558927305`). **CLI half PASS** — `@veylqorix/cli@0.1.1` confirmed on the registry (the versions list now includes `0.1.1`; dependency `@veylqorix/core@0.1.1`; `dist.integrity` present), published via release run `40932201210` with `--provenance`; clean registry install + `veylqorix --help` exit 0 |

## E. Sign-off

| Item | Result |
|---|---|
| All of A+B+D1–D4, P1–P5 executed and PASS (or honestly labeled SKIP) | PASS (2026-10-29) — R1–R5, T1–T7, D1–D7, and P1–P5 all executed and all PASS. P5 complete: core and CLI halves both verified on the registry (stated above) |
| `release.yml` `test` job (committed at `6480b4a`) green on a tag push | PASS (2026-10-29) — observed in release run `40932201210`: the tag push succeeded and the `test` job (full CI loop) was green |
| Maintainer trusted-publisher step complete (see `RELEASE_READINESS.md` §C) | PASS (2026-10-29) — completed: the owner created the CLI trusted-publisher record (web UI, 2FA session, direct `npm publish` allowed, environment unset), and the record was validated by the successful publish in release run `40932201210` |
