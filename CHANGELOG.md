# Changelog

All notable changes to Veylqorix are documented here.

## 0.1.0 (2026-10-25)

First public build of the Veylqorix security platform.

### Core engine (`packages/core`)
- Project detection across Node, Python, Go, Rust, Java, Ruby, PHP, and .NET manifests.
- Dependency scanner backed by `npm audit` (Node) and `pip-audit` (Python) with a
  deterministic mock mode for offline tests.
- Offline secret scanner with 9 rule families; matched values are redacted in
  every output surface.
- License scanner for manifest-level license declarations and copyleft risk.
- Quality check runner for TypeScript, ESLint, Ruff, and project test scripts.
- Normalized `Finding` schema, SARIF 2.1.0 export, and a JSON report with the
  gate decision embedded for CI branching.
- Quality gate with deterministic exit codes: 0 PASS, 1 FAIL, 2 INCOMPLETE.
- Configurable policy with documented, auditable, expirable exceptions capped by
  `maxExceptions`.

### CLI (`apps/cli`)
- `scan`, `check`, `report`, `config validate`, and `hooks install|uninstall`.
- Staged-scan mode (git-index scoped), `--format json|markdown|sarif`, and
  machine-readable `--json` output.
- Safe hook installer that never touches `git config` and backs up non-Veylqorix
  hooks before replacing them.

### MCP server (`packages/mcp-server`)
- Six tools: `scan_project`, `check_dependencies`, `detect_secrets`,
  `run_quality_checks`, `get_audit_report`, `verify_quality_gate`.
- Zod-validated inputs; filesystem access confined to configured workspace
  roots; symlink-escape protection.

### API (`packages/api`)
- REST endpoints: repository registration, scan creation, status polling,
  finding retrieval, and report export in JSON, Markdown, or SARIF.
- Optional `allowedRoots` for least-privilege path restriction.

### Web dashboard (`apps/web`)
- Premium landing page and security dashboard backed by the API.
- Live scan data when the API is reachable; clearly-labeled demo data otherwise.
- Original design system: accessible color contrast, keyboard navigation, no
  emoji, responsive down to 360px.

### Skill (`packages/skills`)
- Portable `SKILL.md` in Agent Skills format plus MCP client configs for
  Claude Code, Codex, and Cursor.

### CI
- Reusable `veylqorix-gate` GitHub Actions workflow with SARIF upload and
  least-privilege permissions.

---

## Release checklist

- [x] `pnpm build` — all packages compile
- [x] `pnpm typecheck` — strict TypeScript, zero errors
- [x] `pnpm lint` — zero warnings
- [x] `pnpm test` — 69 tests across 9 files
- [x] Dashboard demo flow verified end-to-end
- [ ] `@veylqorix/cli` published to the registry (non-monorepo callers need it)
- [ ] Gitleaks integration for higher-fidelity secret detection
- [ ] GitHub Actions `branch protection` docs with screenshots
