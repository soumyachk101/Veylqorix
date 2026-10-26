# Veylqorix — Supply-Chain & Dependency Assessment

Phase 8 assessment. Scope: root `package.json`, `pnpm-workspace.yaml`,
`crates/` (Cargo manifests + lock), `.env.example`, GitHub Actions pinning
inventory. No dependency upgrades were made (see §2: every audit finding is
downstream of `next@15.5.28` or dev-only; fixing them requires version bumps
the lead must schedule deliberately).

## 1. Audit results

### 1.1 pnpm audit — RAN (pnpm 11.9.0, lockfile v9.0)

8 vulnerabilities in `apps/web`'s dependency tree: **3 moderate, 5 high**.

| Severity | Package (locked) | Advisory | Patched in | Path |
|---|---|---|---|---|
| moderate | postcss 8.4.31 | XSS via unescaped `</style>` in CSS stringify output | >=8.5.10 | `apps__web>next>postcss` |
| high | postcss 8.4.31 | Arbitrary file read via attacker-controlled `sourceMappingURL` | >=8.5.12 | `apps__web>next>postcss` |
| moderate | postcss 8.4.31 | Incomplete fix of the above (`from` unset) | >=8.5.23 | `apps__web>next>postcss` |
| high | postcss 8.4.31 | Path traversal in previous source-map auto-loading | >=8.5.18 | `apps__web>next>postcss` |
| high | sharp 0.34.5 | libvips: CVE-2026-33327 / 33328 / 35590 / 35591 | >=0.35.0 | `apps__web>next>sharp` |
| high | sharp 0.34.5 | libheif: GHSA-g89c-p67h-r497, GHSA-2jg2-4ch7-h545 | >=0.35.4 | `apps__web>next>sharp` |
| high | sharp 0.34.5 | librsvg: CVE-2026-96889 | >=0.35.5 | `apps__web>next>sharp` |
| moderate | postcss-selector-parser 6.1.5 (dev) | Quadratic-complexity CPU exhaustion | >=7.1.6 | `apps__web>tailwindcss>…` |

Notes:

- `postcss` and `sharp` are not direct dependencies; both are pinned
  transitively by `next@15.5.28` (`apps/web/package.json` uses `next: "15.5.28"`
  exact). `postcss@8.5.31` already exists in the tree for the tailwind chain;
  the vulnerable 8.4.31 is the copy `next` requests.
- All 8 findings are confined to the **web dashboard** (production
  build-tooling + optional image dependency). The CLI, API, MCP server, and
  core engine have **zero** audit findings: their trees are `semver`, `zod`,
  `@modelcontextprotocol/sdk` and their transitive deps, none flagged.
- The only clean fix is a `next` bump (or `overrides` on `postcss`/`sharp`)
  in `apps/web` — outside this phase's authority to make without compat
  testing. **BLOCKED, recorded for the lead.** No manifest edits were made
  here so the lockfile remains in sync.

### 1.2 cargo audit — RAN (cargo-audit 0.22.2, 1378 advisories loaded)

```
Scanning Cargo.lock for vulnerabilities (37 crate dependencies)
exit=0 — no vulnerabilities found.
```

`crates/Cargo.lock` is present and committed; engine deps are minimal
(`serde`, `serde_json`, `regex`, `sha1`/`digest` 0.10, `libc`, dev-only
`tempfile`). No version bumps justified.

### 1.3 Advisory review of `crates/*/Cargo.toml`

Workspace `crates/Cargo.toml` declares no direct deps;
`crates/veylqorix-engine/Cargo.toml` uses caret-style major ranges
(`serde = "1"`, etc.). All resolve cleanly against `Cargo.lock` (37 crates,
audit-clean). `sha1` (0.10) is used deliberately for the engine's
deterministic hashing; it is not a crypto-weakness exposure in this context
(no password/credential hashing). No changes made.

## 2. pnpm-workspace.yaml — `allowBuilds` fix

The file shipped with placeholder text:

```yaml
allowBuilds:
  esbuild: set this to true or false
  sharp: set this to true or false
```

Verified against the installed pnpm **11.9.0** source
(`createAllowBuildFunction` in `dist/pnpm.mjs`): pnpm 11's build-approval map
values are read as `true` / `false` (JS booleans). The string
`"set this to true or false"` matches neither case, so **neither esbuild nor
sharp postinstall was ever approved**, and pnpm silently persisted the
garbage into `node_modules/.modules.yaml`'s `allowBuilds` record. Both
packages install fine anyway because esbuild ships its platform binary as a
`@esbuild/<platform>` optional dep (postinstall only verifies) and sharp's
platform libs are `@img/*` optional deps — so the gap was latent, not active.

**Fix:** set both to `true` (the only packages in the tree with meaningful
build/postinstall steps) with a comment, in `pnpm-workspace.yaml`. No
lockfile impact — `allowBuilds` does not participate in lockfile content.

## 3. `.bak` files

- `pnpm-workspace.yaml.bak` (40 bytes, just the `packages:` glob list — a
  pre-`allowBuilds` copy) — **deleted**: stale, superseded by the live file.
- `packages/mcp-server/package.json.bak` — **out of scope, left in place**;
  it duplicates the current `packages/mcp-server/package.json` and should be
  deleted by whoever owns packages.

## 4. External binary / download review

