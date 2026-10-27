# CLI Release Readiness

Status of publishing `@veylqorix/cli` (with its workspace dependency
`@veylqorix/core`) to the npm registry. Last validated: 2026-07-08.

**Nothing has been published, no release has been created, and no tag or
commit has been pushed.** This document records what is validated locally and
what remains as owner actions.

## 1. Packaging correctness

Per-package status:

| Check | `@veylqorix/cli` | `@veylqorix/core` |
|---|---|---|
| name / version / license | `@veylqorix/cli` 0.1.0 MIT — OK | `@veylqorix/core` 0.1.0 MIT — OK |
| module format | `"type": "module"`, `main` + `bin` → `dist/index.js` (has `#!/usr/bin/env node`) — OK | `"type": "module"`, `main`/`types`/`exports` → `dist/` — OK |
| `files` field | `["dist"]` — only `dist/` ships. No secrets, no dev-only files, no test output | `["dist"]` — same |
| `engines` | `node >=20.18` (mirrors repo root) | `node >=20.18` |
| `publishConfig` | `{ "access": "public" }` — required for a scoped package | same |
| bin entry | `veylqorix` → `dist/index.js` (on the `files` allowlist) | n/a |

**Workspace dependency strategy (chosen: publish alongside, real semver).**
`@veylqorix/cli` depends on `@veylqorix/core` via `workspace:*`. The
`workspace:` protocol **cannot appear in a published `package.json`** — it
breaks external `npm install`. The chosen approach is to publish both packages
to the registry at the same semver, in one release, and let the packer rewrite
the dependency to the real version. What we did *not* do: bundle `core`
inside the CLI tarball (it would duplicate ~90 files, create a second copy of
the engine adapter, and hide `core`'s own dependency surface — `semver`,
`zod`). Bundling is the fallback only if the registry strategy becomes
unusable; it is not what ships today.

The `workspace:*` specifier stays in the in-repo `package.json` (pnpm
resolves it locally; npm ignores it only at install time of the *published*
tarball, whose `package.json` is the rewritten one). `release.yml` publishes
core first so the CLI's range resolves.

### Dry-run pack contents (`pnpm pack --dry-run`, validated 2026-07-08)

`@veylqorix/cli` tarball (post-`files: ["dist"]`):

```
dist/cli-args.d.ts   dist/cli-args.d.ts.map
dist/cli-args.js     dist/cli-args.js.map
dist/index.d.ts      dist/index.d.ts.map
dist/index.js        dist/index.js.map
LICENSE
package.json
```

(Pre-fix, the tarball also shipped `src/` and `tsconfig.json` — now excluded.)

`@veylqorix/core` tarball: `package.json` plus all of `dist/`
(`audit`, `detect`, `engine/`, `finding`, `gate/`, `index`, `policy*`,
`report/`, `scanners/`, `types`, `util/*` — `.js`/`.d.ts`/`.js.map`/`.d.ts.map`
per module). Pre-fix the tarball also shipped `src/` and `tsconfig.json` — now
excluded. Neither tarball contains lockfiles, test fixtures, `.env*`, or
build tooling. No changes to the Rust `crates/` tree are part of the
publication: the engine binary is a *prerequisite*, not a package artifact
(see §2).

**External-consumer resolution check (documented, not executed):**
after publishing, a clean `npm install @veylqorix/cli` fetches
`@veylqorix/core@<same version>` from the registry — no `workspace:` string
ever reaches a consumer's lockfile.

## 2. Rust engine honesty

**How the engine binary is discovered at runtime**
(`packages/core/src/engine/index.ts`, `resolveEngineBinary`):

1. `VEYLQORIX_ENGINE` environment variable, when set to an existing file
   (highest priority; checked per audit, not cached across env changes).
2. Upward walk from `process.cwd()` (bounded, 12 levels) looking for
   `crates/Cargo.toml`, then `crates/target/release/veylqorix-engine`, then
   `crates/target/debug/veylqorix-engine`.
