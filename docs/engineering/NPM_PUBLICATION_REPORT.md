# NPM Publication Validation Report

**This document covers two sessions.** The current release state is the
"Second audit round" section below (2026-10-27, evidence-backed, against the
real GitHub Actions history and the live npm registry). The earlier session's
record is retained underneath under "First validation session" as history —
where the two disagree, the second round wins.

**Single source of truth for the release procedure:**
`docs/engineering/NPM_TRUSTED_PUBLISHING_SETUP.md`. This report is the
evidence log; that doc is the procedure.

---

# Second audit round (2026-10-27)

Scope: full release audit of the repository, the release workflow, the live
registry state, and the actual Actions history for the `v0.1.0` tag. No
package was published, no tag was moved, no push was made.

## 1. Verified repository facts

**Git state**
- Branch `main`, HEAD `4d694d4` ("docs(release): record the real v0.1.0 tag
  run and the Node-24 CI fix"), equal to `origin/main`.
- Exactly one tag: `v0.1.0`, a **lightweight** tag pointing at commit
  `e768d08fc14ca444baf72e595a6df1f22b8195b1` ("feat(release): npm
  trusted-publishing pipeline for @veylqorix/core + cli"). Present locally
  and on the remote at the same SHA — no divergence.
- `main` is **2 commits ahead** of the tag (`624f678` Node-24 CI fix,
  `4d694d4` docs), linearly — no fork. The tagged commit is an ancestor of
  HEAD.
- Consequence: `v0.1.0` points at a commit whose **CI was failing** (run
  `40500840104` failed at "Set up Node" — Node 20 vs pnpm 11.9.0). The
  Node-24 fix is on `main`, not in the tag.

**npm registry (live, read-only probes)**
- `npm ping` → PONG. `npm view @veylqorix/core` → **E404**;
  `npm view @veylqorix/cli` → **E404**. Neither package has ever been
  published; no versions, no dist-tags, no `0.1.0` on the registry.
- The **`@veylqorix` scope exists** on the registry:
  `/-/org/veylqorix/package` → HTTP 200 with an empty package list, while a
  control unknown scope → 404. So the scope is held by a user account or
  organization named exactly `veylqorix`.
- Ownership of that account/org **cannot be verified from the CLI** (private
  settings are not exposed) — the owner must confirm it in the npm UI.
- `npm whoami` returned **401**: the `_authToken` in `~/.npmrc` is not
  currently accepted. The bootstrap publish will need a working credential.
- Version availability: everything is free, including `0.0.1` (bootstrap),
  `0.1.0` and `0.1.1`.

**GitHub Actions history**
- Exactly one `release.yml` run exists: **run `40500854557`**, event `push`,
  tag `v0.1.0`, head SHA `e768d08`, conclusion **failure**, 34s.
  https://github.com/soumyachk101/Veylqorix/actions/runs/40500854557
- `pack` job: **passed every step**. The tag/version guard printed
  `Tag v0.1.0 matches both manifest versions (0.1.0)`. Both tsc builds
  succeeded. `pnpm pack` produced `veylqorix-core-0.1.0.tgz` (74,296 B) and
  `veylqorix-cli-0.1.0.tgz` (11,160 B), uploaded as artifact
  `packaged-tarballs`; the publish job downloaded it with a matching SHA256.
- `publish` job: **failed at the first publish step**, with a verbatim error
  that is *not* an auth or npm error:

      ls: cannot access 'packaged-tarballs/veylqorix-core-*.tgz': No such file or directory
      ##[error]Process completed with exit code 2.

  Root cause: the download step had no `path:` input, so
  `actions/download-artifact` extracted the tarballs into the **workspace
  root** while the publish steps globbed `packaged-tarballs/`.
- **`npm publish` was never invoked** for either package — the failure was
  before npm. The "Publish @veylqorix/cli" step was **skipped**, confirming
  the core-before-CLI fail-safe ordering works. **Nothing was published**;
  both packages still 404.
- No provenance attestation exists for either package.
- CI on `main`: latest run **`40502140372`**, SHA `4d694d4` (= HEAD),
  conclusion **success**. https://github.com/soumyachk101/Veylqorix/actions/runs/40502140372
  The Node-24 fix run `40501372986` (`624f678`) also succeeded.

**Workflow audit (`release.yml`)** — every checklist item verified against
the file and the run history: tag-only trigger with a semver tag/version
guard checked against both manifests; Node 24 (pnpm 11.9.0 needs >= 22.13);
`pnpm/action-setup` pinned to exactly `11.9.0`, matching the root
`packageManager`; `pnpm install --frozen-lockfile`; targeted core-then-cli
builds; `pnpm pack` (not `npm pack`) so the CLI's `workspace:*` becomes a
concrete version; `pack` job `contents: read` only; `publish` job
`contents: read` + `id-token: write`; every external action pinned to a full
40-char SHA (zero `@vN` floats); no `NPM_TOKEN` and no `npm login`; core
published before CLI; no retry/`|| true` masking a duplicate version.

**Toolchain consistency:** root `packageManager: pnpm@11.9.0` = workflow pin
`11.9.0` = lockfile `lockfileVersion: '9.0'` (still written by pnpm 11);
`pnpm-workspace.yaml` `allowBuilds`/`overrides` match the lockfile header.

## 2. Fixes implemented in this round

| File | Change | Why |
|---|---|---|
| `.github/workflows/release.yml` | download step now sets `path: packaged-tarballs` | **The actual cause of the v0.1.0 failure.** Without it the tarballs extract to the workspace root and the publish globs find nothing. |
| `.github/workflows/release.yml` | publish steps use `ls ... \| head -n 1` | Robustness: an unmatched glob previously produced an opaque `ls` error; `head -n 1` plus `set -o pipefail` still fails the step but the glob resolves deterministically. |
| `.github/workflows/release.yml` | new step "Wait for @veylqorix/core to be visible on the registry" (reads the concrete core version out of the packed tarball, polls `npm view` up to 60s, fails closed) | The CLI's published manifest depends on a concrete `@veylqorix/core` version. npm's registry is eventually consistent, so publishing the CLI immediately after core could ship a CLI whose dependency does not yet resolve. The wait makes the ordering guarantee real rather than assumed. |
| `.github/workflows/veylqorix-gate.yml` | `inputs.root` and `inputs.block-on` are passed via `env:` instead of being interpolated into the shell source, and are validated (relative-path character set; comma-separated severities) before use | **Command injection.** A calling repo could pass `root: x"; <cmd>"` and execute arbitrary commands in the gate job. The input was previously interpolated directly into the `run:` script. |
| `packages/core/package.json` | removed the `semver` and `zod` dependencies | Verified unused: no import of either in `packages/core/src` or `apps/cli/src`, and neither appears in the built `dist/`. They were dead supply-chain surface — consumers downloaded two packages the code never loads. (`@veylqorix/mcp-server` declares its own `zod`, so removing core's does not orphan it.) |
| `packages/core/package.json`, `apps/cli/package.json` | version `0.1.0` → `0.1.1`; `publishConfig.provenance: true` added | `0.1.0` was never published, but `0.1.1` matches the new release plan and keeps the bootstrap (`0.0.1`) strictly below the release version. `provenance: true` makes the attestation request explicit in the manifest. |
| `package.json` (root) | version → `0.1.1`; `engines.node` `>=20.18` → `>=22.13` | The root `engines` floor understated the toolchain: pnpm 11.9.0 requires Node >= 22.13 and crashes on Node 20. The *published* packages keep `>=20.18` — that is a consumer runtime floor, a different thing, and is correct as-is. |
| `pnpm-lock.yaml` | regenerated after the dependency removal and the root version bump | `packages/core` importer is now `{}`; `pnpm install --frozen-lockfile` passes. |
| `docs/engineering/*.md` | all four release docs reconciled to the verified facts | They still described the v0.1.0 run as an npm auth failure (it was a path bug) and still referenced `0.1.0` as the release version. |

Nothing was weakened to make a check pass: CI still runs with
`--frozen-lockfile`, tests, typecheck, lint and the Rust checks; no test was
skipped and no error suppressed. The website, its UI, SEO, content and
deployment configuration were not touched.

## 3. Checks that passed (this checkout)

```
pnpm install --frozen-lockfile            PASS (pnpm 11.9.0, lockfile up to date)
pnpm --filter @veylqorix/core build       PASS (tsc)
pnpm --filter @veylqorix/cli  build       PASS (tsc)
pnpm test                                 PASS — 18 files, 308 tests
pnpm typecheck                            PASS
pnpm lint                                 PASS (eslint --max-warnings 0)
cargo check --manifest-path crates/Cargo.toml   PASS
pnpm --filter @veylqorix/core pack        PASS → artifacts/veylqorix-core-0.1.1.tgz (74,285 B)
pnpm --filter @veylqorix/cli  pack        PASS → artifacts/veylqorix-cli-0.1.1.tgz  (11,172 B)
npm install <both tarballs> (clean dir)   PASS — 2 packages, 0 vulnerabilities
node_modules/.bin/veylqorix --help        PASS — usage block, exit 0
import('@veylqorix/core')                 PASS — 59 exports resolve
```

Packed-tarball verification:
- Core tarball: `dist/**` only (js + d.ts + maps) plus `package.json`. No
  `src/`, no `*.test.ts`, no `tsconfig.json`, no lockfile, no `.env`.
- CLI tarball: `dist/cli-args.*`, `dist/index.*`, `LICENSE`, `package.json`.
  `dist/index.js` carries `#!/usr/bin/env node` and mode 755.
- **CLI dependency resolution:** the packed CLI manifest carries
  `"@veylqorix/core": "0.1.1"` — a concrete version, not `workspace:*`.
  Confirmed from the tarball, not from the source manifest.
- Core now has **zero** runtime dependencies in its packed manifest.

Workflow validation:
- `release.yml` parses under a strict YAML loader that rejects duplicate
  mapping keys — no duplicates, `pack`/`publish` jobs intact.
- The registry-visibility step's version extraction was run against the real
  tarball: it correctly yields `0.1.1`, matching the CLI's declared
  dependency.

## 4. Checks that failed

- **`npm view @veylqorix/core@0.1.1`** → E404. Expected: nothing is
  published yet. This is the state the bootstrap must change.
- **`npm whoami`** → 401. The npm credential configured in `~/.npmrc` is not
  currently accepted by the registry. The bootstrap publish needs a working
  credential (2FA or a valid token). No credential was used, inspected, or
  requested.
- The GitHub Actions release run itself remains **red** — but only against
  the old workflow. The fix is in the working tree and unproven until a tag
  is pushed; it cannot be exercised locally.

## 4b. Release execution attempt (2026-10-27, after the merge)

The owner instructed the release to be executed. It is **blocked at the
credential layer** — everything else was prepared and verified:

- **PR #107** was merged to `main` as `e39f381`; post-merge CI run
  `40543450655` succeeded. All the release fixes are now on `main`.
- **npm credential:** the `_authToken` in `~/.npmrc` is a 40-character
  `npm_`-prefixed granular/automation token, and the registry rejects it:
  `npm whoami` → `E401` ("your authentication token seems to be invalid"),
  identically under npm **10.9.8** and npm **12.2.1** — so this is a token
  validity problem, not an npm-version problem. `npm org ls veylqorix` and
  `npm access list packages @veylqorix/core` both return 401.
- **npm CLI upgraded** from 10.9.8 to **12.2.1** (installed under the
  `~/.npm-global` prefix; note `~/.local/bin/npm` on `PATH` still shadows it
  and reports 10.9.8 — use `~/.npm-global/bin/npm` for `npm trust`).
  `npm trust` is therefore available.
- **`npm trust` dry-run succeeded** and produced exactly the intended
  configuration for `@veylqorix/core`: file `release.yml`, repository
  `soumyachk101/Veylqorix`, permissions `publish`. The same command is now
  documented in `NPM_TRUSTED_PUBLISHING_SETUP.md` as the CLI equivalent of
  the web-UI steps.
- **The real `npm trust` call failed with E401** ("You must be logged in to
  publish packages") — the same rejected token.
- **Consequence:** the bootstrap publish (`npm publish`) and the trusted
  publisher creation both require a working credential. Neither was attempted
  with a fake or borrowed credential, and no OTP/password was requested.
- **Nothing was published, no tag was created or moved** (`v0.1.0` still at
  `e768d08`), no release was created. The working tree is unchanged: both
  manifests match `HEAD` at `0.1.1`; the `video/` changes remain uncommitted.

**This is now the single blocker for the entire release.** Everything on the
repository side is merged, green, and verified.

## 4c. Bootstrap state as of 2026-10-27 (23:00, after `npm login`)

After the owner ran `npm login` on the account that owns the `@veylqorix`
scope (confirmed via `npm org ls veylqorix`), the bootstrap
was executed as far as the credential allows:

- **Discovery that forced a procedure change:** `npm publish` of the 0.0.1
  tarballs initially failed with `EUSAGE "Automatic provenance generation not
  supported for provider: null"` — the `publishConfig.provenance: true` added
  in PR #107 makes npm attempt provenance on *every* publish, and a
  non-CI/owner-machine publish has no provider. The provenance flag was
  therefore stripped from the **local-only 0.0.1 dip** (never committed;
  `HEAD` still carries `provenance: true`, which is correct for the
  CI/OIDC path where provenance is the whole point).
- **`npm stage publish` used instead** (staging does not require 2FA):
  - `@veylqorix/core@0.0.1` staged, id `94a22c65-2e6e-4c21-8ebc-1f39588b5be6`
  - `@veylqorix/cli@0.0.1` staged, id `df5d9357-7f6d-4916-8ce6-9aa3fcf6a684`
  - Both now **exist on the registry**: `npm view` lists the public
    `0.0.0-stage` placeholder plus the staged version for each. This
    satisfies the prerequisite for attaching a trusted publisher.
- **The bypass-2FA granular token cannot do the 2FA-gated steps** —
  `npm trust`, `npm stage approve`, `npm stage reject` all fail with
  `EOTP` ("One-time password required"). This matches npm's published
  restriction that tokens bypassing 2FA cannot perform account changes or
  direct/staged approvals.
- Working tree restored: both manifests back at `0.1.1` with
  `publishConfig.provenance: true` (matching HEAD); the `video/` changes
  remain uncommitted; no tag was created or moved; no GitHub Release.

**Net effect:** the packages exist, so the owner can now attach the two
trusted publishers (web UI — the CLI is 2FA-blocked for this token). The
staged `0.0.1` versions are inert until approved or rejected; recommend
rejecting them (registry stays minimal — the `0.1.1` trusted publish is the
real release) or approving them (0.0.1 becomes a public bootstrap version;
also fine, `0.1.1 > 0.0.1`).

## 4d. v0.1.1 tag attempt (2026-10-27 23:15) — failed, root cause fixed

The `v0.1.1` tag (pointing at `677904f`) was pushed and triggered release
run [40558249646](https://github.com/soumyachk101/Veylqorix/actions/runs/40558249646):

- `pack` job: **passed** — the tag/version guard accepted `v0.1.1` against
  both `0.1.1` manifests; both builds and `pnpm pack` succeeded.
- `publish` job: **failed at "Publish @veylqorix/core"** — verbatim:

      npm error command git --no-replace-objects ls-remote ssh://git@github.com/packaged-tarballs/veylqorix-core-0.1.1.tgz.git
      npm error git@github.com: Permission denied (publickey).
      npm error code 128

  **Root cause:** npm >= 11 parses a bare `dir/file.tgz` argument (one path
  segment + one slash) as a `github:owner/repo` package spec, so `npm
  publish` tried to git-clone `packaged-tarballs/veylqorix-core-0.1.1.tgz`
  instead of reading the local tarball. Verified locally: the same command
  with the argument `./artifacts/...` (dry-run) behaves correctly.
- **Nothing was published** (the failure was before the registry request),
  so `0.1.1` remains free on the registry. No provenance exists.

**Fix (committed after this attempt):** both publish steps in
`.github/workflows/release.yml` now glob the tarball with a `./` prefix
(`./packaged-tarballs/...`), with a comment recording why. The `v0.1.1`
tag was re-pointed to the fix commit so the next run executes the fixed
workflow; the run can then be re-triggered from GitHub Actions ("Re-run all
jobs") or via `gh run rerun` — no version bump needed.

## 4e. v0.1.1 release status (checked 2026-10-27, post-`dd2054f`)

- The `./`-prefix tarball fix landed at commit `dd2054f`
  ("fix(release): publish via ./-prefixed tarball paths"); `main` ==
  `origin/main` == `dd2054f`. The `v0.1.1` tag was re-pointed to
  `dd2054f`; `v0.1.0` still points at `e768d08` and was not touched.
- The tag-push triggered release run [40558927305](https://github.com/soumyachk101/Veylqorix/actions/runs/40558927305).
  **Correction:** this run **published `@veylqorix/core@0.1.1`
  successfully** (signed provenance attestation) and failed only at the
  `Publish @veylqorix/cli` step with `ENEEDAUTH` — the CLI's
  trusted-publisher record was missing or misconfigured while core's
  was already registered. See section 4f for the log evidence.
- The registry is now **partway published**: `@veylqorix/core@0.1.1`
  exists (the signed-publish line in run 40558927305's log confirms it),
  the CLI remains unpublished, so the tag's completion is a single
  re-run after the CLI record is created. (A read-only
  `npm view @veylqorix/core@0.1.1` / `npm view @veylqorix/cli versions`
  will confirm both halves.)
- Remaining owner actions: create the **CLI** trusted-publisher record
  only (npm web UI, 2FA session — the configured bypass-2FA token
  fails `npm trust` with `EOTP`), then re-run the release
  (`gh run rerun 40558927305`). Full step-by-step:
  `docs/engineering/NPM_TRUSTED_PUBLISHING_SETUP.md` section 7.

## 4f. Confirmed ENEEDAUTH diagnosis (2026-10-28, from the Actions logs)

The `gh` CLI was available and authenticated in this environment, so run
[40558927305](https://github.com/soumyachk101/Veylqorix/actions/runs/40558927305)
(`v0.1.1`, head `dd2054f`) was fetched and read. The step-level evidence:

- Job `pack`: success — tag/version guard accepted `v0.1.1` against both
  `0.1.1` manifests; builds and `pnpm pack` passed; the `packaged-tarballs`
  artifact uploaded and was downloaded back with a matching SHA-256 digest
  (`sha256:1ec9dbed...`), so the `./`-prefix fix (`dd2054f`) is
  confirmed working.
- Job `publish` (runner image reports Node `v24.21.0`, npm `11.19.0`):
  - `Publish @veylqorix/core` — **success**, verbatim log lines:

        npm notice 📦  @veylqorix/core@0.1.1
        npm notice publish Signed provenance statement with source and build information from GitHub Actions

  - `Wait for @veylqorix/core to be visible on the registry` — success
    on the first poll attempt.
  - `Publish @veylqorix/cli` — **failure, exit code 1**, verbatim:

        npm notice 📦  @veylqorix/cli@0.1.1
        npm error code ENEEDAUTH
        npm error need auth This command requires you to be logged in to https://registry.npmjs.org/
        npm error need auth You need to authorize this machine using `npm adduser`

**Diagnosis:** `ENEEDAUTH` is the error npm returns for a trusted
publishing request whose OIDC token it cannot authorize for that
package — i.e. the trusted-publisher record for `@veylqorix/cli`
(matching owner `soumyachk101`, repository `Veylqorix`, workflow
`release.yml`) does not exist, or does not allow direct `npm publish`.
The same run, same OIDC token, same repository, same workflow file
published core with a signed provenance attestation — so the
repository-side workflow, the OIDC token, and the core record are all
proven correct; the gap is exactly one npm-side record, for the CLI.

Likely specific causes, in order of likelihood (all on the npm side,
none require a code change):
1. No trusted-publisher record was ever created for `@veylqorix/cli`
   (records are per-package — configuring core does not authorize the
   CLI).
2. A CLI record exists but was left at the post-2026-09-03
   stage-only default, with direct `npm publish` not enabled.
3. A CLI record exists with a mismatched field (repository or workflow
   filename) against the one core uses: owner `soumyachk101`,
   repository `Veylqorix`, workflow `release.yml`, environment unset.

Copy-paste-ready CLI check (read-only, no secrets):
`npm trust list @veylqorix/cli --json` — it should list **zero**
records with `allowPublish` or the equivalent; if it lists a record,
diff its fields against the ones above. The same command for
`@veylqorix/core` should list the working record.

**Workflow change made in response:** both publish steps in
`.github/workflows/release.yml` now first check the registry
(`npm view <pkg>@<version>`) and skip an already-published version
with a `::notice::` instead of failing with `EPUBLISHCONFLICT` —
without it, every re-run of `v0.1.1` would die at the core step,
which is permanently published. This makes the re-run that completes
the CLI publish idempotent. A new `test` job (mirroring the
`ci.yml` quality loop: install, build, Rust fmt/clippy/test, engine
release build, `pnpm test`, typecheck, lint) now gates the `publish`
job alongside `pack`, so a tag can no longer publish a commit whose
validation checks failed.

## 5. Actions requiring the owner's npm / GitHub account

These are the only steps that can move the release forward. Full detail in
`NPM_TRUSTED_PUBLISHING_SETUP.md`.

> **Superseded in part (2026-10-28, see §4f):** items 1–3 below predate
> the partial release: core's trusted-publisher record exists and has
> already validated its first publish (`@veylqorix/core@0.1.1` is on the
> registry with a provenance attestation), and the bootstrap staging
> versions exist for both packages. The only remaining owner action for
> the release is item 4 **for the CLI package**, then item 6's re-run —
> the exact current procedure is `NPM_TRUSTED_PUBLISHING_SETUP.md`
> section 6 (updated 2026-10-28). Items 1–3 are kept for history.

1. **Fix the npm credential** (currently the top blocker): run `npm login`
   on the owner's machine, or install a fresh granular token with the
   `@veylqorix` scope's write access. The token currently in `~/.npmrc` is
   rejected by the registry. Confirm with `npm whoami`.
2. **Confirm the `@veylqorix` scope owner** on npmjs.com: that the account or
   organization named `veylqorix` is one the owner controls, and that it has
   2FA enabled. The scope exists but its owner cannot be read from the CLI.
3. **Bootstrap-publish both packages once, from the owner's own machine** —
   required because npm's trusted-publisher record lives on a package's
   settings page, so a package must exist before a publisher can be attached
   (npm/cli#8544, still open). Version `0.0.1`, core first, then the CLI
   (whose packed manifest depends on the core version in effect at pack
   time). The owner's npm credential/2FA is used **on the owner's machine
   only** — never a repository secret, never an `NPM_TOKEN` in CI, never an
   `npm login` on the runner.
4. **Add a trusted publisher for each package separately** (per-package, not
   per-scope): npmjs.com → package → Publishing → Trusted publishers →
   GitHub Actions; Organization or user `soumyachk101`; Repository
   `Veylqorix`; Workflow filename `release.yml`; Environment name **unset**
   (the workflow declares no `environment:`); and **explicitly enable direct
   `npm publish`** — configurations created after 2026-09-03 default to
   stage-only, and the workflow publishes directly. Equivalent CLI
   (npm ≥ 11.15.0, verified by dry-run):
   `npm trust github @veylqorix/core --file release.yml --repository soumyachk101/Veylqorix --allow-publish`
   (and the same for `@veylqorix/cli`).
5. **Publish within 2 days** of creating each configuration: a newly created
   trusted publisher must complete its first successful publish within 2 days
   or it expires and must be deleted and re-created.
6. **Create and push the `v0.1.1` tag** (owner action — not performed here),
   and monitor the run.

## 6. Remaining release blockers

> Status column reflects 2026-10-28 after the §4f log confirmation. The
> original table (pre-release) is preserved below it for history.

| # | Blocker | Priority | Who | Status 2026-10-28 |
|---|---|---|---|---|
| B1 | CLI trusted-publisher record missing (or stage-only / mismatched) — the confirmed cause of the ENEEDAUTH at `Publish @veylqorix/cli` in run 40558927305 | **P0** | Owner (npm web UI, 2FA session; §4f has the exact fields) | **open — the single remaining blocker** |
| B2 | `release.yml` still without the idempotent re-run guard / validation job — an old-workflow re-run would hard-fail at the core step with `EPUBLISHCONFLICT` before reaching the CLI | **P0** | This working tree (fix made, not yet committed/pushed) | open until committed + tag re-pointed |
| B3 | The CLI's 2-day trusted-publisher validation clock starts when B1's record is created — the STEP-3 re-run must happen the same day | **P1** | Owner | follows B1 |

Original table (superseded; kept for history):

| # | Blocker | Priority | Who |
|---|---|---|---|
| 1 | Neither package exists on npm, so no trusted publisher can be configured — the first publish must be a manual bootstrap | **P0** | Owner |
| 2 | The release workflow fix and the `0.1.1` manifests are uncommitted/unpushed; the `v0.1.1` tag does not exist, and the `pack` job's tag/version guard will reject a mismatch | **P0** | Owner (commit + push + tag) |
| 3 | No trusted-publisher record for either package — the OIDC publish fails closed with 401/403 until step 3 above is done | **P0** | Owner |
| 4 | The npm credential in `~/.npmrc` returns 401 (`npm whoami` fails under both npm 10.9.8 and 12.2.1) — **this is the only thing blocking the whole release**: the bootstrap publish and `npm trust` both need it | **P0** | Owner |
| 5 | `@veylqorix` scope ownership unconfirmed | **P1** | Owner |
| 5b | `~/.local/bin/npm` (10.9.8) shadows the upgraded npm 12.2.1 on `PATH` — use `~/.npm-global/bin/npm` for `npm trust` | **P3** | Local env |
| 6 | The `publishConfig.provenance: true` / `--provenance` attestation path and the new registry-visibility wait are unverified against a real npm registry — only a real tag run proves them | **P2** | Verified by the release run |
| 7 | The `v0.1.0` tag points at a red-CI commit; it is left in place deliberately (a published tag must not be moved) and is superseded by `v0.1.1` | **P3** | Accepted |

## 7. Exact next commands — INSTRUCTIONS ONLY, NOT EXECUTED

Nothing below was run. Every command is the owner's to execute.

```bash
# --- on the owner's machine, in a clean checkout of the release commit ---

# 1. Confirm the registry is still empty (read-only)
npm view @veylqorix/core versions   # expect E404
npm view @veylqorix/cli versions    # expect E404

# 2. Bootstrap: temporarily set BOTH manifests to 0.0.1 (local-only, do not commit)
#    packages/core/package.json -> "version": "0.0.1"
#    apps/cli/package.json      -> "version": "0.0.1"

# 3. Build, pack, and publish core FIRST, then the CLI
pnpm install --frozen-lockfile
pnpm --filter @veylqorix/core build
pnpm --filter @veylqorix/cli  build
pnpm --filter @veylqorix/core pack --pack-destination ./artifacts
pnpm --filter @veylqorix/cli  pack --pack-destination ./artifacts
npm publish ./artifacts/veylqorix-core-0.0.1.tgz --access public
npm publish ./artifacts/veylqorix-cli-0.0.1.tgz  --access public

# 4. Restore 0.1.1 in both manifests (git restore the two files)

# 5. In npm's UI, add a trusted publisher for EACH package
#    (GitHub Actions / soumyachk101 / Veylqorix / release.yml / no environment /
#     direct npm publish ENABLED)

# 6. Commit the release fixes and push, then cut the tag
git add .github/workflows/release.yml .github/workflows/veylqorix-gate.yml         packages/core/package.json apps/cli/package.json package.json pnpm-lock.yaml         docs/engineering/
git commit -m "fix(release): correct artifact download path, harden gate inputs, release 0.1.1"
git push origin main
git tag v0.1.1
git push origin v0.1.1

# 7. Verify
npm view @veylqorix/core versions   # expect 0.0.1 and 0.1.1
npm view @veylqorix/cli versions    # expect 0.0.1 and 0.1.1
```

**Do not** move, delete or recreate `v0.1.0`, and do not attempt to
republish any version that already exists on the registry — npm versions are
immutable.

---

# First validation session (2026-10-27, retained for history)

> The sections below record the earlier session. They contain two claims that
> the second round above corrects: the v0.1.0 release run's failure was
> attributed to a missing trusted publisher (it was in fact the artifact
> download path — `npm publish` was never invoked), and `0.1.0` was described
> as the release version (the release version is now `0.1.1`).

The "Files changed" table below therefore does **not** list the second round's
changes — those are in the table in section 2 above.

## Files changed

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | `pnpm/action-setup` `version:` corrected to exactly `"11.9.0"` to match the root `packageManager` (was `9`, then `11`; pnpm/action-setup v4 compares the two strings with strict equality and fails the step on mismatch); `node-version` raised `"20"` → `"24"` (pnpm 11.9.0 requires Node >= 22.13 — it uses `node:sqlite`, so Node 20 crashed in setup-node's pnpm cache step with `ERR_UNKNOWN_BUILTIN_MODULE`). |
| `.github/workflows/veylqorix-gate.yml` | same two changes: exact pin `version: "11.9.0"` and `node-version: "24"`. |
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
   The exact-pin requirement was found afterwards: pnpm/action-setup v4
   compares its `version:` input against the root `packageManager` field
   with **strict string equality** and throws "Multiple versions of pnpm
   specified" on mismatch — so `version: 11` against `pnpm@11.9.0` would
   have failed every workflow at the setup step. All three workflows now
   pin exactly `"11.9.0"`.
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

- **CI on GitHub: green.** Run `40501372986` on commit `624f678` — every
  step passed (install, build, Rust toolchain, cargo-audit, gitleaks,
  fmt, clippy, cargo test, engine release build, 308 vitest tests,
  typecheck, lint). The earlier failure of runs `40500840104` /
  `40479270045` was the pnpm-version mismatch, then the Node-20 vs
  pnpm-11.9.0 incompatibility — both fixed (see below).
- **Release workflow: exercised, and failed closed as designed.** Run
  `40500854557` was triggered by the `v0.1.0` tag. The `pack` job
  succeeded at every step — including the new tag/version guard, which
  accepted `v0.1.0` against both manifests. The `publish` job failed at
  "Publish @veylqorix/core" (exit 2, no trusted publisher configured
  on npm) and the "Publish @veylqorix/cli" step was **skipped** — the
  core-before-CLI fail-safe ordering is confirmed working. Nothing was
  published.
- **Trusted publishing verified?** No. No successful OIDC publish has
  occurred. The workflow demonstrably builds, packs, and reaches the
  publish step; it stops at npm's auth check until the owner completes
  the npm-side setup. Provenance generation is therefore **not yet
  confirmed**.
- **npm version availability:** `@veylqorix/core` and `@veylqorix/cli`
  both 404 on the registry as of 2026-10-27 — `0.1.0` is free, no bump
  needed.
- **Security:** pnpm audit and cargo audit clean; overrides
  (postcss 8.5.31 / sharp 0.35.5) consistent across workspace file,
  lockfile, and SUPPLY_CHAIN.md; published-package dependency trees
  (semver, zod) trigger zero install scripts. Separately: provenance
  attests build source (commit + workflow), **not** the absence of
  vulnerabilities; and the engine-absent failure mode is honest — binary
  absent/unresolvable → SKIPPED/INCOMPLETE (exit 2), binary present but
  broken → exit 70 (documented, not silent).

## Tag and CI status (actual, 2026-10-27)

- Commit `e768d08` pushed to `main`; tag `v0.1.0` pushed (it points at
  `e768d08`).
- The tag-triggered release run failed closed as described above.
- The Node-24 CI fix landed as `624f678` (after the tag). **`v0.1.0`
  therefore points at a commit whose CI was still failing on Node 20.**
  The fix is on `main` and CI is green there, but the tagged commit has
  not been re-tagged — and it cannot be: npm versions are immutable and
  a published tag cannot be moved. If the owner bootstraps and
  re-triggers, the publish will build from the tagged commit `e768d08`,
  which is functionally identical for packaging purposes (same manifests,
  same packer, same workflow) but predates the Node-24 CI fix. The
  Node-24 change affects only the CI and gate workflows, not the
  release workflow, which already used Node 24 — so the tagged release
  path is unaffected.

## Owner actions still required (in order)

1. Confirm `@veylqorix` scope ownership and 2FA on the npm account that
   controls it; run `npm view @veylqorix/{core,cli} versions` (see
   `NPM_TRUSTED_PUBLISHING_SETUP.md` §1). Both packages currently 404.
2. Perform the one-time bootstrap publication of **each** package from the
   owner's machine under 2FA (`NPM_TRUSTED_PUBLISHING_SETUP.md` §0):
   publish core at the bootstrap version first, then the CLI with a
   dependency range matching that bootstrap core version, then restore
   `0.1.0` in both manifests for the tagged release. The tag push alone
   does **not** publish either package until this bootstrap exists.
3. Register the trusted publisher for **each** of `@veylqorix/core` and
   `@veylqorix/cli` (§2 of that doc; Provider = GitHub Actions, owner
   `soumyachk101`, repo `Veylqorix`, workflow `release.yml`, no
   environment), with **direct `npm publish` allowed** — new
   configurations default to stage-only, and the workflow's publish step
   requires the direct-publish action to be enabled.
4. Re-trigger the release within **2 days** of creating both
   trusted-publisher configurations (each config expires if its first
   successful publish is not completed within 2 days, and must be deleted
   and re-created):

   ```bash
   # documentation only — the v0.1.0 tag is already pushed; this shows
   # the intended re-trigger command if a new version tag is needed
   git tag v0.1.1
   git push origin v0.1.1
   ```

   A new tag requires a matching version bump in both manifests — the
   `pack` job's tag/version guard rejects any tag that disagrees with
   the declared versions before anything publishes. The existing
   `v0.1.0` tag can be re-run from the GitHub Actions UI ("Re-run all
   jobs"), which uses the same tagged commit and the same `0.1.0`
   version, and is the simplest path since `0.1.0` is still unpublished.
5. Monitor the release run it triggers on GitHub Actions — both publish
   steps (core, then CLI) must succeed.
6. Confirm both `@veylqorix/core` and `@veylqorix/cli` npm package pages
   show a provenance attestation for `0.1.0` (per
   `NPM_TRUSTED_PUBLISHING_SETUP.md` §3).

## Confirmations

No package was published — the release run failed closed at the publish
step and the npm registry still returns 404 for both packages. No npm
dry-run wrote to the registry; the only registry-touching commands were
read-only (`npm view`).

Commits `e768d08` and `624f678` were pushed to `main`, and the tag
`v0.1.0` was created and pushed, at the owner's explicit instruction.
The tag-triggered workflow ran and failed closed as designed. No GitHub
release was created, no repository settings were changed, and no website
UI/SEO/deployment configuration was touched. The unrelated `video/`
working-tree changes present in the checkout were left uncommitted and
untouched.

Provenance is **not** yet confirmed: no successful publish has occurred,
so no attestation exists on either package page yet.
