# NPM Publication Validation Report

Date: 2026-10-27. Prepared by the release-validation session for the first
public npm release of `@veylqorix/core` and `@veylqorix/cli` (both `0.1.0`).

## Files changed

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | `pnpm/action-setup` `version:` corrected to exactly `"11.9.0"` to match the root `packageManager` (was `9`, then `11`; pnpm/action-setup v4 compares the two strings with strict equality and fails the step on mismatch). |
| `.github/workflows/veylqorix-gate.yml` | same one-line exact pin `version: "11.9.0"`. |
| `package.json` | added `"packageManager": "pnpm@11.9.0"` — the anchor the three workflows' pnpm pins must match. |
| `.github/workflows/release.yml` | reworked into two jobs: `pack` (contents:read; pnpm `11.9.0`, Node 24, frozen install, new tag/version guard step, targeted builds, `pnpm --filter <name> pack`, upload-artifact v4.6.2 SHA-pinned) and `publish` (needs pack; id-token:write, download-artifact v4.3.0, two separate `npm publish <tgz> --provenance --access public` steps under `set -euo pipefail`). Header comments updated; stale "GitHub App" reference removed. |
| `packages/core/package.json` | exports `./gate` → `dist/gate/index.js(.d.ts)`, `./report` → `dist/report/index.js(.d.ts)` (the old flat paths do not exist in the built layout); added `repository` and `homepage` metadata matching the GitHub repository. |
| `apps/cli/package.json` | added `repository` and `homepage` metadata matching the GitHub repository (no version or dependency changes). |
| `apps/cli/src/index.ts` | bare `veylqorix -h/--help` now prints usage and exits 0 (previously fell through to `scan` on the current directory). |
| `docs/engineering/NPM_PUBLICATION_AUDIT.md` | new — Phase 1/2 audit record (written by the CI-fix head, corrected this session to the two-job workflow and to the verified `pnpm pack` rewrite). |
| `docs/engineering/NPM_TRUSTED_PUBLISHING_SETUP.md` | new — owner setup doc (per-package trusted publishers, prerequisites, verification, non-goals). |
| `docs/engineering/RELEASE_READINESS.md` | §4 owner-setup block replaced (pointed at the new doc); new §7 release checklist (A/B split) with the tag commands fenced as documentation-only; stale `allowBuilds` "placeholder" line corrected (values are set: esbuild/sharp true). |
| `docs/engineering/SUPPLY_CHAIN.md` | §4 gitleaks row corrected (SHA-256 check now exists in ci.yml; the "no checksum — gap" note was stale); §5 pinning inventory extended with the five `release.yml` pins. |
| `docs/engineering/NPM_PUBLICATION_REPORT.md` | this report. |

No changes to `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `apps/web/`,
website content, or deployment configuration. (The `repository`/`homepage`
fields were added to both `packages/core/package.json` and
`apps/cli/package.json` above; no version, dependency, or
`publishConfig` changes.)

## Problems found and fixes

1. **CI lockfile blocker (the reported failure).** `ci.yml` and
   `veylqorix-gate.yml` pinned pnpm `version: 9`, but the lockfile was
   produced under pnpm 11 with `allowBuilds`/`overrides` in
   `pnpm-workspace.yaml` — pnpm 9 reads those from the `pnpm` field of
   `package.json` instead, so `pnpm install --frozen-lockfile` failed with
   `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. Fixed by pinning pnpm 11 in both
   workflows; no lockfile rewrite, no `--no-frozen-lockfile` workaround.
2. **Packed CLI would be uninstallable.** The old release workflow packed
   with `npm pack`, which copies the manifest verbatim — the CLI tarball
   would carry `"@veylqorix/core": "workspace:*"`, unresolvable on the
   registry. Verified locally that `pnpm pack` rewrites it to `0.1.0`;
   the workflow now packs with `pnpm --filter <name> pack`.
3. **Core exports pointed at nonexistent files.** `./gate` and `./report`
   pointed at flat `dist/gate.js`/`dist/report.js`; the built layout is
   `dist/gate/index.js` / `dist/report/index.js`. Corrected.
