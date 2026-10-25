# Veylqorix

**No Unsafe Code Gets Through.**

Veylqorix independently verifies AI-generated and human-written code before it is
committed, pushed, merged, or deployed. It runs **real scanners** — dependency
auditing, secret detection, license checks, and quality checks — normalizes their
output into a consistent finding schema, and gates on it with deterministic exit
codes. A scanner error or a skipped mandatory check degrades coverage and is
**never** mistaken for a clean pass.

> Veylqorix reports what its scanners found. It does not certify the absence of
> vulnerabilities or secrets.

## Quick start

```
pnpm install
pnpm build
pnpm test
```

Run the API and open the dashboard:

```
node packages/api/dist/bin.js      # API on http://localhost:4173
node apps/web/src/serve.mjs       # web app + /api proxy on http://localhost:3000
```

Open <http://localhost:3000/#/dashboard> and click **Dashboard**. (See
[docs/dashboard.md](docs/dashboard.md).)

Run a scan from the CLI on any repository:

```
node apps/cli/dist/index.js scan --root /path/to/repo --json
```

Exit codes: `0` PASS · `1` FAIL (blocking findings) · `2` INCOMPLETE
(coverage degraded) · `64` usage error · `65` bad root · `70` unexpected error.

## Integrations

| Surface | Package / path | Status (verified) | Docs |
|---------|----------------|-------------------|------|
| CLI (`veylqorix`) | `apps/cli` | Works: real scans, deterministic exit codes, safe dry-run hook installer. **Not published to npm yet** — run from `dist/`. | [docs/cli.md](docs/cli.md) |
| MCP server | `packages/mcp-server` | Works: six tools, root-confinement + redaction. Requires `pnpm build`; configure via `.mcp.json`. | [docs/mcp.md](docs/mcp.md) |
| GitHub Actions gate | `.github/workflows/veylqorix-gate.yml` | Works: real scan + SARIF upload, all actions pinned to SHAs. **Advisory until a branch-protection rule requires the check.** | [docs/github-actions.md](docs/github-actions.md) |
| Agent skills | `packages/skills` | Works: portable `SKILL.md` + MCP configs for Claude Code, Codex, Cursor. | [packages/skills](packages/skills) |
| Dashboard | `apps/web` + `packages/api` | Works: live scan data from the API, clearly-labeled demo fallback when the API is down. | [docs/dashboard.md](docs/dashboard.md) |

Honest note: the gate and the CLI hooks are **advisory** until enforcement
(branch protection, or a published CLI) is in place. See
[docs/faq.md](docs/faq.md#honest-limitations-read-this-first).

## CLI

The CLI (`@veylqorix/cli`, binary name `veylqorix`):

```
veylqorix scan [root]                  full audit + quality gate (default)
veylqorix check [root]                 quality checks only (type, lint, tests)
veylqorix report [root]                human-readable Markdown report
veylqorix config validate FILE         validate a policy JSON file
veylqorix hooks install|uninstall      safe Git hook installer (dry-run by default)

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
`scan` / `check`.

## Architecture

```
packages/core        engine: detection, scanners, policy, gate, reports, path safety,
                    git + hook helpers, policy validation
apps/cli             the `veylqorix` command-line interface
packages/mcp-server  MCP server exposing the engine to AI coding agents
packages/api         dependency-free REST API that runs real scans for the dashboard
packages/skills      portable AI-agent skill + per-client MCP configs
apps/web             landing page + security dashboard (real API data, labeled demo fallback)
```

The core engine is independent of every front-end. CLI, MCP, and API are thin
adapters that all call `runAudit` and the same policy/gate functions, so there is
exactly one place where security logic lives.

### Scanners

| Scanner       | Source                              | Offline? |
|---------------|-------------------------------------|----------|
| dependencies  | `npm audit` (Node) / `pip-audit`    | optional |
| secrets       | built-in rule set, values redacted  | yes      |
| licenses      | manifest license checks             | yes      |
| quality       | `tsc`, `eslint`, `ruff`, project tests | no      |

External scanners that cannot run (binary missing, offline, no network) are
reported as SKIPPED or ERROR, which degrades coverage. This is deliberate: an
incomplete audit is surfaced, not green-washed.

## Dashboard

The dashboard shows **real** scan data from the API when it is reachable. If the
API is offline it renders clearly-labeled sample data and says so — it never
presents a demo as a live result.

```
node packages/api/dist/bin.js        # API on :4173
node apps/web/src/serve.mjs          # web app + /api proxy on :3000
```

Open <http://localhost:3000>.

## Policy

A `veylqorix-policy.json` (see the repo root for a sample) controls what blocks
the gate. Exceptions must carry a documented reason, are capped by
`maxExceptions`, can expire, and are recorded in every gate decision so they can
be audited. An AI agent cannot suppress findings or raise thresholds without an
entry that is present in the committed policy file and visible in the report.

## Testing

```
pnpm build && pnpm typecheck && pnpm lint && pnpm test
```

The suite covers the gate logic, finding normalization, secret redaction, path
confinement, policy validation, the full audit flow against fixtures (clean,
vulnerable, secret, insecure, failing-test, no-scanner), the API over real HTTP,
and the MCP server through an in-memory client.

## Security notes

- Secrets are redacted in every output (JSON, Markdown, SARIF, API, dashboard).
- No real credentials are stored in test fixtures; only fake values.
- The MCP server confines all filesystem access to configured workspace roots and
  rejects traversal and symlink escapes.
- Git hooks are a local convenience, **not** a security boundary. The GitHub
  Actions gate plus branch protection is the authoritative enforcement point.

See [SECURITY.md](SECURITY.md) for the threat model and responsible disclosure.

## License

MIT. See [LICENSE](LICENSE).
