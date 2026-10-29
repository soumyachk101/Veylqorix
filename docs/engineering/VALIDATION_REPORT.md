# Veylqorix — Validation Report

Release-validation scaffold, generated 2026-10-28 by the security sweep.
Section C (docs/diagram verification, D1–D5) was **executed 2026-10-29** in
the diagrams + security workstream and its results are filled in below —
those commands are read-only and were run in this checkout; D6–D7 (Cargo.lock
in-sync + gitignore-drift checks, 2026-10-29 re-sweep) were also executed
read-only and are recorded PASS. Sections A (Rust) and B (TS) are owned by the
parallel workstreams: every result there remains `PENDING - not yet executed`;
the lead or those agents run the commands and fill in the real result before
release. Section D (package inspection, P1–P4) and E (sign-off) also remain
PENDING. Nothing was pre-marked as passed on 2026-10-28; only the C-section
results below carry a real result, each with the evidence of the run. The
per-branch validation log from the earlier `feat/engineering-hardening` effort
was a session report; it no longer represents the current tree and has been
superseded by this scaffold.

Status values allowed when the lead fills in: `PASS`, `FAIL (evidence)`,
`SKIP (<reason>)`.

## A. Rust engine (`crates/`)

All commands target the workspace manifest at `crates/Cargo.toml` (there is no
`Cargo.toml` at the repo root), mirroring `.github/workflows/ci.yml`.

| # | Command | Result |
|---|---|---|
| R1 | `cargo fmt --manifest-path crates/Cargo.toml --all -- --check` | PENDING - not yet executed |
| R2 | `cargo clippy --manifest-path crates/Cargo.toml --workspace --all-targets --all-features -- -D warnings` | PENDING - not yet executed |
| R3 | `cargo test --manifest-path crates/Cargo.toml --workspace --all-features` | PENDING - not yet executed |
| R4 | `cargo build --manifest-path crates/Cargo.toml --workspace --release` (produces `crates/target/release/veylqorix-engine`; the TS engine-adapter tests spawn this binary, so R4 must pass before T4) | PENDING - not yet executed |
| R5 | `cargo audit --file crates/Cargo.lock` (optional; external tool — honest SKIP allowed when the tool is absent; last recorded result 0 vulns per `docs/engineering/SUPPLY_CHAIN.md` §1.2, 2026-10-26) | PENDING - not yet executed |

Notes:
- R3 external-tool probes (gitleaks, cargo-audit) log a SKIP when the tool is
  absent — record that as `SKIP (<tool> unavailable)`, not a failure.
- `crates/Cargo.lock` must remain in sync (no dependency bumps pending on
  `main`).

## B. TypeScript / pnpm workspace

