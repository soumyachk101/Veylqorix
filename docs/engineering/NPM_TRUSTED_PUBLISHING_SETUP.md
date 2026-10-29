# NPM Trusted Publishing Setup

One-time npm-side setup for trusted publishing of `@veylqorix/core` and
`@veylqorix/cli`.

Trusted publishing is configured **on the npm side, per package**: the npm
registry holds a "trusted publisher" record for each package that points at a
GitHub Actions workflow. Until the owner adds that record for *both*
packages, nothing works — `.github/workflows/release.yml` builds and packs
but its publish step fails closed with 401/403, and nothing is ever
published.

The workflow the records point at is `.github/workflows/release.yml`,
triggered only by tag pushes to this repo (`v*`), with **no environment
configured**, and two jobs: a `pack` job (installs with pnpm 11.9.0, builds,
packs both packages) and a `publish` job that requests `id-token: write` and
publishes both tarballs with `npm publish <tgz> --provenance` using GitHub's
OIDC token — no `NPM_TOKEN` secret, no `npm login` on the runner. The publish
job downloads the packed tarballs into `packaged-tarballs/` (the download
step sets `path:` to that directory so the publish steps' globs resolve) and
waits until the freshly published `@veylqorix/core` version is visible on the
registry before publishing the CLI. npm accepts
that token only for a package whose trusted-publisher record matches this
exact workflow and the tag subject. The repo-side workflow, the pnpm pin
(`11.9.0` in all three workflows, matching the root `packageManager` field
exactly), and the manifest/pack validation are all in place; the only
missing piece is the npm-side configuration described here.

## 0. First publication: what to do before the first tag

A trusted-publisher record can only be created **after** a package
exists on the registry, so each brand-new package needs one deliberate
one-time bootstrap publish on the owner's own machine before the
workflow's OIDC publish can ever run:

- The npmjs.com trusted-publisher UI lives under the *package's*
  settings page, which does not exist until the package does. The
  `npm trust` CLI's prerequisites state it plainly: "The package
  you're configuring must already exist on the npm registry".
- The current npm docs do **not** offer any pre-creation path, and
  the npm team confirms the limitation: publishing the *first*
  version of a package via OIDC is not yet supported (open issue
  `npm/cli#8544`, still open as of the 2026-10-27 check). No rule
  change removes it for user-owned scopes, organization-owned
  scopes with published packages, or organization-owned scopes
  that have never published — in all three cases the scope's owner
  (or a member with write access to the scope) must create the
  package once, by hand, with traditional authentication:

  ```bash
  # on the owner's machine, with the owner's npm account and 2FA:
  npm install -g npm@latest          # npm >= 11.15.0 (Node >= 22.14.0)
  pnpm install --frozen-lockfile
  pnpm --filter @veylqorix/core build
  pnpm --filter @veylqorix/cli build
  # temporarily set each package.json version to 0.0.1 locally
  # (do not commit the change; the repo keeps 0.1.1 for the tag)
  pnpm --filter @veylqorix/core pack --pack-destination ./artifacts
  pnpm --filter @veylqorix/cli  pack --pack-destination ./artifacts
  npm publish ./artifacts/veylqorix-core-0.0.1.tgz --access public
  npm publish ./artifacts/veylqorix-cli-0.0.1.tgz --access public
  ```

  The CLI's published manifest resolves its `@veylqorix/core`
  dependency to a **concrete** version (`pnpm pack` rewrites the local
  `workspace:*` to the version that is in effect at pack time), so the
  bootstrap publish of the CLI must point at a core version that
  **actually exists on the registry**. The order is therefore fixed:

  1. Publish `@veylqorix/core` at the bootstrap version (`0.0.1`)
     first.
  2. Then publish `@veylqorix/cli` with a dependency range that matches
     that bootstrap core version. Because both manifests were set to
     `0.0.1` locally, the CLI tarball's `@veylqorix/core` field
     resolves to `0.0.1` — the version that now exists — so the CLI's
     install will resolve. Publishing the CLI first would leave its
     dependency pointing at a core version the registry has not seen.
  3. Restore the release version (`0.1.1`) in both
     `packages/core/package.json` and `apps/cli/package.json` for the
     tagged release (the `0.0.1` change is local-only and must not be
     committed).

  Use a bootstrap version **below** the release version (`0.1.1` in the repo
  manifests) so the first tag-push publish does not hit
  `EPUBLISHCONFLICT`. Alternative that npm's docs also support:
  `npm stage publish` per package — staging does not require 2FA and,
  for a package that does not yet exist, creates a public
  `0.0.0-stage` placeholder; a maintainer then approves it with 2FA.
  Either way the package comes to exist and the
  trusted-publisher record becomes configurable.
- **Staged variant actually used (2026-10-27):** `npm stage publish`
  creates a public `0.0.0-stage` placeholder for a not-yet-existing
  package and does **not** require 2FA to *stage* (approval does). Both
  packages were staged at `0.0.1` this way, so they now exist on the
  registry and a trusted publisher can be attached. The `0.0.1` staged
  versions are inert until the owner approves or rejects them in the npm
  UI (or `npm stage approve`/`reject` with a 2FA-enabled credential).
  Two notes from executing this:
  1. **`publishConfig.provenance` must not be set for an owner-machine
     publish** — it makes npm attempt provenance generation, which fails
     outside CI with `EUSAGE "Automatic provenance generation not
     supported for provider: null"`. Strip it from the local dip;
     `HEAD` keeps `provenance: true` for the CI/OIDC path, where it is
     correct.
  2. **The `npm trust` CLI rejects bypass-2FA granular tokens** (npm's
     documented restriction), so with such a token the web UI is the
     only way to create the trusted-publisher records.
- This bootstrap is a **one-time exception and stays on the owner's
  machine**: the owner's own credentials plus 2FA (or a granular
  access token with bypass-2FA — which the `npm trust` command
  itself will *not* accept, but a publish will). It is deliberately
  never a repository secret, never an `NPM_TOKEN` in CI, and never
  an `npm login` on the runner.