4. **`veylqorix --help` started a scan.** A bare `-h`/`--help` fell through
   to the default `scan` command on the current directory. Now prints usage
   and exits 0.
5. **Stale docs.** SUPPLY_CHAIN.md claimed the gitleaks CI download had no
   checksum (it has had one since a previous session); its action inventory
   predated release.yml. Both corrected.

## Release-side fixes and constraints (2026-10-27)

Fixes and guard rails added to the release path after the above, and one
hard constraint the owner must plan around:

- **pnpm exact-version correction.** All three workflows
  (`ci.yml`, `veylqorix-gate.yml`, `release.yml`) now pin pnpm to exactly
  `11.9.0`, matching the root `packageManager` field
  (`pnpm@11.9.0`). `pnpm/action-setup` v4 compares the workflow's
  `version:` input against that string with **strict equality** and fails
  the step on any mismatch, so a bare major (`11`) does not work. This is
  a pin correction — the packages remain `0.1.0`.
- **Tag/version guard in the `pack` job of `release.yml`.** Before any
  build or publish, the pack job verifies the pushed tag (must match
  `v<semver>`) against the `version` field in **both**
  `packages/core/package.json` and `apps/cli/package.json` and fails
  loudly on disagreement. This matters because a published npm version is
  immutable: a bad tag cannot be fixed by re-tagging, so the mismatch
  must be caught before publish.
- **`repository` and `homepage` metadata added** to both
  `packages/core/package.json` and `apps/cli/package.json`, matching the
  GitHub repository (see the Files changed table above).
- **First-publication constraint (owner-machine bootstrap required).** The
  first publication of each package **cannot be performed by the OIDC
  workflow**: npm trusted-publisher records exist only on packages that
  already exist on the registry, and the trusted-publisher docs / `npm
  trust` CLI state the package must already exist before a trusted
  publisher can be configured for it. Each package therefore needs a
  **one-time, 2FA-protected manual publish on the owner's own machine**
  (a bootstrap version such as `0.0.1` — core first, then the CLI, so the
  CLI's dependency range resolves — or a staged-publish placeholder; full
  procedure in `NPM_TRUSTED_PUBLISHING_SETUP.md` §0). The `v0.1.0` tag
  push **alone is not sufficient to publish either package** until that
  bootstrap exists. The bootstrap is a one-time exception on the owner's
  machine — it is never a repository secret, never an `NPM_TOKEN`, and
  never an `npm login` on the CI runner.

## Commands executed (this session, in this checkout)

```
pnpm install --frozen-lockfile            # after clean node_modules removal: PASS (pnpm 11.9.0)
pnpm -r build                             # PASS (all workspaces incl. apps/web)
cargo build  --manifest-path crates/Cargo.toml --workspace --release   # PASS
cargo fmt --manifest-path crates/Cargo.toml --all -- --check          # PASS
cargo test   --manifest-path crates/Cargo.toml --workspace --all-features  # PASS (41 unit + integration suites, 0 failures)
cargo clippy --manifest-path crates/Cargo.toml --workspace --all-targets --all-features -- -D warnings  # PASS
pnpm test                                 # PASS: 18 files, 308 tests
pnpm typecheck                            # PASS
pnpm lint                                 # PASS
node yaml-parse .github/workflows/{release,ci,veylqorix-gate}.yml     # all parse
pnpm --filter @veylqorix/core pack --pack-destination ./artifacts     # PASS → veylqorix-core-0.1.0.tgz
pnpm --filter @veylqorix/cli  pack --pack-destination ./artifacts     # PASS → veylqorix-cli-0.1.0.tgz
pnpm -C packages/core publish --dry-run --access public --no-git-checks   # PASS (skip published, dry run)
pnpm -C apps/cli  publish --dry-run --access public --no-git-checks       # PASS (skip published, dry run)
npm view @veylqorix/core versions       # 404 — not published
npm view @veylqorix/cli versions        # 404 — not published
npm install <core.tgz> <cli.tgz> in /tmp/vx-consumer3                   # PASS, 0 vulnerabilities
node -e "import('@veylqorix/core')" (+ /report, /scanners/secrets subpaths)  # all resolve in clean consumer
./node_modules/.bin/veylqorix --help    # exit 0
./node_modules/.bin/veylqorix config validate <repo>/veylqorix-policy.json   # exit 0
./node_modules/.bin/veylqorix scan --root <tmp> --offline --no-tests --scanners secrets   # exit 2 INCOMPLETE (honest engine-absent degradation)
pnpm audit    # "No known vulnerabilities found"
cargo audit   # 37 crates scanned, 0 vulnerabilities
```