| # | Command | Result |
|---|---|---|
| T1 | `pnpm install --frozen-lockfile` (proves the lockfile matches every `package.json` and the `pnpm-workspace.yaml` `overrides`/`allowBuilds` resolve under pnpm 11.9.0) | PENDING - not yet executed |
| T2 | `pnpm build` (root script → `pnpm -r build`) | PENDING - not yet executed |
| T3 | `pnpm lint` (`eslint . --ext .ts --max-warnings 0`) | PENDING - not yet executed |
| T4 | `pnpm typecheck` (`tsc -p tsconfig.json --noEmit`) | PENDING - not yet executed |
| T5 | `pnpm test` (vitest: `tests/**`, `packages/*/src/**`, `apps/*/src/**` — engine-backed groups require R4's binary first; they self-skip with explicit labels when absent) | PENDING - not yet executed |
| T6 | `pnpm audit` (record the vuln count; `docs/engineering/SUPPLY_CHAIN.md` §1.1 documents the `postcss`/`sharp` overrides; both must still resolve to the patched versions `postcss@8.5.31` / `sharp@0.35.5` in the tree) | PENDING - not yet executed |
| T7 | `node -e "require('sharp')"` from `apps/web` (confirms the sharp native binary actually built under `allowBuilds: { sharp: true }`) | PENDING - not yet executed |

## C. Docs / diagram validation

| # | Command | Result |
|---|---|---|
| D1 | Verify every image/diagram referenced by `docs/` and `README.md` exists on disk: `grep -rEoh '\(Veylqorix_Diagrams/[A-Za-z0-9_./-]+\)' README.md docs -r \| sed 's/^(//;s/)$//' \| sort -u \| while read -r p; do [ -f "$p" ] \|\| echo "MISSING $p"; done` (the 2026-10-29 run must exclude this file's own command text: `grep -rl 'Veylqorix_Diagrams/\[' README.md docs` → only `docs/engineering/VALIDATION_REPORT.md` matched and was excluded). No output = pass | PASS (2026-10-29) — no MISSING lines; all referenced diagram files exist |
| D2 | Verify every cross-referenced `docs/engineering/*.md` link target exists: `for f in $(grep -rEoh 'docs/engineering/[A-Z_]+\.md' docs README.md CHANGELOG.md \| sort -u); do [ -f "$f" ] \|\| echo "MISSING $f"; done` | PASS (2026-10-29) — no MISSING lines |
| D3 | `Veylqorix_Diagrams/` inventory: the five architecture screenshots (`01_…05_`) plus `reference-screenshot-{1,2}.png` are tracked and their `README.md` legend matches the filenames | PASS (2026-10-29) — `git ls-files Veylqorix_Diagrams \| grep -c '\.png$'` → 7 (5 numbered + 2 reference); README legend lists exactly those files; PNGs re-exported 3× via `render-diagrams.mjs` (sharp 0.35.5, pnpm store) and `SHA256SUMS` regenerated + all 7 digests verify from inside the directory |
| D4 | Confirm no doc claims a version/state not true on `main`: `git tag -l` (expect `v0.1.0`, `v0.1.1`), `grep -n '"version"' packages/core/package.json apps/cli/package.json` (expect both at `0.1.1`) | PASS (2026-10-29) — tags `v0.1.0`, `v0.1.1`; both manifests `"version": "0.1.1"`; `CHANGELOG.md` references `0.1.1` (11 occurrences) |
| D5 | Launch-film assets under `video/`: source (compositions, assets, README) tracked; generated caches untracked-or-ignored (`.gitignore` now lists `video/**/.hyperframes/` and `video/**/*.mp4`) — verify with `git status --porcelain \| grep '^??'` for no new generated files | PASS (2026-10-29) — 0 untracked `hyperframes`/`.mp4` entries; `git check-ignore` confirms `.gitignore:19` covers `video/veylqorix-launch-film/.hyperframes`; `.media/` audio (intentional film source, 7 files) remains tracked as documented in `REPOSITORY_AUDIT.md` A8 |
| D6 | Verify `crates/Cargo.lock` is tracked and in sync with `crates/` dependency ranges: `git ls-files -- crates/Cargo.lock` (expect 1 path) and `git diff --exit-code -- crates/Cargo.lock` (expect clean, no pending bumps on `main`) | PASS (2026-10-29) — `crates/Cargo.lock` is tracked; no uncommitted diff against `main` (R5 / `cargo audit` still PENDING — this check is read-only and confirms the lockfile is present and unmodified; it does not re-run the audit) |
| D7 | Verify no generated/stray path drifts into git: `git status --porcelain \| grep '^??'` returns only intentionally-untracked items; `.gitignore` now lists `apps/web/tsconfig.tsbuildinfo` and the root `/SHA256SUMS` decoy; `git check-ignore -v apps/web/tsconfig.tsbuildinfo /SHA256SUMS` confirms both are ignored; `git ls-files \| grep -E '\.env$|/\.env\.|DS_Store'` returns no tracked env/OS files | PASS (2026-10-29) — `git status --porcelain \| grep '^??'` returned only `SHA256SUMS` (the root decoy) before the `.gitignore` fix; after the fix `git check-ignore -v /SHA256SUMS` → ignored (`.gitignore` root line). No tracked `.env*` (real), `node_modules/`, or `.DS_Store` files. `apps/web/tsconfig.tsbuildinfo` is covered by both the explicit entry and `*.tsbuildinfo`. |

## D. Package inspection (npm publication)

| # | Command | Result |
|---|---|---|
| P1 | `pnpm --filter @veylqorix/core pack --dry-run` and `pnpm --filter @veylqorix/cli pack --dry-run` — record the tarball file lists; expect **only** `dist/**` + `LICENSE` + `package.json` (no `src/`, `tsconfig.json`, lockfiles, `.env*`, fixtures, or test output) | PENDING - not yet executed |
| P2 | `pnpm --filter @veylqorix/cli pack --pack-destination /tmp/vqx-inspect && tar -xOf /tmp/vqx-inspect/veylqorix-cli-*.tgz package/package.json` — confirm the packed CLI manifest carries a **concrete** `@veylqorix/core` version, never the unresolvable `workspace:` protocol | PENDING - not yet executed |
| P3 | Inspect both packed `package.json`s: `"files": ["dist"]`, `"engines": { "node": ">=20.18" }`, `publishConfig` `{ "access": "public", "provenance": true }`, CLI `bin` → `dist/index.js` with shebang present in `dist/index.js` | PENDING - not yet executed |
| P4 | Clean-consumer smoke (registry-free variant, safe to run pre-publish): `cd /tmp && mkdir vqx-consumer && cd vqx-consumer && npm init -y && npm install <core-tgz> <cli-tgz> && ./node_modules/.bin/veylqorix --help` (expect usage text, exit 0) — per the procedure in the former §6 of this file's predecessor, now in `docs/engineering/NPM_PUBLICATION_REPORT.md` | PENDING - not yet executed |
| P5 | Post-publish-only (after the CLI trusted-publisher step in `RELEASE_READINESS.md` §C): `npm view @veylqorix/cli@0.1.1 dist.integrity` + provenance attestation visible on both npm package pages. **Core half verified** — `@veylqorix/core@0.1.1` is on the registry with a signed provenance attestation (run `40558927305`); the CLI half is what P5 still covers after the C1/C4 owner actions | PENDING - not yet executed |

## E. Sign-off

| Item | Result |
|---|---|
| All of A+B+D1–D4, P1–P4 executed and PASS (or honestly labeled SKIP) | PENDING - not yet executed |
| `release.yml` `test` job (committed at `6480b4a`) green on a tag push | PENDING - not yet executed |
| Maintainer trusted-publisher step complete (see `RELEASE_READINESS.md` §C) | PENDING - not yet executed |