Scope-ownership fact to check first: the `@veylqorix` scope
**already exists on the registry** — as of the 2026-10-27 check the
registry's `/-/org/veylqorix/package` endpoint answers 200 with an
empty package list while any unknown name answers 404 "Scope not
found", and both packages 404. Per npm's scoping rules, a scope is
granted only to a user account or organization *named* `veylqorix`
(user or organization name = scope name). The owner must confirm on
npmjs.com that that account/org is one they control, because only
an account with write access to the scope can do the bootstrap
publish and later configure its trusted publishers.

Ordered npm-side actions (the whole of what's left to do):

1. Confirm who owns the `@veylqorix` scope on npm and that it is the
   owner's account; enable 2FA on that account if not already.
2. Run the one-time bootstrap publish of **both** packages
   (section 0 above, `0.0.1` or the staging-placeholder variant).
3. Add the trusted-publisher record for `@veylqorix/core`
   (section 2 fields, **including the "allow npm publish" action**).
4. Add the trusted-publisher record for `@veylqorix/cli` (same).
5. Push the `v0.1.1` tag so `release.yml` publishes both via OIDC —
   this is the first successful publish that *validates* both
   configurations; both must complete it **within 2 days** of being
   created (section 2), or each configuration expires and must be
   deleted and re-created.

Sources checked 2026-10-27:
<https://docs.npmjs.com/trusted-publishers/>,
<https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/>,
<https://docs.npmjs.com/staged-publishing/>,
<https://docs.npmjs.com/about-scopes/>,
<https://docs.npmjs.com/cli/v12/commands/npm-trust>,
<https://github.com/npm/cli/issues/8544>.

## 1. Prerequisites the owner must verify on the npm side

Before configuring anything, confirm on npm:

1. **Who owns the `@veylqorix` scope.** The npm account that owns/controls
   the `@veylqorix` scope must be the account *you* control. Per npm's
   scoping rules, a scope name is only claimable by a user account or an
   organization **named exactly `veylqorix`** — the scope name must match
   the account name. The `@veylqorix` scope is already claimed on the
   registry (probe 2026-10-27: `/-/org/veylqorix/package` answers 200 with
   an empty package list, and both packages 404), so the owner must confirm
   on npmjs.com *which* account or organization holds it:
   - If it's a personal npm account named `veylqorix`, the scope is
     user-owned — that's fine, that account is the owner.
   - If an npm **organization** named `veylqorix` exists, the scope is
     organization-owned and publishing requires the org to authorize it
     (a team member with write access, or the owner).
   The trusted-publisher record is created on a package, but first-time
   publication of a **new** package under `@veylqorix` can only be performed
   by an account with write access to the scope (see section 0).
2. **Whether the packages already exist.** A published npm version is
   immutable — it cannot be overwritten or re-tagged. Before relying on
   "0.1.1" being available, run:

   ```bash
   npm view @veylqorix/core versions
   npm view @veylqorix/cli versions
   ```

   If either returns published versions, the release version numbers in the
   repo (`0.1.1` in both `packages/core/package.json` and
   `apps/cli/package.json`) must be above the highest published version, or
   publication will be rejected with `EPUBLISHCONFLICT`. Both packages
   currently 404 on the registry, so the section 0 bootstrap (`0.0.1` or
   the staging-placeholder `0.0.0-stage`) is the only version that will
   exist ahead of the first tag — both below `0.1.1`, so the conflict
   check passes by construction.

## 2. Per-package trusted publisher configuration

The two packages must be configured **separately** — npm trusted-publishers
records are per-package. Repeat the step below for **both**
`@veylqorix/core` and `@veylqorix/cli`; configuring one does not authorize
the other.

For each of `@veylqorix/core` and `@veylqorix/cli`, on the package's npm
**Publishing → Trusted publishers** settings page, add a trusted publisher
with exactly these fields:

| Field | Value |
|---|---|
| Provider | **GitHub Actions** |
| GitHub owner (organization or user) | `soumyachk101` |
| Repository | `Veylqorix` |
| Workflow filename | `release.yml` |
| Environment name | **leave unset** — the field is optional in npm's docs ("Environment name (optional): If using GitHub environments for deployment protection") and the workflow declares no `environment:`, so no environment must be configured. Leaving it blank is correct, not a gap. |
| Allowed actions | **explicitly allow direct publishing with `npm publish`.** New trusted-publisher configurations default to *stage-only* (they auto-allow `npm stage publish` and require you to also tick direct `npm publish`). `release.yml` runs `npm publish`, so without that tick the publish step is rejected. Confirm the direct-publish action is enabled, not left at the stage-only default. |

Source of truth: <https://docs.npmjs.com/trusted-publishers/>.

### Equivalent CLI command (npm ≥ 11.15.0)

The npm CLI can create the same records instead of using the web UI. Verified
on npm 12.2.1 with `--dry-run` on 2026-10-27 — it produced exactly the
configuration described above:

```bash
npm trust github @veylqorix/core \
  --file release.yml \
  --repository soumyachk101/Veylqorix \
  --allow-publish

npm trust github @veylqorix/cli \
  --file release.yml \
  --repository soumyachk101/Veylqorix \
  --allow-publish
```

- `--file` takes the **workflow filename only** (no path), matching the UI's
  "Workflow filename" field.
- `--repository` takes `owner/repo` — here `soumyachk101/Veylqorix`.
- `--allow-publish` is the equivalent of ticking **"publish directly with
  `npm publish`"**. Without it the record is stage-only and `release.yml`'s
  publish steps are rejected.
- `--allow-stage-publish` is **not** passed: `release.yml` publishes
  directly, and the CLI always allows `npm stage publish` for new records.
- Omit `--environment` — the workflow declares no `environment:`.
- `--dry-run` prints the configuration without changing anything; useful for
  confirming the shape before committing.
- `npm trust list <package>` shows the existing records for a package.

**Caveat:** npm's docs state that the `npm trust` CLI rejects tokens that
bypass 2FA, so the CLI path needs a credential with 2FA satisfied. If the CLI
refuses, use the web UI — it accepts the same fields.

Checked against the live npm docs (2026-10-27):

- **Minimum versions.** Trusted publishing requires **npm CLI ≥ 11.5.1**
  and **Node ≥ 22.14.0**. `release.yml` runs Node 24; the npm bundled
  with Node 24 is well past 11.5.1 (Node v24.22.1 ships npm 11.19.1),
  so the workflow satisfies both minimums as written.
- **Provenance is automatic.** npm generates and publishes provenance
  attestations by default for trusted publishing from GitHub Actions,
  provided the publish is via OIDC, from a **public** repository, and
  of a **public** package. `--provenance` is therefore *not required*;
  the workflow's explicit `npm publish <tgz> --provenance` is still
  valid and is harmless, since it requests the same attestation npm
  would generate anyway. It is **not** disabled by
  `publishConfig.provenance: false` — both packages set
  `publishConfig.provenance: true`, which requests the same attestation.
- **Allowed actions.** Per npm's docs, configurations created after
  2026-09-03 are automatically allowed to `npm stage publish`, and
  direct `npm publish` is an additional explicit choice. Because
  `release.yml` publishes directly, both records must have direct
  publishing enabled.
- **Two-day expiry.** Still current: "A newly created trusted publisher
  configuration must complete its first successful publish within 2
  days." The first successful publish validates the configuration and
  binds it to the repository's immutable identity; if it is not
  validated within 2 days it **expires and can no longer be used or
  edited** — delete it, create a new one, and complete the first
  publish within 2 days. The owner should therefore have the
  `v0.1.1` tag ready to push immediately after creating both records.
- **Limits.** Each package accepts up to **10 trusted publishers** at
  once. Existing trusted-publisher connections **cannot be edited** —
  the provider and required fields are fixed once created; to change
  one, delete it and create a new one.

## 3. Verification

After both packages are configured:

- The next valid tag-push run of `release.yml` must show **both** publish
  steps succeeding.
- Each package's npm page must show a **provenance attestation** (the
  "Provenance" link on the version listing), tying the tarball to this repo,
  commit, and workflow run.

