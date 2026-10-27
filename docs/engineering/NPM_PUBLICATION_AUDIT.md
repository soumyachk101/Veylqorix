# NPM Publication Audit — Phase 1 / Phase 2 Record

Phase 1 = getting the monorepo's CI green under the toolchain it was authored with.
Phase 2 = readiness of `.github/workflows/release.yml` for the first npm publish.
Owner: Ensembyte agent head (CI pnpm lockfile fix + this audit). Date: 2026-07-11.

## CI blocker (Phase 1)

`pnpm install --frozen-lockfile` failed with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`.
Diagnosis:

- `pnpm-lock.yaml` (line 1) is `lockfileVersion: '9.0'` and its `settings:` block
  records pnpm 10/11-era config read from `pnpm-workspace.yaml`:
  - `pnpm-workspace.yaml` lines 10–12: `allowBuilds: {esbuild: true, sharp: true}`
  - `pnpm-workspace.yaml` lines 17–19: `overrides: {postcss: 8.5.31, sharp: 0.35.5}`
- pnpm ≥ 11 reads `allowBuilds`/`overrides` from `pnpm-workspace.yaml`; pnpm 9 reads
  them from the `pnpm` field of `package.json` (absent here). So the pnpm 9 runner
  saw settings the lockfile does not carry for v9 → mismatch.
- `.github/workflows/ci.yml` and `.github/workflows/veylqorix-gate.yml` had pinned
  `pnpm/action-setup` (commit `a7487c7e89a18df4991f7f222e4898a00d66ddda`, v4.1.0)
  with `version: 9`; local install uses pnpm 11.9.0, which passes frozen install.

Fix applied this session (one line each): `version: 9` → `version: 11` in the
"Set up pnpm" step of `ci.yml` and `veylqorix-gate.yml`. Action pin, the
`cache: pnpm` setup-node step, and all other steps unchanged. Also added
`"packageManager": "pnpm@11.9.0"` to the root `package.json` so tooling that
honors `packageManager` (corepack, `pnpm setup`) resolves the same pnpm the
lockfile was authored under.

## Package manifest audit

### packages/core/package.json

| Field | Value | Location |
|---|---|---|
| name | `@veylqorix/core` | line 2 |
| version | `0.1.0` | line 3 |
| license | `MIT` | line 5 |
| type | `module` | line 6 |
| engines | `node >=20.18` | lines 7–9 |
| files | `["dist"]` | lines 10–12 |
| publishConfig | `{ access: "public" }` | lines 13–15 |
| main | `dist/index.js` | line 16 |
| types | `dist/index.d.ts` | line 17 |
| exports | `{ ".", "./scanners/*", "./gate", "./report" }` each `{types, import}` | lines 18–35 |

`./scanners/*` is a subpath export with a wildcard (lines 23–26) — valid under
Node's ESM/CJS resolver; requires the built `dist/scanners/` layout to be
preserved by the `tsc` build step before publish. Dependencies: `semver 7.7.3`,
`zod 4.6.7` (lines 40–43).

### apps/cli/package.json

| Field | Value | Location |
|---|---|---|
| name | `@veylqorix/cli` | line 2 |
| version | `0.1.0` | line 3 |
| license | `MIT` | line 5 |
| type | `module` | line 6 |
| engines | `node >=20.18` | lines 7–9 |
| files | `["dist"]` | lines 14–16 |
| publishConfig | `{ access: "public" }` | lines 17–19 |
| main | `dist/index.js` | line 10 |
| bin | `{ "veylqorix": "dist/index.js" }` | lines 11–13 |
| dependencies | `{ "@veylqorix/core": "workspace:*" }` | lines 24–26 |

**Flag — `workspace:*` protocol (RESOLVED this session).** The CLI's only
dependency is `@veylqorix/core: workspace:*` (line 25). `npm pack` does
**not** rewrite `workspace:` protocol specs: the tarball's `package.json`
would carry `"@veylqorix/core": "workspace:*"` verbatim, which is not
resolvable on the registry. `pnpm pack` **does** rewrite it to the concrete
version of the linked workspace package — verified locally this session:
`pnpm -C apps/cli pack` produced a tarball whose `package/package.json`
carries `"@veylqorix/core": "0.1.0"`.
`release.yml` therefore packs with `pnpm --filter <name> pack` (not `npm
pack`); publishing a `workspace:*`-carrying tarball with any packer would
make the CLI uninstallable for consumers. The core tarball is unaffected
(no workspace dependencies, lines 40–43).

## Release workflow readiness (Phase 2)

From `.github/workflows/release.yml` (reworked this session into two jobs):

- Trigger: `push: tags: ["v*"]` — no workflow_dispatch, no PR path; owner
  pushes a tag to publish.
- Job `pack`: `contents: read` only; SHA-pinned actions (checkout v4.2.2,
  pnpm/action-setup v4.1.0 with `version: 11`, setup-node v4.2.0 with
  `node-version: 24` and `cache: pnpm`); runs `pnpm install
  --frozen-lockfile`, targeted builds (`pnpm --filter @veylqorix/core build`
  then `--filter @veylqorix/cli build`, the web app is not rebuilt), packs
  with `pnpm --filter <name> pack --pack-destination ./artifacts` (the pnpm
  packer is required — see the `workspace:*` flag above), and uploads via
  SHA-pinned `actions/upload-artifact` v4.6.2.
- Job `publish`: `needs: pack`; `contents: read` + `id-token: write` (the
  only job requesting the OIDC write scope, because only it publishes);
  downloads the artifact via SHA-pinned `actions/download-artifact` v4.3.0
  and publishes core, then CLI, in two separate `npm publish <tgz>
  --provenance --access public` steps, each under `set -euo pipefail` so a
  failed core publish blocks the CLI step. No `NPM_TOKEN`/`npm login`;
  untrusted, the steps fail closed with 401/403.
- Order: core published before CLI, because the CLI's `@veylqorix/core`
  range must resolve on the registry before the CLI tarball is published.
- Node 24 / pnpm 11 (this session's fix, matching `packageManager:
  pnpm@11.9.0`): the pnpm 9 + Node 20 pin that previously sat here would
  fail the frozen-lockfile step with the same `ERR_PNPM_LOCKFILE_CONFIG_
  MISMATCH` class as Phase 1, and Node 24 ships an npm CLI new enough for
  provenance publishing. The published manifests' `engines` floor is
  `node >=20.18`, so building under 24 is compatible.

## Open items at audit time

- One-time npm-side trusted-publisher setup (per package, in npm's Publish
  settings) is documented in `docs/engineering/NPM_TRUSTED_PUBLISHING_SETUP.
  md` (this session replaces the stale "Owner setup" section previously in
  `RELEASE_READINESS.md`); until done, the publish steps fail closed by
  design.
- The `--provenance` flag is passed to `npm` (the Node 24 CLI), not `pnpm`;
  pnpm's local CLI help did not list it, so the flag's acceptance on the
  runner is unverified until the first tag run — a known, documented risk.
- Local verification runs (install/build/test/pack/dry-run) for this
  session are recorded in `docs/engineering/NPM_PUBLICATION_REPORT.md`.

## Out of scope for this session

No installs, builds, tests, or lint runs from this head; no changes to
`pnpm-lock.yaml` or `pnpm-workspace.yaml`. No package published, no GitHub
release created, no website changes.

Subsequent to this audit, the release changes were committed and pushed
(`e768d08`, then `624f678` for the Node-24 CI fix) and the tag `v0.1.0` was
created and pushed at the owner's instruction. The tag-triggered release run
failed closed at the npm publish step (no trusted publisher configured yet);
nothing was published. See `docs/engineering/NPM_PUBLICATION_REPORT.md` for
the verified run results.