3. The same walk from the *package install location*
   (`dist/engine/`'s parent directories), so a locally checked-out monorepo
   works even when `cwd` is elsewhere.

**The published package makes no developer-local assumption — but it also
has no binary. This is honest by design:** there is no PATH lookup and no
download-with-verification mechanism. A consumer who installs
`@veylqorix/cli` from the registry and has not set `VEYLQORIX_ENGINE` gets
no engine; the walk in step 2/3 finds nothing because `crates/` ships in no
tarball. Documented prerequisite for *authoritative* engine coverage:

- build or obtain the binary — `cargo build --release
  --manifest-path crates/Cargo.toml -p veylqorix-engine` produces
  `crates/target/release/veylqorix-engine` (target dir matches the binary's
  name `veylqorix-engine`, version 0.1.0);
- point the runtime at it: `VEYLQORIX_ENGINE=/abs/path/veylqorix-engine
  veylqorix scan` (or install it on `PATH` and set `VEYLQORIX_ENGINE` to the
  resolved absolute path, e.g. `VEYLQORIX_ENGINE="$(command -v
  veylqorix-engine)"`).

**Reduced coverage when the engine is absent, explicitly marked.** When no
binary resolves, `runAudit` degrades to the byte-compatible TypeScript secret
scanner + policy engine and appends this note to the secrets scanner result
(surfaced in every report surface — JSON `scanners[].notes`, the Markdown
scanner table, SARIF — and visible in the human summary as an
"Incomplete coverage" line when the gate records incomplete reasons):

> `Rust engine unavailable: TypeScript policy engine evaluated the gate
> (degraded compatibility mode).`

The gate's `incompleteReasons`/`coverage` fields report any resulting gap;
exit code `2` (INCOMPLETE) is used whenever a mandatory scanner or check did
not complete, so a degraded run is never mistaken for a clean pass. This is
documented in `docs/cli.md` (Engine binary section) and `docs/engine.md`.

What is *not* claimed: that the TS fallback is byte-identical to the engine
in all cases. `docs/engine.md` states parity was verified by the golden /
secret-parity test suites; the degradation note is the runtime marker.

## 3. Docs

`docs/cli.md` now covers install/upgrade, the `VEYLQORIX_ENGINE`
prerequisite and the labeled degraded mode, cross-platform notes, and an
exit-code table with examples matching `apps/cli/src/index.ts`
(0/1/2 from `result.exitCode`; 64 usage/invalid policy/hook errors; 65
missing root or policy file, empty `--staged`; 70 unexpected errors).

## 4. Release workflow

`.github/workflows/release.yml` (new) — **opt-in and inert until owner setup**:

- Trigger: `on: push: tags: ["v*"]` only.
- Trusted publishing: no `NPM_TOKEN` secret; `npm publish --provenance`
  authenticates with the GitHub OIDC token, which npm accepts *only* for
  packages whose trusted-publisher record points at this workflow + tag
  subject. Until that record exists, the publish step fails — nothing is
  published untrusted, ever.
- No `write: contents`/`packages` permissions; no commit/branch/tag push;
  actions pinned to commit SHAs (matching `ci.yml`).
- Publishes `@veylqorix/core` before `@veylqorix/cli` so the dependency
  range resolves.

### Owner setup for trusted publishing (one-time, repo owner only)

1. Create a GitHub App named e.g. `veylqorix-release` (no permissions
   required; enable *Node* hosting and *Client ID auto-rotation* — the
   latter is what makes `--provenance` work).
2. On npmjs.com → `@veylqorix/cli` (and `@veylqorix/core` if published
   under the same scope — the owner must own the `@veylqorix` scope):
   *Publishing → Trusted Publishers → Add Trusted Publisher →
   Trusted Publisher using OpenID Connect → GitHub App* and select the app.
   Restrict to the `push` event with tag subject `refs/tags/*` and the
   workflow file `release.yml` when the picker offers it.
3. Create at least one bot user (npm *Publishing → Bot users*) and grant it
   publish rights on the `@veylqorix` scope; OIDC tokens publish *as* the
   bot user.
4. Verify: tag a release and confirm the workflow's publish step succeeds
   (or, for a dry check, that it fails closed with a provenance/trust error
   before setup is complete).

## 5. Changelog

`CHANGELOG.md` — "Release readiness" entry under `Unreleased`: records what
is validated here vs. the owner actions above.

## 6. Clean-consumer validation (documented; run it after the first publish)

```bash
# 1. Produce real tarballs exactly as release.yml does (dry-run only here).
cd packages/core && pnpm build && npm pack --pack-destination /tmp/vqx-artifacts
cd ../../apps/cli  && pnpm build && npm pack --pack-destination /tmp/vqx-artifacts

# 2. Install from the tarballs in a clean directory (no workspace, no node_modules above).
mkdir /tmp/vqx-consumer && cd /tmp/vqx-consumer
npm init -y >/dev/null
# Simulate registry consumption of the CLI tarball; its dependency on
# @veylqorix/core must be satisfied from the local core tarball:
npm install /tmp/vqx-artifacts/veylqorix-cli-0.1.0.tgz /tmp/vqx-artifacts/veylqorix-core-0.1.0.tgz

# 3. Help text — expected: usage block, exit 0.
./node_modules/.bin/veylqorix --help

# 4. Scan a trivial project with the engine INTENTIONALLY absent:
mkdir -p sample && cd sample && echo '{"name":"sample","version":"0.0.1"}' > package.json
VEYLQORIX_ENGINE=/nonexistent ../node_modules/.bin/veylqorix scan --root . --offline
# Expected on stdout (summary form), exit code 2 — a degraded run is never green:
#   ⚠️ Gate result: INCOMPLETE  (coverage LIMITED, exit code 2)
#   Scanners:
#     ⏭️ dependencies       SKIPPED  0 finding(s)
#     ✅ secrets            PASS     0 finding(s)
#   Incomplete coverage:
#   - Scanner 'dependencies' was skipped: Running in offline mode; npm audit
#     requires network access and was skipped.
# Engine-absence marker (the explicit reduced-coverage statement) in machine
# readable output:
VEYLQORIX_ENGINE=/nonexistent ../node_modules/.bin/veylqorix scan --root . --offline --json
# → "gate": {"result":"INCOMPLETE", "coverage":"LIMITED", ...}, exit code 2,
#   and the "secrets" entry of "scanners" carries "notes" containing
#   "Rust engine unavailable: TypeScript policy engine evaluated the gate
#    (degraded compatibility mode)." — the run is labeled, never silent.
# (Online mode, no lockfile, same expected result: the dependencies scanner
# errors instead of skipping, the gate is INCOMPLETE, exit code 2.)
```

Notes: steps 1–3 are safe to run today (no publish involved); step 4's
*registry-install* variant (`npm install @veylqorix/cli@0.1.0` into a clean
dir) is only meaningful after the owner completes §4 and the first
`v0.1.0` tag is pushed. No publish/release/push has been performed by this
work; that is owner action on top of §4.

## Open / owner-only

- [ ] npm `@veylqorix` scope ownership + GitHub App + trusted-publisher registration (§4).
- [ ] First `v0.1.0` tag to activate the release workflow.
- [ ] Engine binary distribution (a verified `veylqorix-engine` artifact or a documented build step) — today the prerequisite is "build from source + `VEYLQORIX_ENGINE`"; a signed/platform-artifact story would be a follow-up design decision.
- [ ] `pnpm-workspace.yaml` `allowBuilds` still carries the placeholder values `set this to true or false` (esbuild/sharp) — outside this task's file list; flag to the owner.