| Surface | Mechanism | Checksum/signature check |
|---|---|---|
| pnpm install | Registry packages | ✅ Full-tree SHA-512 SRI integrity in `pnpm-lock.yaml` (439 `integrity:` entries, incl. all `@esbuild/*` and `@img/sharp-*` platform binaries); `--frozen-lockfile` enforced in CI. |
| Rust crates | crates.io via `Cargo.lock` | ✅ Per-crate SHA-256 in committed `Cargo.lock`; `cargo build --frozen` semantics from lock. |
| gitleaks (CI only, `.github/workflows/ci.yml:74-84`) | `curl -sSL` of the pinned `v8.30.1` GitHub release tarball | ⚠️ **Gap: no checksum or signature verification** before extraction to `/opt/gitleaks`. Mitigants: version-pinned, `continue-on-error`, engine treats gitleaks as optional with an offline fallback. Recommend adding an expected-SHA-256 comparison before `tar -xzf` (workflow edit = other head's file). |
| Rust engine binary | **Not distributed** — consumers build from source (`cargo build --release` in `crates/`, see ci.yml / gate yml) or set `VEYLQORIX_ENGINE` to a path they control (`packages/core/src/engine/index.ts:178`). No download path exists in code or CI. | ✅ N/A today; the `VEYLQORIX_ENGINE` env is operator-provided, so an operator can always point it at a trusted prebuilt binary. If binary distribution is ever added (npm prebuilds, GitHub releases), checksum/signature verification becomes mandatory — documented here as the standing requirement. |
| `curl \| sh` patterns | Searched all `package.json` scripts, `crates/` manifests, engine src | ✅ None found. |

## 5. GitHub Actions pinning inventory

All actions in both workflows are **pinned to commit SHAs** with the tag in a
trailing comment. No changes made to workflow files (another head owns them).

| Workflow | Action | Current ref | Pinned? | Note |
|---|---|---|---|---|
| `ci.yml` | `actions/checkout` | `@11bd71901bbe5b1630ceea73d27597364c9af683` | ✅ SHA (v4.2.2) | Tag in comment |
| `ci.yml` | `pnpm/action-setup` | `@a7487c7e89a18df4991f7f222e4898a00d66ddda` | ✅ SHA (v4.1.0) | |
| `ci.yml` | `actions/setup-node` | `@1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a` | ✅ SHA (v4.2.0) | |
| `ci.yml` | `dtolnay/rust-toolchain` | `@683b588c487a69d01f6c6ddf40f036ff682cc2c8` | ✅ SHA (v1) | |
| `veylqorix-gate.yml` | `actions/checkout` | `@11bd71901bbe5b1630ceea73d27597364c9af683` | ✅ SHA (v4.2.2) | |
| `veylqorix-gate.yml` | `pnpm/action-setup` | `@a7487c7e89a18df4991f7f222e4898a00d66ddda` | ✅ SHA (v4.1.0) | |
| `veylqorix-gate.yml` | `actions/setup-node` | `@1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a` | ✅ SHA (v4.2.0) | |
| `veylqorix-gate.yml` | `dtolnay/rust-toolchain` | `@683b588c487a69d01f6c6ddf40f036ff682cc2c8` | ✅ SHA (v1) | |
| `veylqorix-gate.yml` | `actions/upload-artifact` | `@50769540e7f4bd5e21e526ee35c689e35e0d6874` | ✅ SHA (v4.4.0) | |
| `veylqorix-gate.yml` | `github/codeql-action/upload-sarif` | `@4e828ff8d448a8a6e532957b1811f387a63867e8` | ✅ SHA (v3.29.4) | |

Recommended SHAs: **none outstanding** — every action already at a
commit SHA. Recommended follow-up (workflow head's call): re-verify each
SHA against its tagged release periodically; add a Dependabot group for
actions if tag-upgrade tracking is wanted.

## 6. `.env.example` — reconciled against code

Cross-checked `packages/api/src/bin.ts`, `packages/mcp-server/src/bin.ts`,
`apps/web/next.config.mjs`, `apps/web/src/lib/api.ts`,
`packages/core/src/engine/index.ts`, `packages/core/src/util/hooks.ts`.

Documented now (with safe default + who must set it):

- API: `VEYLQORIX_API_PORT` (4173), `VEYLQORIX_ALLOWED_ROOTS` (empty =
  unrestricted), `VEYLQORIX_OFFLINE` (0), `VEYLQORIX_INCLUDE_TESTS` (0),
  `VEYLQORIX_TIMEOUT_MS` (120000)
- Web: `NEXT_PUBLIC_API_BASE` (unset = same-origin proxy)
- MCP: `VEYLQORIX_ROOTS` (required; unset = server refuses to start, exit 1)
- Engine: `VEYLQORIX_ENGINE` (unset = walk for `crates/target/{release,debug}/veylqorix-engine`)
- Hooks: `VEYLQORIX_OVERRIDE` (empty = hooks always run)

Removed from the example: `VEYLQORIX_WEB_PORT` and `VEYLQORIX_API` —
**no code in the repo reads either** (the web app uses Next's standard port
handling and `NEXT_PUBLIC_API_BASE`; the old names were dead variables from
an earlier layout). No real secrets present or introduced; the file remains
placeholder-only.

## 7. What was not done / blocked for the lead

1. **`apps/web` vulns (8, §1.1)** — need a `next`/`postcss`/`sharp` decision
   (bump vs `pnpm.overrides`) + lockfile regeneration; flagged BLOCKED here
   rather than silently bumped.
2. **gitleaks CI download lacks a checksum** (§4) — one-line fix in
   `ci.yml`, owned by the workflows head.
3. `packages/mcp-server/package.json.bak` left for its owner (§3).
