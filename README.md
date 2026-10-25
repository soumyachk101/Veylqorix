# Veylqorix

**No Unsafe Code Gets Through.**

Veylqorix is a universal code-security and quality platform that independently
verifies **AI-generated and human-written** code before it is committed,
pushed, merged, or deployed. It orchestrates *real* scanners — dependency
auditing, secret detection, license checks, static analysis, and test suites —
normalizes their output into a single finding schema, and turns it into a
deterministic gate decision with auditable evidence.

A scanner error or a skipped mandatory check degrades coverage and is **never**
mistaken for a clean pass. Veylqorix surfaces incomplete audits instead of
green-washing them.

> **Scope.** Veylqorix reports what its scanners found. It does not certify the
> absence of vulnerabilities or secrets.

[![CI](https://github.com/soumyachk101/Veylqorix/actions/workflows/ci.yml/badge.svg)](https://github.com/soumyachk101/Veylqorix/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-44CDBB.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.18-45CDBB.svg)](https://nodejs.org)

---

## Contents

- [Why Veylqorix](#why-veylqorix)
- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Integrations at a glance](#integrations-at-a-glance)
- [CLI](#cli)
- [AI agent integration](#ai-agent-integration)
- [GitHub security gate](#github-security-gate)
- [Scan lifecycle](#scan-lifecycle)
- [Policy & exceptions](#-policy--exceptions)
- [Dashboard](#dashboard)
- [Repository layout](#repository-layout)
- [Development](#development)
- [Security](#security)
- [Honest limitations](#honest-limitations)
- [Roadmap](#roadmap)
- [Documentation](#documentation)
- [Community](#community)
- [License](#license)

---

## Why Veylqorix

AI coding agents now write a large share of production code — fast, plausible,
and occasionally unsafe. Lint and CI pipelines were not designed to verify that
volume. Veylqorix fills the gap with four guarantees:

1. **Real evidence, no fabrication.** Every finding, severity, and exit code
   comes from an actual scanner run. A check that cannot run is reported
   `SKIPPED` or `ERROR` with a reason — never a clean pass.
2. **One engine, many surfaces.** CLI, MCP, GitHub Actions, and the dashboard
   are thin adapters over a single core, so security logic exists in exactly
   one place and behaves identically everywhere.
3. **Deterministic gate.** Exit codes are stable (`0` PASS · `1` FAIL · `2`
   INCOMPLETE) so CI branching is predictable and auditable.
4. **Agent-safe policy.** An AI agent cannot suppress findings or raise
   thresholds: exceptions must be documented, capped, expirable, and visible
   in the committed policy file and every gate report.

## How it works

The architecture separates **entry points** (who runs a scan), the
**integration layer** (how they reach the engine), the **core engine** (which
scanner runs, when, and how results are normalized and gated), and the
**results & enforcement surfaces**:

![Veylqorix system architecture](Veylqorix_Diagrams/01_system_architecture.png)

*System architecture — [editable Graphviz source](Veylqorix_Diagrams/01_system_architecture.dot).*

> The diagram depicts the target design. Today's implementation is a pnpm
> TypeScript monorepo with the same engine/adapter separation: `packages/core`
> is independent of every front-end, and CLI, MCP, and API all call the same
> `runAudit` and policy/gate functions.

Scanner adapters **reuse existing tools rather than reimplementing them**:

| Scanner    | Backed by                                      | Offline? |
|------------|------------------------------------------------|----------|
| dependencies | `npm audit` (Node) / `pip-audit` (Python)     | optional |
| secrets    | built-in rule set (9 families), values redacted | yes      |
| licenses   | manifest license checks                         | yes      |
| quality    | `tsc`, `eslint`, `ruff`, project test scripts  | no       |

## Quick start

Prerequisites: **Node 20.18+** and **pnpm 9+**.

```
pnpm install
pnpm build
pnpm test
```

### Run the API and dashboard

```
node packages/api/dist/bin.js             # API on http://localhost:4173
pnpm --filter @veylqorix/web dev          # Next.js dashboard on http://localhost:3000
```

Open <http://localhost:3000/dashboard> — full instructions in
[docs/dashboard.md](docs/dashboard.md). The dashboard proxies `/api/*` to the
API via Next.js rewrites (`NEXT_PUBLIC_API_BASE`, default
`http://localhost:4173`).

### Scan any repository from the CLI

```
node apps/cli/dist/index.js scan --root /path/to/repo --json
```

Exit codes: `0` PASS · `1` FAIL (blocking findings) · `2` INCOMPLETE
(coverage degraded) · `64` usage error · `65` bad root · `70` unexpected error.

## Integrations at a glance

| Surface | Package / path | Status (verified) | Docs |
|---------|----------------|-------------------|------|
| CLI (`veylqorix`) | `apps/cli` | Real scans, deterministic exit codes, safe dry-run hook installer. Not published to npm yet — run from `dist/`. | [docs/cli.md](docs/cli.md) |
| MCP server | `packages/mcp-server` | Six validated tools, root-confinement + redaction. Requires `pnpm build`. | [docs/mcp.md](docs/mcp.md) |
| GitHub Actions gate | `.github/workflows/veylqorix-gate.yml` | Real scan + SARIF upload, all actions pinned to SHAs. **Advisory until a branch-protection rule requires the check.** | [docs/github-actions.md](docs/github-actions.md) |
| Agent skills | `packages/skills` | Portable `SKILL.md` + MCP configs for Claude Code, Codex, Cursor. | [packages/skills](packages/skills) |
| Dashboard | `apps/web` + `packages/api` | Live scan data from the API, clearly-labeled demo fallback when the API is down. | [docs/dashboard.md](docs/dashboard.md) |

**Honest note:** the gate and the CLI hooks are *advisory* until enforcement
(branch protection, or a published CLI) is in place. See
[Honest limitations](#honest-limitations) and
[docs/faq.md](docs/faq.md#honest-limitations-read-this-first).

## CLI

The CLI (`@veylqorix/cli`, binary name `veylqorix`) is a thin adapter over the
core engine — every result comes from a real scanner run.

```
veylqorix scan [root]                  full audit + quality gate (default)
veylqorix check [root]                 quality checks only (type, lint, tests)
veylqorix report [root]                human-readable Markdown report
veylqorix config validate FILE         validate a policy JSON file
veylqorix hooks install|uninstall      safe Git hook installer (dry-run by default)
```

Useful options:

```
--staged            scope the secret scan to Git-staged files
--json              machine-readable output
--format markdown|json|sarif
--report-out FILE   write a Markdown report
--sarif-out FILE    write a SARIF report
--offline           skip network-dependent scanners
--no-tests          skip test/build checks
--scanners a,b      restrict which scanners run
--block-on a,b      severities that block the gate
--policy FILE       load a policy JSON file
```

Legacy aliases (`audit`, `deps`, `secrets`, `checks`, `gate`) still map to
`scan` / `check`. Full reference: [docs/cli.md](docs/cli.md).

## AI agent integration

Veylqorix exposes the engine to AI coding agents (Claude Code, Codex, Cursor,
and any MCP client) through one security core with multiple compatible entry
points — no duplicated security rules:

![Veylqorix AI agent integration model](Veylqorix_Diagrams/04_ai_integrations.png)

*AI integration model — [editable Graphviz source](Veylqorix_Diagrams/04_ai_integrations.dot).*

| Surface | What it does |
|---------|--------------|
| **MCP server** (`packages/mcp-server`) | Six tools: `scan_repository`, `scan_dependencies`, `scan_secrets`, `run_security_checks`, `get_findings`, `validate_fix`. Zod-validated inputs, structured evidence-based output. |
| **Portable skill** (`packages/skills`) | `SKILL.md` in Agent Skills format that guides the agent's workflow, plus ready-made MCP client configs for Claude Code, Codex, and Cursor. |
| **Git hooks** | `hooks install` adds a safe pre-commit/pre-push layer that never touches `git config` and backs up existing hooks. |

Security properties of the MCP server: all filesystem access is confined to
configured workspace roots (traversal and symlink escapes are rejected), secret
values are redacted in every response, and the agent cannot commit or push
through the server. Setup: [docs/mcp.md](docs/mcp.md).

## GitHub security gate

The monorepo ships `veylqorix-gate` as a reusable `workflow_call` GitHub
Actions workflow — CI enforcement that is **independent of local hooks**:

![Veylqorix GitHub pull-request security gate](Veylqorix_Diagrams/03_github_security_gate.png)

*Gate flow — [editable Graphviz source](Veylqorix_Diagrams/03_github_security_gate.dot).*

The gate checks out the PR, builds or installs the CLI, runs `veylqorix scan`,
emits SARIF to GitHub code scanning, and uploads JSON + stderr as artifacts
with least-privilege permissions and SHA-pinned actions.

> **Enforcement:** the workflow does not block merges by itself. It becomes
> authoritative when the repository **requires its status check** via branch
> protection or a ruleset. Until then it is advisory: findings are produced,
> the check fails — but a merge can still be forced. See
> [docs/github-actions.md](docs/github-actions.md).

## Scan lifecycle

Every scan follows the same evidence-based loop, from code change to
verified decision:

![Veylqorix security scan lifecycle](Veylqorix_Diagrams/02_scan_lifecycle.png)

*Scan lifecycle — [editable Graphviz source](Veylqorix_Diagrams/02_scan_lifecycle.dot).*

Key properties:

- **Normalize before judging.** All scanner output is converted to one
  finding schema (severity, file/line, redacted evidence, remediation) before
  the policy gate evaluates it.
- **Gate failures are first-class.** A scanner that cannot run routes the
  decision to `INCOMPLETE` (exit 2), never to a pass.
- **Verify, don't trust.** After a fix, the scan re-runs to confirm the
  finding no longer reproduces — the remediation loop is part of the protocol,
  not a suggestion.

## Policy & exceptions

A `veylqorix-policy.json` (sample at the [repo root](veylqorix-policy.json))
controls what blocks the gate:

```json
{
  "blockOnSeverity": ["CRITICAL", "HIGH"],
  "blockOnSecrets": true,
  "blockOnTestFailure": true,
  "blockOnScannerError": true,
  "blockOnSkippedCheck": true,
  "reportOnSeverity": ["MEDIUM", "LOW"],
  "maxExceptions": 5,
  "exceptions": []
}
```

Exceptions are deliberately unfriendly to gaming:

- each exception requires a **documented reason**,
- the count is capped by `maxExceptions`,
- exceptions can **expire**,
- every gate decision **records which exceptions were honored**, so they can
  be audited.

An AI agent cannot suppress findings or raise thresholds without an entry that
is present in the committed policy file and visible in the report.

## Dashboard

The dashboard (`apps/web`) shows **real** scan data from the API when it is
reachable. If the API is offline it renders clearly-labeled sample data with a
**DEMO MODE** banner — it never presents a demo as a live result.

```
node packages/api/dist/bin.js      # API on :4173
node apps/web/src/serve.mjs        # web app + /api proxy on :3000
```

You'll see the gate result (PASS / FAIL / INCOMPLETE), normalized findings
sorted by severity with redacted secret values, per-scanner status so you can
see which checks actually ran, and scan history. The REST API behind it is
documented in [docs/api.md](docs/api.md).

## Repository layout

```
packages/core        engine: detection, scanners, policy, gate, reports,
                    path safety, git + hook helpers, policy validation
apps/cli             the `veylqorix` command-line interface
packages/mcp-server  MCP server exposing the engine to AI coding agents
packages/api         dependency-free REST API that runs real scans for the dashboard
packages/skills      portable AI-agent skill + per-client MCP configs
apps/web             landing page + security dashboard (real API data, labeled demo fallback)
Veylqorix_Diagrams/  editable Graphviz diagram sources and rendered PNGs
docs/                per-surface documentation (cli, mcp, api, dashboard, github-actions, faq, troubleshooting)
tests/               unit tests + integration fixtures (fake data only, never real credentials)
```

The core engine is independent of every front-end. CLI, MCP, and API are thin
adapters that all call `runAudit` and the same policy/gate functions, so there
is exactly one place where security logic lives.

## Development

```
pnpm install
pnpm build        # build all packages
pnpm typecheck    # strict TypeScript, zero errors
pnpm lint         # zero-warning ESLint
pnpm test         # vitest: 69 tests across 9 files
```

The suite covers the gate logic, finding normalization, secret redaction, path
confinement, policy validation, the full audit flow against fixtures (clean,
vulnerable, secret, insecure, failing-test, no-scanner), the API over real
HTTP, and the MCP server through an in-memory client.

Ground rules for contributors are in [CONTRIBUTING.md](CONTRIBUTING.md) —
short version: no fabricated results, never weaken the gate to make a test
pass, redact secrets everywhere, no new dependencies without justification.

## Security

- Secrets are **redacted in every output** (JSON, Markdown, SARIF, API,
  dashboard).
- No real credentials are stored in test fixtures — only fake values.
- The MCP server confines all filesystem access to configured workspace roots
  and rejects traversal and symlink escapes.
- Git hooks are a local convenience, **not** a security boundary. The GitHub
  Actions gate plus branch protection is the authoritative enforcement point.

See [SECURITY.md](SECURITY.md) for the threat model and responsible
disclosure.

## Honest limitations

Veylqorix reports what its scanners found. It does **not** certify the
absence of vulnerabilities or secrets. Specifically:

- **Degraded coverage is surfaced, not hidden.** Offline mode, missing
  binaries (`pip-audit`), or a missing lockfile make a scanner `SKIPPED` or
  `ERROR`, which can make the gate `INCOMPLETE` (exit 2) — never a pass.
- **Regex secret detection has false positives and false negatives.** It
  complements tools like Gitleaks; it does not replace them.
- **License scanning is manifest-level**, not a transitive license audit.
- **A clean quality check is not a security certification.**
- **The gate and hooks are advisory** until branch protection requires the
  check (or the CLI is published).

Full answers: [docs/faq.md](docs/faq.md) · deeper failures:
[docs/troubleshooting.md](docs/troubleshooting.md).

## Roadmap

![Veylqorix eight-day build roadmap](Veylqorix_Diagrams/05_eight_day_roadmap.png)

*Eight-day build roadmap — [editable Graphviz source](Veylqorix_Diagrams/05_eight_day_roadmap.dot).*

Progress is tracked in [CHANGELOG.md](CHANGELOG.md). Current open items from
the release checklist:

- [ ] publish `@veylqorix/cli` to the npm registry
- [ ] Gitleaks integration for higher-fidelity secret detection
- [ ] GitHub Actions branch-protection guide with screenshots

## Documentation

| Doc | What it covers |
|-----|----------------|
| [docs/cli.md](docs/cli.md) | Commands, options, exit codes, hooks install |
| [docs/mcp.md](docs/mcp.md) | MCP setup + example `.mcp.json` |
| [docs/api.md](docs/api.md) | REST API reference |
| [docs/dashboard.md](docs/dashboard.md) | Running the API + web app, environment variables |
| [docs/github-actions.md](docs/github-actions.md) | Reusable gate workflow, enforcement via branch protection |
| [docs/faq.md](docs/faq.md) | Honest limitations and general questions |
| [docs/troubleshooting.md](docs/troubleshooting.md) | "Why did it fail" answers |
| [Veylqorix_Diagrams/README.md](Veylqorix_Diagrams/README.md) | Diagram palette, editable `.dot` sources, how to re-render |

## Community

- **[Contributing](CONTRIBUTING.md)** — setup, layout, ground rules, release checklist
- **[Code of Conduct](CODE_OF_CONDUCT.md)** — Contributor Covenant v2.0
- **[Accessibility](ACCESSIBILITY.md)** — accessibility commitment and known limitations
- **[Security](SECURITY.md)** — threat model and responsible disclosure
- **[Changelog](CHANGELOG.md)** — all notable changes
- **Issues** — [report bugs](https://github.com/soumyachk101/Veylqorix/issues/new?template=bug_report.md) ·
  [request features](https://github.com/soumyachk101/Veylqorix/issues/new?template=feature_request.md) ·
  [report docs issues](https://github.com/soumyachk101/Veylqorix/issues/new?template=docs_issue.md)
- **Pull requests** — use the [pull request template](.github/PULL_REQUEST_TEMPLATE.md)

## License

MIT. See [LICENSE](LICENSE).