Until that run happens, **do not claim trusted publishing works** — it has
only been *configured*, not yet *exercised*. The successful publish is also
what validates each trusted-publisher configuration and clears its 2-day
expiry window.

Expected failure mode *before* configuration: the publish step fails with
`401`/`403` (npm rejects the OIDC token because no trusted-publisher record
exists for that package + workflow), and **nothing is published**. The
workflow is designed to fail closed this way — an unconfigured package is
never published untrusted.

## 4. Non-goals (deliberately out of scope)

- **No token-based fallback in CI.** No `NPM_TOKEN` repository secret, no
  `npm login` on the runner. Only the OIDC provenance path exists; a failed
  publish is a failed publish, not a silent token fallback. (The one-time
  manual bootstrap publish in section 0 is a documented exception performed
  by the owner on their own machine — it is not a CI fallback path, and
  nothing about it persists into the repository.)
- **No automatic version bumps.** The workflow publishes whatever version is
  in the package manifests at the tagged commit; it does not compute or
  modify versions.
- **No publishing from forks.** `release.yml` is triggered by tag pushes to
  this repository only (`on: push: tags: ["v*"]` on the repo's own tags).
  Tag pushes in pull requests from forks do not trigger it, and forks
  cannot create the tag in this repo that would be needed.
- **No staged publishing.** `release.yml` publishes directly with
  `npm publish`, and both trusted-publisher records must allow direct
  publishing. npm's staged-publishing flow (maintainer approves each
  version with 2FA) is a separate, stricter mode; it is not used here.
  It is mentioned in section 0 only as an alternative way to create the
  first placeholder version of a not-yet-existing package.

