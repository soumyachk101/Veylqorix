# Veylqorix Diagrams — Ditto-inspired palette

These diagrams use an original Veylqorix color system inspired by the public visual direction of [Ditto.site](https://www.ditto.site/): turquoise, lavender, warm yellow, and coral accents, balanced with a warm paper canvas and deep-ink typography. This is a design interpretation of the public reference, not a claim that the exact CSS tokens were extracted.

The diagrams do not reuse Ditto's branding, mascot, logo, or proprietary assets. All diagram text and connectors are rendered from the editable Graphviz `.dot` sources included here so labels stay accurate and can be modified later.

## Files
- `01_system_architecture.png` — target system architecture
- `02_scan_lifecycle.png` — end-to-end scan and verification lifecycle
- `03_github_security_gate.png` — GitHub pull-request enforcement flow
- `04_ai_integrations.png` — AI clients, Skill/MCP/plugin/CLI integration
- `05_eight_day_roadmap.png` — implementation roadmap

These are target-design diagrams, not a claim that every component is already implemented.

## Palette
- Canvas: `#FBFAF7`
- Ink: `#17213A`
- Turquoise: `#44CDBB`
- Lavender: `#9B84F3`
- Warm yellow: `#E3BE45`
- Coral: `#EF8B9B`

## Edit and export
Edit a `.dot` file, then render it with Graphviz:

```bash
dot -Tpng -Gdpi=170 01_system_architecture.dot -o 01_system_architecture.png
```
