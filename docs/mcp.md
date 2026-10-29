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
| `get_findings` | List current findings (scanners only, no quality checks), capped to a limit. |
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
   | `VEYLQORIX_ROOTS` | none — required | Space/comma-separated absolute roots every tool is confined to. The server refuses to start without it: it never runs unconfined. |
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

- **Path confinement (fail closed).** Roots are canonicalized; `..`
  traversal and symlink escapes out of the configured roots are rejected
  before any filesystem access. The server refuses to start when
  `VEYLQORIX_ROOTS` is unset or when a listed root does not exist — it never
  falls back to the working directory.
- **Redaction (pattern-based, not perfect detection).** Raw credential values
  are redacted from every tool response: known key/token patterns (AWS,
  GitHub, Slack, OpenAI, generic keys and emails), whole PEM private-key
  blocks, and `password = "..."`-style assignments. The pass runs on text
  blocks, structured fields, scanner notes, and error messages. It is a
  second layer on top of the engine's own masking; unknown secret formats
  that match no pattern are not detected, so do not treat a clean scan as
  proof that no secret exists.
- **No write path.** The server only reads and scans. It cannot commit,
  push, or modify your repository, and it executes no shell: scanner and
  check commands are chosen from the project's own configuration and run as
  direct subprocesses with bounded output and timeouts.
- **Truncation is safe.** The human-readable summary of a result is cut to a
  cap with an explicit `[... truncated to N chars]` marker. The structured
  payload is *never* sliced: its finding lists are already bounded by the
  per-tool cap, so it stays valid JSON and always keeps its status, coverage,
  and gate fields. A truncated result therefore still tells you whether the
  scan completed.
- **Scanner unavailability is reported, never passed over.** Offline mode,
  a missing binary, or a scanner error yields status SKIPPED or ERROR with an
  `available: false` flag and a note. The gate reports INCOMPLETE rather than
  PASS when a mandatory scanner could not run.

## Troubleshooting

- Server not appearing in the client: check the path in `.mcp.json` is
  absolute and the `dist/` build exists (`pnpm build`), then restart the client.
- Server exits 1 at startup: `VEYLQORIX_ROOTS` must list existing absolute
  directories — a listed root that does not exist (a path that changed or a
  typo) refuses startup, and the server never falls back to the working
  directory. Fix the path (or delete the entry), then restart the MCP
  client. The server has no `--version`/version-reporting flag; check the
  build you are pointing at (`packages/mcp-server/dist/bin.js`, built by
  `pnpm build`) and its version in `packages/mcp-server/package.json`.
- `ENOENT` on scan: the target root is outside `VEYLQORIX_ROOTS` — add it.
- Gate always INCOMPLETE offline: expected; network-dependent scanners are
  skipped by design.