Notes on two results:
- `pnpm publish --dry-run` required `--no-git-checks` locally because the
  working tree is intentionally uncommitted; in CI the checkout is clean,
  so the dry-run guard behaves normally there.
- Installing **only** the CLI tarball (without core) correctly fails with a
  registry 404 for `@veylqorix/core@0.1.0` until core is published — the
  expected order-dependency, matching the workflow's core-before-CLI steps.

## Results summary

- **Clean-checkout CI locally:** green (frozen install, build, 308 vitest
  tests, typecheck, lint, fmt, clippy, cargo test). The GitHub Actions run
  itself was not executed from here — the pnpm-9 mismatch was reproduced in
  CI and the fix is version-pinning only, but CI is not independently
  re-confirmed on GitHub until the changes are pushed.
- **Trusted publishing verified?** No. No live OIDC publish has been run;
  the `--provenance` publish path is structurally ready and fails closed
  until the owner registers trusted publishers for **both** packages on
  npm. Nothing has been claimed as published.
- **npm version availability:** `@veylqorix/core` and `@veylqorix/cli`
  both 404 on the registry as of 2026-10-27 — `0.1.0` is free, no bump
  needed, tag `v0.1.0`.
- **Security:** pnpm audit and cargo audit clean; overrides
  (postcss 8.5.31 / sharp 0.35.5) consistent across workspace file,
  lockfile, and SUPPLY_CHAIN.md; published-package dependency trees
  (semver, zod) trigger zero install scripts. Separately: provenance
  attests build source (commit + workflow), **not** the absence of
  vulnerabilities; and the engine-absent failure mode is honest — binary
  absent/unresolvable → SKIPPED/INCOMPLETE (exit 2), binary present but
  broken → exit 70 (documented, not silent).

## Owner actions still required (in order)

1. Push the release changes and confirm CI green on the branch.
2. Confirm `@veylqorix` scope ownership and 2FA on the npm account that
   controls it; run `npm view @veylqorix/{core,cli} versions` (see
   `NPM_TRUSTED_PUBLISHING_SETUP.md` §1). Both packages currently 404.
3. Perform the one-time bootstrap publication of **each** package from the
   owner's machine under 2FA (`NPM_TRUSTED_PUBLISHING_SETUP.md` §0):
   publish core at the bootstrap version first, then the CLI with a
   dependency range matching that bootstrap core version, then restore
   `0.1.0` in both manifests for the tagged release. The tag push alone
   does **not** publish either package until this bootstrap exists.
4. Register the trusted publisher for **each** of `@veylqorix/core` and
   `@veylqorix/cli` (§2 of that doc; Provider = GitHub Actions, owner
   `soumyachk101`, repo `Veylqorix`, workflow `release.yml`, no
   environment), with **direct `npm publish` allowed** — new
   configurations default to stage-only, and the workflow's publish step
   requires the direct-publish action to be enabled.
5. Push the tag **within 2 days of creating both trusted-publisher
   configurations** (each config expires if its first successful publish
   is not completed within 2 days, and must be deleted and re-created):

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

   The `pack` job's tag/version guard rejects any tag that disagrees with
   the `0.1.0` version declared in both manifests before anything
   publishes.
6. Monitor the release run it triggers on GitHub Actions — both publish
   steps (core, then CLI) must succeed.
7. Confirm both `@veylqorix/core` and `@veylqorix/cli` npm package pages
   show a provenance attestation for `0.1.0` (per
   `NPM_TRUSTED_PUBLISHING_SETUP.md` §3).

## Confirmations

No package was published, no npm dry-run wrote to the registry, no tag was
created or pushed, no GitHub release was created, no commits or pushes were
made, and no website UI/SEO/deployment configuration was changed. The only
registry-touching commands were read-only (`npm view`).
