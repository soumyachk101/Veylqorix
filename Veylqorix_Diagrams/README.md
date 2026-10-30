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

Two further files, `reference-screenshot-1.png` and `reference-screenshot-2.png`,
are reference screenshots pasted into the directory; they are not part of the
numbered diagram set (renamed from their raw clipboard names on 2026-10-28).

## Palette

- Canvas: `#FBFAF7`
- Ink: `#17213A`
- Turquoise: `#44CDBB`
- Lavender: `#9B84F3`
- Warm yellow: `#E3BE45`
- Coral: `#EF8B9B`

Diagram sources are not included in the repo and will not be added. PNG-only is a permanent constraint: the seven PNGs above are the canonical record, and no SVG, Mermaid, or PDF sources and no diagram-generation pipeline are included or planned *for this diagram set*.

## Separate animated hero asset (not part of this PNG set)

One explanatory animation lives at the repo root, `assets/scan-lifecycle.svg`
(a self-contained SMIL SVG with a `prefers-reduced-motion` fallback). It is the
"how it works" hero in the root `README.md` and an annotated companion to
Figure 2 (`02_scan_lifecycle.png`) in `Veylqorix_Master_Doc.md` §3/§20. It is
deliberately **not** a member of the canonical seven-PNG set above and is not
covered by `SHA256SUMS`. The PNG-only constraint in this directory applies to
this directory: this SVG lives at the repo root under `assets/`, uses SMIL
animations only (no scripts, no external assets, no network requests),
provides baked-in static fallbacks for `prefers-reduced-motion`, and renders
animated in browsers and on GitHub (SMIL-only SVGs animate even when GitHub
strips scripts from served SVGs). It stays at the repo root so it does not
change the canonical record in this directory.

## Integrity

`SHA256SUMS` is the checksum manifest for the seven PNGs in this directory. To verify them from inside the directory:

- macOS/BSD: `shasum -a 256 -c SHA256SUMS`
- Linux: `sha256sum -c SHA256SUMS`
