# Veylqorix — Release Readiness Checklist

Release-readiness checklist for publishing `@veylqorix/cli` +
`@veylqorix/core` `0.1.1` to npm. Regenerated 2026-10-28 by the security sweep
from the session narrative that preceded it; the detailed evidence lives in
`docs/engineering/NPM_PUBLICATION_REPORT.md` and
`docs/engineering/NPM_TRUSTED_PUBLISHING_SETUP.md`.

Three buckets: **verified** (done, evidence on record), **blocked**
(open workstream items), and **required maintainer actions** (npm-side, owner
only).

## A. Verified items

- [x] **Packaging correctness** — `@veylqorix/cli` / `@veylqorix/core` at
  `0.1.1` (MIT, `"type": "module"`, `files: ["dist"]`,
  `engines: node >=20.18`, `publishConfig {access: public, provenance: true}`,
  CLI `bin` → `dist/index.js` with shebang). `pnpm pack --dry-run` records
  both tarballs shipping **only** `dist/**` + `LICENSE` + `package.json`
  (no `src/`, `tsconfig`, lockfiles, `.env*`, or fixtures). Evidence:
  `NPM_PUBLICATION_REPORT.md` §1–2 (2026-10-27).
- [x] **`workspace:*` rewrite strategy** — `pnpm pack` rewrites the CLI's
  `workspace:*` dependency to the concrete version; `release.yml` publishes
  core first and polls `npm view` until the core version is registry-visible
  before publishing the CLI (eventual-consistency guard). Evidence:
  `release.yml` `publish` job; `NPM_PUBLICATION_REPORT.md` §100.
- [x] **Engine honesty** — `resolveEngineBinary` (env → PATH-free upward walk
  → install-location walk, bounded 12 hops) makes **no** developer-local
  assumption and ships **no** binary; a degraded TS-compat run appends the
  labeled note `Rust engine unavailable: TypeScript policy engine evaluated
  the gate (degraded compatibility mode)` to the secrets scanner result and
  the gate degrades to INCOMPLETE (exit 2), never a silent PASS. Evidence:
  `packages/core/src/engine/index.ts`, `packages/core/src/audit.ts`,
  `docs/engine.md`, `docs/cli.md`.
- [x] **Release workflow structure** — `release.yml` is tag-only
  (`on: push: tags: [v*]`), two jobs `pack` → `publish` with a
  tag/manifest-version guard (fail-loud on mismatch; npm versions are
  immutable once published), SHA-pinned Actions, `id-token: write` on
  `publish` only, no `NPM_TOKEN`/`npm login` anywhere. Evidence:
  `.github/workflows/release.yml:47-145`.
- [x] **CI gating of releases (new, in-worktree)** — `release.yml` now has a
  third `test` job mirroring `ci.yml` (install → build → Rust
  fmt/clippy/test/release-build → `pnpm test` → typecheck → lint) and
  `publish` needs `[pack, test]`, so a tag can no longer publish a commit
  whose validation failed. Evidence: `release.yml` `test` job (in-worktree,
  +2026-10-28 sweep).
- [x] **pnpm / Node consistency** — `packageManager: "pnpm@11.9.0"` at root,
  pnpm `11.9.0` in all three workflows, Node 24 in all three workflows
  (pnpm 11.9.0 uses `node:sqlite` → needs Node ≥ 22.13). Evidence:
  `package.json`, `.github/workflows/*.yml`; commit `624f678`.
- [x] **pnpm-workspace hardening** — `allowBuilds` real booleans
  (`esbuild: true`, `sharp: true`); `overrides: { postcss: 8.5.31, sharp:
  0.35.5 }` close all 8 `pnpm audit` vulns (3 moderate + 5 high, all
  transitive under `next@15.5.28`). Evidence: `pnpm-workspace.yaml`,
  `docs/engineering/SUPPLY_CHAIN.md` §1.1–1.2.
- [x] **`v0.1.0` release run** (`40500854557`) — `pack` passed, `publish`
  failed **before** `npm publish` was ever called (the `packaged-tarballs/`
  glob mismatch is fixed in `dd2054f`); **nothing was published**, `0.1.0`
  is still free on the registry. Evidence: `NPM_PUBLICATION_REPORT.md` §1.
- [x] **Staged `0.0.1` bootstrap of both packages (staged variant)** — 2026-10-27
  (`NPM_TRUSTED_PUBLISHING_SETUP.md` §0 "Staged variant actually used"):
  `npm stage publish` of core `0.0.1` and CLI `0.0.1` (whose packed manifest
  carries the concrete `@veylqorix/core@0.0.1`), creating both packages on
  the registry. Staged `0.0.1` approval/rejection is a 2FA-protected owner
  action and is **optional** — the `0.1.1` release does not depend on it.
- [x] **`v0.1.1` tag exists** — `dd2054f` on both local and
  `origin`, manifest versions `0.1.1` in both packages, so the tag/version
  guard will accept it. `v0.1.0` tag is immutable history; do not move it.

## B. Blocked items

