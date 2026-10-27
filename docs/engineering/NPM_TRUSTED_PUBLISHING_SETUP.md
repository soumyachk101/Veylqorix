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
OIDC token — no `NPM_TOKEN` secret, no `npm login` on the runner. npm accepts
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
  npm install -g npm@latest          # npm >= 11.5.1 (Node >= 22.14.0)
  pnpm install --frozen-lockfile
  pnpm --filter @veylqorix/core build
  pnpm --filter @veylqorix/cli build
  # temporarily set each package.json version to 0.0.1 locally
  # (do not commit the change; the repo keeps 0.1.0 for the tag)
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
  3. Restore `0.1.0` in both `packages/core/package.json` and
     `apps/cli/package.json` for the tagged release (the repo keeps
     `0.1.0`; the `0.0.1` change is local-only and must not be
     committed).

  Use a bootstrap version **below** the release version (`0.1.0` in the repo
  manifests) so the first tag-push publish does not hit
  `EPUBLISHCONFLICT`. Alternative that npm's docs also support:
  `npm stage publish` per package — staging does not require 2FA and,
  for a package that does not yet exist, creates a public
  `0.0.0-stage` placeholder; a maintainer then approves it with 2FA.
  Either way the package comes to exist and the
  trusted-publisher record becomes configurable.
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
5. Push the `v0.1.0` tag so `release.yml` publishes both via OIDC —
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
   "0.1.0" being available, run:

   ```bash
   npm view @veylqorix/core versions
   npm view @veylqorix/cli versions
   ```

   If either returns published versions, the release version numbers in the
   repo (`0.1.0` in both `packages/core/package.json` and
   `apps/cli/package.json`) must be above the highest published version, or
   publication will be rejected with `EPUBLISHCONFLICT`. Both packages
   currently 404 on the registry, so the section 0 bootstrap (`0.0.1` or
   the staging-placeholder `0.0.0-stage`) is the only version that will
   exist ahead of the first tag — both below `0.1.0`, so the conflict
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
  `publishConfig.provenance: false` — neither package sets that.
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
  `v0.1.0` tag ready to push immediately after creating both records.
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
