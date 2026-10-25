# Veylqorix AI Skill — Installation

The skill is a single portable `SKILL.md` (Anthropic Agent Skills format) plus
MCP client configuration. It teaches an AI coding agent to verify code security
with real scanner output before code ships.

## What is bundled

- `SKILL.md` — the skill: activation, workflow, dependency/secret rules, error
  handling, examples, limitations.
- `mcp/mcp-claude-code.json` — Claude Code MCP server config.
- `mcp/mcp-codex.json` — OpenAI Codex MCP server config.
- `mcp/mcp-cursor.json` — Cursor MCP server config.

All three point at the same `@veylqorix/mcp-server` binary (`veylqorix-mcp`),
so the agent gets the real tools: `scan_project`, `check_dependencies`,
`detect_secrets`, `run_quality_checks`, `get_audit_report`,
`verify_quality_gate`.

## Prerequisites

```
pnpm install            # in the Veylqorix monorepo
pnpm build              # produces the CLI and MCP binaries
```

The MCP server requires the workspace roots the agent may touch. Set
`VEYLQORIX_ROOTS` to a space-separated list of allowed project directories so
the server never reaches outside them.

---

## Claude Code

Add the MCP server to your project. From the repo, use the packaged config
(`mcp/mcp-claude-code.json`), adjusted to your build output:

```
node packages/mcp-server/dist/bin.js
```

Register it so Claude Code discovers it (per-project):

```
claude mcp add veylqorix -- \
  Veylqorix_ROOTS="$PWD" \
  node /path/to/Veylqorix/packages/mcp-server/dist/bin.js
```

Then copy `SKILL.md` into `.claude/skills/veylqorix-security-scan/SKILL.md` in
the target repository (or add it to a shared skill directory). Claude Code will
offer it for security-related requests.

## OpenAI Codex

Codex reads MCP servers from your MCP config file. Use `mcp/mcp-codex.json`,
setting `command` to your built `bin.js` and `env.VEYLQORIX_ROOTS` to the
projects Codex may audit.

## Cursor

Use `mcp/mcp-cursor.json` from Cursor's MCP settings (Settings →
MCP Servers → Add). Point `command` at the built `bin.js` and set
`VEYLQORIX_ROOTS`.

## Skill portability note

Not every tool uses the same skill format. The bundled `SKILL.md` is in the
Agent Skills markdown format (front-matter `name` + `description` + body). For a
tool that does not read skills directly, the equivalent is:
- attach the skill body to the agent's system prompt, and
- configure the same MCP server so the tools are available.

The MCP server is the single source of truth; the skill is the *procedure* for
using it well.