- [ ] **B1 — npm trusted-publisher records not registered** (both packages).
  The `v0.1.1` release run (`40558927305`) failed at publish because no
  trusted-publisher record exists yet; nothing is published until C1. Owner
  action, ~2 min; cross-referenced to
  `docs/engineering/NPM_TRUSTED_PUBLISHING_SETUP.md` §2 (the `npm trust`
  CLI commands with `--allow-publish` for both packages). **Blocker for the
  whole release.** Owned by workflows/npm workstream (the runbook step) /
  maintainer (the action).
- [ ] **B2 — `@veylqorix` scope ownership + 2FA unconfirmed.** `npm whoami`
  returned 401 (a rejected 40-char granular token under both npm 10.9.8 and
  12.2.1). The owner must confirm scope ownership and 2FA on the owning
  account in the npm UI before the bootstrap/trust steps can succeed. Cross-
  reference: `NPM_TRUSTED_PUBLISHING_SETUP.md` §1. Maintainer action.
- [ ] **B3 — `docs/engineering/VALIDATION_REPORT.md` is PENDING.** All Rust
  and TS validation (fmt/clippy/test/release-build, build/lint/typecheck/tests,
  pack dry-runs, clean-consumer smoke) is scaffolded but not yet executed
  against the current tree; the lead fills it in before the tag re-trigger.
  See that doc's PENDING markers.
- [ ] **B4 — Launch-film generated cache still tracked** (`video/veylqorix-
  launch-film/.hyperframes/**`, 97 files incl. `video-state.json` with
  machine-local paths; `video/**/*.mp4` render outputs). `.gitignore` now
  covers them (security sweep, 2026-10-28) but the already-tracked files
  need `git rm --cached` by the owning workstream. Tracked, not security-
  sensitive; purely hygiene.
- [ ] **B5 — Stray website working copy** `veylqorix-website_try/` (own
  `.git`, `.next/`, `node_modules`) is untracked; `.gitignore` now covers it
  but the directory itself should be removed or intentionally kept by the
  owning workstream. Purely hygiene.
- [ ] **B6 — `packages/mcp-server/package.json.bak`** is a byte-identical
  dead copy of `package.json` and is tracked. Remove. Purely hygiene.
- [ ] **B7 — `cargo audit` last recorded 0 vulns (2026-10-26)** — re-run at
  release time; `cargo audit` is optional in CI (tool-probe + honest SKIP).
- [ ] **B8 — CI gitleaks SHA-256 digest** is pinned to v8.30.1 (digest
  computed at commit time, 2026-10); re-verify **only** if the pinned
  version ever changes. No action today.

## C. Required maintainer actions (npm side, owner only)

All entries are on the owning npm account (not the GitHub org) and are the
sole blockers to a successful `0.1.1` publish. Single source of truth:
`docs/engineering/NPM_TRUSTED_PUBLISHING_SETUP.md`.

- [ ] **C1 — Register the npm trusted-publisher record for `@veylqorix/cli`
  (and `@veylqorix/core`)** — run the `npm trust github …` commands in
  `NPM_TRUSTED_PUBLISHING_SETUP.md` §2 with `--allow-publish` on **both**
  packages (new configurations default to stage-only; the direct-publish
  action must be explicitly enabled or the workflow's `npm publish` is
  rejected 403). Command:

  ```bash
  npm trust github @veylqorix/core \
    --file release.yml --repository soumyachk101/Veylqorix --allow-publish
  npm trust github @veylqorix/cli \
    --file release.yml --repository soumyachk101/Veylqorix --allow-publish
  ```

  **2-day window:** a trusted-publisher configuration that does not complete
  its first successful publish within 2 days expires and must be deleted and
  re-created.
- [ ] **C2 — Confirm `@veylqorix` scope ownership + 2FA** on the owning
  account (`NPM_TRUSTED_PUBLISHING_SETUP.md` §1). The `0.0.1` bootstrap
  stages (§verified in A above) already require this.
- [ ] **C3 — Approve or reject the staged `0.0.1` bootstrap versions**
  (`npm stage approve`/`npm stage reject`) — 2FA-protected owner action,
  optional (the `0.1.1` release does not depend on the staged `0.0.1`),
  but the record must exist before C1.
- [ ] **C4 — Re-trigger the failed `v0.1.1` release run** — `gh run rerun
  40558927305` **within 2 days** of creating **both** trusted-publisher
  records (C1). The tag `v0.1.1` already exists on `dd2054f` and matches
  both manifests; do not move or recreate the `v0.1.0` tag.
- [ ] **C5 — Monitor the new `release.yml` run** to green: the new `test`
  job must pass, `pack` must succeed, `publish` must succeed for core, the
  registry-visibility poll must succeed, and `publish` for CLI must
  succeed. Both packages must show a provenance attestation on npm
  (`NPM_TRUSTED_PUBLISHING_SETUP.md` §3).

## Order of operations

1. B1 (trust record) + B2 (scope/2FA) + C3 (staged bootstrap approve,
   optional) → **C1 → C4** (re-trigger within 2 days) → C5 (verify).
2. In parallel: B3 (fill `VALIDATION_REPORT.md`), B4/B5/B6 (hygiene), B7
   (re-run `cargo audit`), B8 (no action).

The repo-side work is complete and committed (`main` at the `v0.1.1` tag
commit `dd2054f` plus the in-worktree `test` job). Only C1/C2/C3/C4/C5 —
all owner-only — can move the release forward from here.
