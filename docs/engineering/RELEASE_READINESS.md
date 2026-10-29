# Veylqorix — Release Readiness Checklist

Release-readiness checklist for publishing `@veylqorix/cli` +
`@veylqorix/core` `0.1.1` to npm. Regenerated 2026-10-28 by the security sweep
from the session narrative that preceded it; final-sweep update 2026-10-28
(post-`6480b4a`) reconciled with `NPM_PUBLICATION_REPORT.md` §4f and
`NPM_TRUSTED_PUBLISHING_SETUP.md` §6. The detailed evidence lives in
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
  (`on: push: tags: [v*]`), three jobs `pack` + `test` (parallel) →
  `publish`, with a tag/manifest-version guard (fail-loud on mismatch; npm
  versions are immutable once published), SHA-pinned Actions,
  `id-token: write` on `publish` only, no `NPM_TOKEN`/`npm login`
  anywhere. Evidence: `.github/workflows/release.yml:53-279`.
- [x] **CI gating of releases (committed at `6480b4a`)** — `release.yml`
  has a `test` job mirroring `ci.yml` (install → build → Rust
  fmt/clippy/test/release-build → `pnpm test` → typecheck → lint) and
  `publish` needs `[pack, test]`, so a tag can no longer publish a commit
  whose validation failed. Evidence: `release.yml` `test` job, committed
  in `6480b4a` (2026-10-28 release-audit commit).
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

- [ ] **B1 — CLI trusted-publisher record not registered** (core record is
  done: `@veylqorix/core@0.1.1` published with a signed provenance
  attestation in run `40558927305`). The run then failed only at
  `Publish @veylqorix/cli` with `ENEEDAUTH` — the one remaining gap.
  Owner action, ~2 min; exact fields and CLI commands in
  `docs/engineering/NPM_TRUSTED_PUBLISHING_SETUP.md` §6 (STEP 1).
  **The single remaining blocker for the release.**
- [x] **B2 — `@veylqorix` scope ownership + 2FA** — owner ran
  `npm login` on the owning account and confirmed scope ownership via
  `npm org ls veylqorix` (2026-10-27, `NPM_PUBLICATION_REPORT.md` §4c).
  Residual nuance: the configured granular token bypasses 2FA, so
  2FA-gated steps (`npm trust`, `npm stage approve`) require the web UI.
- [x] **B3 — `docs/engineering/VALIDATION_REPORT.md` is filled in with real
  results.** Every runnable section was executed in this checkout on
  2026-10-29 and is recorded **PASS** with evidence: Rust (A: R1–R5, including
  `cargo audit` → 0 vulnerabilities), TypeScript/pnpm (B: T1–T7, including
  `pnpm audit` → 0 known vulnerabilities and the `postcss@8.5.31` /
  `sharp@0.35.5` override resolution), docs/diagrams (C: D1–D7), and package
  inspection (D: P1–P4, including the clean-consumer install and the
  `veylqorix --help` smoke test). P5 is split honestly: the **core** half is
  verified on the registry, the **CLI** half is explicitly left pending the
  owner action in §C — it is not claimed as passing. The only remaining
  PENDING items are the hosted tag-push `test` job and the maintainer
  trusted-publisher step, both of which are outside this checkout.
- [x] **B4 — Launch-film generated cache removed from tracking** (`video/
  veylqorix-launch-film/.hyperframes/**`, 97 files incl. `video-state.json`
  with machine-local paths; `video/**/*.mp4` render outputs). Staged for
  deletion in the 2026-10-28 audit commit (`6480b4a`); `.gitignore` covers
  the paths so they stay out.
- [x] **B5 — Stray website working copy removed.** `veylqorix-website_try/`
  (own `.git`, `.next/`, `node_modules`) no longer exists on disk as of
  2026-10-29; the `.gitignore` entry is retained defensively. Purely
  hygiene, now closed.
- [x] **B6 — `packages/mcp-server/package.json.bak`** removed from tracking
  in `6480b4a` (was a byte-identical dead copy of `package.json`).
- [x] **B7 — `cargo audit` re-run at release time.** Executed 2026-10-29 with
  cargo-audit 0.22.2: scanned 37 crate dependencies against 1386 advisories,
  exit 0, **0 vulnerabilities**. `cargo audit` remains optional in CI
  (tool-probe + honest SKIP).
- [ ] **B8 — CI gitleaks SHA-256 digest** is pinned to v8.30.1 (digest
  computed at commit time, 2026-10); re-verify **only** if the pinned
  version ever changes. No action today.
