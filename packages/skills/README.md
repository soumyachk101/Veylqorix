# Veylqorix AI Skill — Installation

The skill is a single portable `SKILL.md` (Anthropic Agent Skills format) plus
MCP client configuration. It teaches an AI coding agent to verify code security
with real scanner output before code ships.

## What is bundled

- `SKILL.md` — the skill: activation, workflow, dependency/secret rules, error
  handling, approval, MCP safety model, examples, limitations.
- `mcp/mcp-claude-code.json` — Claude Code project `.mcp.json` config.
- `mcp/mcp-codex.json` — OpenAI Codex MCP config.
- `mcp/mcp-cursor.json` — Cursor MCP config.

All three point at the same `@veylqorix/mcp-server` binary (`veylqorix-mcp`),
so the agent gets the real tools: `scan_repository`, `scan_dependencies`,
`scan_secrets`, `run_security_checks`, `get_findings`, `validate_fix`.

Each tool calls the shared audit engine (`@veylqorix/core`), so the MCP server
never reimplements scanning. The server enforces workspace-root confinement
(`..` and symlink escapes are rejected), per-item timeouts and output caps,
and redacts secret values in every result. No tool accepts a command to run.

## Prerequisites

```
pnpm install            # in the Veylqorix monorepo
pnpm build              # produces the CLI and MCP binaries
```

The MCP server requires the workspace roots the agent may touch. Set
`VEYLQORIX_ROOTS` to a space-separated list of allowed project directories so
the server never reaches outside them. Without it, the current working
directory is used as the only root. `VEYLQORIX_OFFLINE=1` forces offline mode
(external scanners are reported as skipped, never executed).

---

## Claude Code

The bundled file `mcp/mcp-claude-code.json` is a project `.mcp.json` snippet.
Copy it into the target repository as `.mcp.json` and replace the
placeholders with real values:

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

Or register it from the command line (project scope, env vars via `--env`):

```
claude mcp add veylqorix -s project \
  --env VEYLQORIX_ROOTS="$PWD" \
  -- node /path/to/Veylqorix/packages/mcp-server/dist/bin.js
```

Then copy `SKILL.md` into `.claude/skills/veylqorix-security-scan/SKILL.md`
in the target repository (or into `~/.claude/skills/` for a shared install).
Claude Code picks it up for security-related requests; the MCP tools are
available in the same session once the server is configured.

Note: the `.mcp.json` snippet is a starting point. Claude Code must actually
resolve the `node` binary and the absolute paths against your machine, and the
server must be built (`dist/bin.js` must exist) before the tools connect.
Verify with `claude mcp list` (or by asking Claude Code for the `veylqorix`
tools) that the server reports connected before relying on it.

## OpenAI Codex

Codex does not read Agent Skills files natively. The bundled
`mcp/mcp-codex.json` uses an `mcp_servers` map in Codex's MCP config: point
`command`/`args` at the built `bin.js` and set `env.VEYLQORIX_ROOTS` to the
projects Codex may audit. For the skill procedure, append the `SKILL.md` body
to Codex's `AGENTS.md` (or system instructions) — the skill is the procedure,
the MCP server is the source of truth for tool availability. Whether the MCP
config schema matches your Codex version is up to that version; test the
server connection from inside Codex before relying on the tools.

## Cursor

Cursor supports MCP servers through its own settings UI (Settings → MCP →
Add). Use `mcp/mcp-cursor.json` as the JSON payload: point `command`/`args`
at the built `bin.js` and set `VEYLQORIX_ROOTS`. As with Claude Code, the
skill procedure (the `SKILL.md` body) is not Cursor's native skill format;
attach it to your project's `AGENTS.md` or equivalent and configure the MCP
server separately. Confirm the tools list in Cursor's MCP UI before relying
on them.

## Skill portability note

Not every tool uses the same skill format. The bundled `SKILL.md` is in the
Agent Skills markdown format (front-matter `name` + `description` + body). For a
tool that does not read skills directly, the equivalent is:
- attach the skill body to the agent's system prompt, and
- configure the same MCP server so the tools are available.

The MCP server is the single source of truth; the skill is the *procedure* for
using it well.
