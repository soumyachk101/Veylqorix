# Veylqorix MCP Server

`@veylqorix/mcp-server` exposes the Veylqorix engine to AI coding agents
(Claude Code, Codex, Cursor, or any MCP client) over the Model Context
Protocol. It is a thin adapter: all scan, gate, and report logic lives in
`packages/core`; the server only validates inputs and confines filesystem
access.

## What it provides

Six tools (see `packages/mcp-server/src/index.ts`):

| Tool | Purpose |
|------|---------|
| `scan_repository` | Full audit of a repository: dependency, secret, license, and quality scans plus the gate decision. |
| `scan_dependencies` | Dependency audit only (`npm audit` / `pip-audit`). |
| `scan_secrets` | Secret detection only; matched values are redacted in the response. |
| `run_security_checks` | Quality checks only (type, lint, tests). |
| `get_findings` | Fetch findings for a completed scan, optionally filtered by finding ids. |
| `validate_fix` | Re-check a file set after a fix to confirm a finding no longer reproduces. |

Every tool returns structured, evidence-based output — scanner status,
normalized findings, and the gate decision. A scanner that cannot run is
reported as SKIPPED or ERROR, never as a pass.

## Setup

1. Build the monorepo (the server runs from `dist/`):

   ```
   pnpm install
   pnpm build
   ```

2. Create `.mcp.json` in your project (or a client-specific config; ready-made
   examples ship in `packages/skills/mcp/` for Claude Code, Codex, and
   Cursor):

   ```json
   {
     "mcpServers": {
       "veylqorix": {
         "command": "node",
         "args": ["/ABSOLUTE/PATH/to/Veylqorix/packages/mcp-server/dist/bin.js"],
         "env": {
           "VEYLQORIX_ROOTS": "/ABSOLUTE/PATH/to/your/project",
           "VEYLQORIX_TIMEOUT_MS": "120000"
         }
       }
     }
   }
   ```

   Replace both placeholder paths with your real absolute paths.

3. Environment variables understood by the server
   (`packages/mcp-server/src/bin.ts`):

   | Variable | Default | Effect |
   |----------|---------|--------|
   | `VEYLQORIX_ROOTS` | none (no confinement) | Space/comma-separated absolute roots every tool is confined to. Set this to your project directories. |
   | `VEYLQORIX_OFFLINE` | unset (online) | `1` skips network-dependent scanners (no advisory DB). |
   | `VEYLQORIX_TIMEOUT_MS` | `120000` | Per-scanner timeout in milliseconds. |

4. Restart your agent (MCP servers are loaded at client startup). In Claude
   Code, run `/mcp` to confirm the `veylqorix` server is connected.

### Example session

```
> Use veylqorix to check my project before I commit.

[agent calls scan_repository]
Gate result: FAIL (coverage FULL, exit code 1)
Blocking reasons:
- CRITICAL secrets/aws-access-key-id in config.js:2
Recommended: rotate the key and remove it from source; re-run after the fix.
```

## Safety notes

- **Path confinement.** Roots are canonicalized; `..` traversal and symlink
  escapes out of the configured roots are rejected. Without
  `VEYLQORIX_ROOTS` the server has no filesystem restriction — always set it.
- **Redaction.** Secret values are redacted in every tool response, the same
  as the CLI and API.
- **No write path.** The server only reads and scans. It cannot commit, push,
  or modify your repository.
- **Offline honesty.** With `VEYLQORIX_OFFLINE=1` the dependency scanner is
  skipped, so coverage is degraded and the gate can report INCOMPLETE rather
  than PASS. That is intentional.

## Troubleshooting

- Server not appearing in the client: check the path in `.mcp.json` is
  absolute and the `dist/` build exists (`pnpm build`), then restart the client.
- `ENOENT` on scan: the target root is outside `VEYLQORIX_ROOTS` — add it.
- Gate always INCOMPLETE offline: expected; network-dependent scanners are
  skipped by design.