## 5. Scope, name, and access level

Facts npm's current docs state, checked 2026-10-27:

- **The package name must match the scope it publishes under.** Both
  manifests already carry `"name": "@veylqorix/core"` and
  `"name": "@veylqorix/cli"`, matching the `@veylqorix` scope. npm's
  rule is that the scope name is everything between `@` and `/`, and the
  scope must be one the publishing account owns or controls
  (<https://docs.npmjs.com/about-scopes/>). Nothing further is required
  for the name itself.
- **`publishConfig.access: "public"` is set on both packages**
  (`packages/core/package.json` and `apps/cli/package.json`), which is
  what npm requires to make a scoped package public.
- **Scoped packages are private/restricted by default**, so the first
  publish of a scoped package must specify public access: npm's docs say
  "By default, scoped packages are published with private visibility. To
  publish a scoped package with public visibility, use `npm publish
  --access public`", and `npm access` docs add that unscoped packages
  are always public while scoped ones default to restricted and can be
  flipped afterwards with `npm access set status=public`. The bootstrap
  publish in section 0 therefore passes `--access public`; the workflow
  does too, on both packages, which is correct and matches the
  `publishConfig` setting (belt and braces, both agree).
- **Publishing a scoped package publicly does not require a paid plan**
  as long as `--access public` is used; without it, an unpaid account
  gets `HTTP 402` on publishing scoped packages. Both paths here pass
  `--access public`, so this does not apply.
- **Package names must be unique and lowercase**, which
  `@veylqorix/core` and `@veylqorix/cli` are
  (<https://docs.npmjs.com/package-name-guidelines/>).
- **Watch for `repository.url`.** The trusted-publishing troubleshooting
  section states: "To publish from GitHub, your package's
  `repository.url` field in package.json must exactly match your GitHub
  repository." Both `packages/core/package.json` and
  `apps/cli/package.json` now set
  `"repository": { "type": "git", "url": "git+https://github.com/soumyachk101/Veylqorix.git" }`
  (plus a matching `homepage`), which is the form npm's docs prescribe,
  so this item is satisfied. If the first tag-push publish still fails
  with `ENEEDAUTH`/"package not found", the docs word this as a cause of
  misconfigured-package failures rather than a hard precondition, so
  whether its exact form matters here is not stated clearly — adjust the
  URL form and re-run (the bootstrap publish or the tag) — this is a
  one-line change per manifest and no npm-side step.

## 6. Execute the v0.1.1 release (owner, ~2 min, one clean action)

Dated 2026-10-27, updated 2026-10-28. The repo side is done: `main` is at
`dd2054f` ("fix(release): publish via ./-prefixed tarball paths"), the `v0.1.1`
tag points at `dd2054f`, and `v0.1.0` still points at `e768d08` (do not touch
it).

**Where the run actually stands now (run 40558927305, confirmed from its logs
2026-10-28):** `@veylqorix/core@0.1.1` was **published successfully** —
signed provenance attestation, confirmed on the registry. The run then failed
only at `Publish @veylqorix/cli` with `ENEEDAUTH`. That is the symptom of a
missing (or misconfigured / stage-only) **CLI** trusted-publisher record: the
same OIDC token, repository, and `release.yml` file published core fine, so
the repository side and the **core record are both proven correct**. The one
gap is the npm-side record for `@veylqorix/cli`. So this section's work is
now **CLI-only**: create (or fix) the CLI record with exactly the field set
that just worked for core, then re-run. Do **not** re-create the core record
and do **not** republish core.

**STEP 1 — create (or fix) the CLI trusted-publisher record (required, web UI, 2FA session)**

The bypass-2FA token cannot do this; use the owner's 2FA-enabled npm web
session. Open:

- `@veylqorix/cli`: <https://www.npmjs.com/package/@veylqorix/cli> →
  **Publishing → Trusted publishers → Add trusted publisher**

Fields — identical to the `@veylqorix/core` record that just published
`0.1.1` successfully, so you can copy core's existing record and paste it here
if core's is on screen:

| Field | Value |
|---|---|
| Provider | **GitHub Actions** |
| GitHub owner/user | `soumyachk101` |
| Repository | `Veylqorix` |
| Workflow filename | `release.yml` |
| Environment | **leave blank** (the workflow declares no `environment:`) |
| Allowed actions | enable the **direct `npm publish`** action — post-2026-09-03 configs default to stage-only, and `release.yml` runs `npm publish`, so stage-only is rejected with exactly the `ENEEDAUTH` seen in run 40558927305 |

Before adding, check whether a CLI record already exists and is just
misconfigured (owner/repo/workflow mismatch, or left stage-only):
`npm trust list @veylqorix/cli --json` (read-only, no secrets). If it lists a
record, delete it and recreate it with the fields above — trusted-publisher
records are not editable in place. If it lists none, that is the gap; just add
the one above.

Equivalently via the npm CLI (only if a 2FA-capable credential is available;
the configured bypass-2FA token is rejected with `EOTP`):

```bash
npm trust github @veylqorix/cli \
  --file release.yml \
  --repository soumyachk101/Veylqorix \
  --allow-publish
```

**STEP 2 — optional cleanup of the two staged 0.0.1 versions (your call)**

In the npm UI **Staged Packages** tab, either Reject or Approve the two
staged `0.0.1` versions:

- Reject: keeps the registry minimal; `0.1.1` is the real release.
- Approve: makes `0.0.1` a public version.

Either is safe; neither affects the `0.1.1` release. The CLI
equivalents (also 2FA-gated, so the web UI is the practical path):

```bash
npm stage reject 94a22c65-2e6e-4c21-8ebc-1f39588b5be6   # @veylqorix/core stage
npm stage approve df5d9357-7f6d-4916-8ce6-9aa3fcf6a684   # @veylqorix/cli stage
```

**STEP 3 — trigger the release (same day as STEP 1)**

Two things must be true before the re-trigger:

1. The CLI trusted-publisher record from STEP 1 exists.
2. The tag points at a commit that carries the **fixed** `release.yml`
   (the version with the registry-presence pre-checks and the `test`
   validation job — the one in the working tree of this repo as of the
   2026-10-28 release-workflow fix). This matters: `gh run rerun`
   re-executes the workflow file *from the run's commit*. Run
   40558927305 ran on `dd2054f`, whose workflow is the old one — it has
   no `test` job and its core publish step would now hard-fail with
   `EPUBLISHCONFLICT` (core is permanently published), never reaching
   the CLI step. So the re-trigger must run the new workflow:

   ```bash
   # commit the .github/workflows/release.yml fix to main and push it,
   # then re-point the tag at that commit (the tag/version guard passes:
   # the manifests still declare 0.1.1) and push the updated tag.
   git add .github/workflows/release.yml
   git commit -m "fix(release): gate publish on a validation job, make re-runs idempotent"
   git push origin main
   git tag -f v0.1.1
   git push -f origin v0.1.1   # triggers a fresh release run on the new commit
   ```

   If the fixed workflow is already what the tag points at (check with
   `gh run list --workflow release.yml` and read the head commit), the
   plain re-run of the newest run works instead — no tag move needed:

   ```bash
   gh run rerun 40558927305
   ```

   (or the "Re-run all jobs" button on the GitHub Actions run page,
   <https://github.com/soumyachk101/Veylqorix/actions/runs/40558927305>).

   Either way the tag must still match the manifests' `0.1.1` (the `pack`
   job's tag/version guard enforces this before anything publishes).

**STEP 4 — verify**

Core is already verified (published with a signed provenance
attestation in run 40558927305); this step confirms the CLI publish the
new run completes:

```bash
npm view @veylqorix/cli versions --json    # must now include 0.1.1
npm view @veylqorix/cli@0.1.1 dependencies --json   # must show @veylqorix/core at 0.1.1
```

Both package pages should show a **Provenance** attestation for `0.1.1`.
(The `0.0.0-stage` entries do NOT have attestations — expected; the
`0.0.1` staged versions still need STEP 2's owner decision if any.)

**CRITICAL TIMING:** the CLI trusted-publisher config (the one created in
STEP 1) must complete its first successful publish **within 2 days of
creation** or it expires and must be deleted and re-created. So create
the record in STEP 1 and run STEP 3 the same day. (The core record
validated its first publish at run 40558927305, so its window has
closed on its own.)

**SAFETY:** re-running the `v0.1.1` release with the **fixed** workflow
is idempotent: each publish step first checks the registry and skips an
already-published version with a notice. Core `0.1.1` is already on the
registry, so a re-run skips that step and publishes only the CLI; a
second re-run skips both. Do **not** run the *old* (pre-fix) workflow
again after core is published — its non-idempotent core step dies with
`EPUBLISHCONFLICT` before reaching the CLI.
