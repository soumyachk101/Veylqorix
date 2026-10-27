# Veylqorix Diagrams — Ditto-inspired palette

These diagrams use an original Veylqorix color system inspired by the public visual direction of [Ditto.site](https://www.ditto.site/): turquoise, lavender, warm yellow, and coral accents, balanced with a warm paper canvas and deep-ink typography. This is a design interpretation of the public reference, not a claim that the exact CSS tokens were extracted.

The diagrams do not reuse Ditto's branding, mascot, logo, or proprietary assets.

## Files

This directory contains seven PNGs:

| File | Description | Status |
|---|---|---|
| `01_system_architecture.png` | System architecture | Target architecture — some components (file-backed API store, reusable security gate, MCP server + skill) are implemented; treat the diagram as the blueprint, not a claim of full implementation |
| `02_scan_lifecycle.png` | End-to-end scan and verification lifecycle | Target / simplified — the shipped API state (`packages/api/src/store.ts`) is a file-backed JSON store with atomic writes, and in-flight scans recover as `INTERRUPTED` on restart, so any in-memory-only state model in the diagram is not the current state |
| `03_github_security_gate.png` | GitHub pull-request enforcement flow | Implemented — the reusable workflow exists (`.github/workflows/veylqorix-gate.yml`) and is advisory until a calling repo owner configures a required status check for it |
| `04_ai_integrations.png` | AI clients, Skill/MCP/plugin/CLI integration | Implemented — the AI integration is the MCP server (`packages/mcp-server`) plus a portable skill (`packages/skills/SKILL.md` with Claude Code, Codex, and Cursor MCP configs); any platform-agnostic claims beyond those are target |
| `05_eight_day_roadmap.png` | Implementation roadmap | Roadmap — explicitly an 8-day implementation plan, not a claim of completion |

Two further files, `Pasted 2026-10-25 at 10.06.07 PM.png` and `Pasted 2026-10-25 at 10.06.41 PM.png`, appear to be reference screenshots pasted into the directory; they are not part of the numbered diagram set.

## Palette

- Canvas: `#FBFAF7`
- Ink: `#17213A`
- Turquoise: `#44CDBB`
- Lavender: `#9B84F3`
- Warm yellow: `#E3BE45`
- Coral: `#EF8B9B`

Diagram sources are not included in the repo; the PNGs are the current record.