- [x] **B9 — Root `SHA256SUMS` decoy + `apps/web/tsconfig.tsbuildinfo`
  hygiene** (2026-10-29 re-sweep, `REPOSITORY_AUDIT.md` A23/A24). The root
  decoy is **gone from disk** and stays gitignored; `apps/web/tsconfig.tsbuildinfo`
  is gitignored and untracked. The real integrity manifest,
  `Veylqorix_Diagrams/SHA256SUMS`, was restored as the checksum manifest for
  the 7 diagram PNGs — `shasum -a 256 -c SHA256SUMS` from inside the directory
  reports OK for all 7. Purely hygiene, now closed.

## C. Required maintainer actions (npm side, owner only)

All entries are on the owning npm account (not the GitHub org) and are the
sole blockers to a successful `0.1.1` publish. Single source of truth:
`docs/engineering/NPM_TRUSTED_PUBLISHING_SETUP.md`.

- [ ] **C1 — Register the npm trusted-publisher record for `@veylqorix/cli`
  (core is already done)** — as of the confirmed `v0.1.1` run
  (`40558927305`), `@veylqorix/core@0.1.1` published successfully with a
  signed provenance attestation, so the **core** record is validated and
  must **not** be re-created; the run then failed only at `Publish
  @veylqorix/cli` with `ENEEDAUTH`. The one remaining gap is the **CLI**
  record: run the CLI `npm trust github …` command in
  `NPM_TRUSTED_PUBLISHING_SETUP.md` §2/§6 with `--allow-publish` (new
  configurations default to stage-only; the direct-publish action must be
  explicitly enabled or the workflow's `npm publish` is rejected 403 — that
  rejection is exactly the `ENEEDAUTH` seen). The step-by-step, owner-only
  (2FA web session) account is `NPM_TRUSTED_PUBLISHING_SETUP.md` §6.
  Commands (for reference; only the CLI line is still needed):

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
  account (`NPM_TRUSTED_PUBLISHING_SETUP.md` §1). The `0.0.0-stage`
  bootstrap placeholders (§verified in A above) already require this.
- [ ] **C3 — Approve or reject the staged `0.0.0-stage` bootstrap
  placeholders** (`npm stage approve`/`npm stage reject`) — 2FA-protected
  owner action, optional (the `0.1.1` release does not depend on the staged
  placeholder), but the record must exist before C1.
- [ ] **C4 — Re-trigger the `v0.1.1` release with the fixed workflow** —
  create the **CLI** record (C1), then re-point the tag at the commit that
  carries the fixed `release.yml` (currently `6480b4a`, the release-audit
  commit on `main`) and push it:
  `git tag -f v0.1.1 && git push -f origin v0.1.1`. Do this **the same day**
  as C1, so the CLI record's 2-day first-publish window isn't missed.
  **Why not `gh run rerun 40558927305`:** `gh run rerun` re-executes the
  workflow *from the run's commit* (`dd2054f`), which has no `test` job and
  a non-idempotent core step — since `@veylqorix/core@0.1.1` is now
  published, re-running *that* commit would hard-fail on the core step with
  `EPUBLISHCONFLICT` and never reach the CLI step. (The tag/version guard
  still passes: the manifests at the new commit declare `0.1.1`.) Do not
  move or recreate the `v0.1.0` tag. There is **no version bump to
  `0.1.2`** — the tag is re-pointed, and core `0.1.1` is never republished
  (npm versions are immutable; the workflow's registry-presence pre-check
  skips it with a notice).
- [ ] **C5 — Monitor the new `release.yml` run** to green: the new `test`
  job must pass, `pack` must succeed, the core publish step **skips with a
  notice** (already on the registry — the registry-presence pre-check), the
  registry-visibility poll must succeed, and `publish` for CLI must
  succeed. Both packages must show a provenance attestation on npm
  (core's exists from run `40558927305`; CLI's comes with the new publish —
  `NPM_TRUSTED_PUBLISHING_SETUP.md` §3).

## Order of operations

1. C3 (approve/reject the `0.0.0-stage` placeholder, optional) → **C1
   (create the CLI trusted-publisher record)** → **C4 (re-point `v0.1.1` at
   the fixed commit and push, same day)** → C5 (verify).
2. In parallel: B8 (gitleaks digest — no action today). B3, B5, and B7 are
   already closed (see §B): the validation report is filled in with real
   results, the stray checkout is gone, and `cargo audit` was re-run
   (0 vulnerabilities).

The repo-side work is complete and committed: the fixed `release.yml`
(three jobs `pack`+`test`→`publish`, idempotent re-run guards, registry-
visibility wait) is on `main` at `6480b4a`, and every runnable validation
command (Rust, TypeScript, package inspection) has been executed locally and
recorded **PASS** in `VALIDATION_REPORT.md`. The `v0.1.1` tag still points
at `dd2054f` (pre-fix), so C4's re-point is the one remaining git step.
`@veylqorix/core@0.1.1` is already published; only `@veylqorix/cli@0.1.1`
remains, and only C1/C4/C5 — all owner-only — can complete the release from
here.
