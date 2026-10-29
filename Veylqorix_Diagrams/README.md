# Veylqorix Diagrams — Ditto-inspired palette

These diagrams use an original Veylqorix color system inspired by the public
visual direction of [Ditto.site](https://www.ditto.site/): turquoise,
lavender, warm yellow, and coral accents, balanced with a warm paper canvas
and deep-ink typography. This is a design interpretation of the public
reference, not a claim that the exact CSS tokens were extracted.

The diagrams do not reuse Ditto's branding, mascot, logo, or proprietary
assets.

## Files

| File | Description | Implementation status |
|---|---|---|
| `01_system_architecture.svg` / `.png` | System architecture: entry points → Rust engine → scanner adapters → policy gate / reports / persistence / dashboard | **Mixed** — entry points, engine, scanner adapters (cargo audit, npm audit, pip-audit, secrets + optional gitleaks, quality checks), policy gate, reports (JSON/SARIF/Markdown), file-backed persistence and the web dashboard + API are all **implemented**; the SAST adapter (Ruff/Bandit, Clippy) is the only **planned** component (dashed box + legend) |
| `02_scan_lifecycle.svg` / `.png` | End-to-end scan and verification lifecycle: change → detect → scan → normalize → policy → PASS / FAIL / INCOMPLETE → report → remediate → rescan | **Implemented** — every stage reflects the shipped engine, CLI and API behavior, including the `RUNNING → INTERRUPTED` recovery state |
| `03_github_security_gate.svg` / `.png` | GitHub pull-request enforcement flow via the reusable `veylqorix-gate.yml` workflow | **Implemented** — pinned actions, least-privilege permissions, input validation, SARIF validation before code-scanning upload; advisory until a calling repo requires the status check |
| `04_ai_integrations.svg` / `.png` | AI agent integration model: agents → skill + MCP server / CLI → shared Rust core → normalized findings → reports & dashboard | **Implemented** — the supported surfaces are the portable skill and the MCP server; `@veylqorix/plugin` is a scanner-extension SDK (noted in the figure), not an agent host surface |
| `05_eight_day_roadmap.svg` / `.png` | The original eight-day build plan | **Archived plan** — every milestone has shipped; kept as a historical record and labeled as such, not a current schedule |

Status convention: solid outlines/arrows are implemented functionality,
dashed outlines/arrows are planned functionality. `05` is a plan, marked as
archived with an explicit "all milestones shipped" terminator.

`reference-screenshot-1.png` and `reference-screenshot-2.png` are reference
screenshots pasted into the directory; they are not part of the numbered
diagram set (renamed from their raw clipboard names on 2026-10-28).

## Regenerating the PNGs

Each numbered PNG is rendered from its matching `.svg` source (the historical
Graphviz `.dot` sources were removed from the tree; the SVGs are the
canonical editable record). From the repo root:

```sh
node Veylqorix_Diagrams/render-diagrams.mjs
```

The script rasterizes every `0[1-5]_*.svg` at 3× (≈3600 px wide) using
`sharp` from the pnpm store when available. If no rasterizer is installed,
it validates the SVGs and prints the equivalent `rsvg-convert -z 3` commands
instead of failing.

## Binary-asset integrity (audit A7, diagrams side)

`SHA256SUMS` lists the SHA-256 digest of every binary asset in this
directory. Verify with:

```sh
shasum -a 256 -c Veylqorix_Diagrams/SHA256SUMS   # from the repo root
```

A CI-side content-hash gate for the remaining tracked binaries
(`logo.png`, launch-film `.mp3` assets) is optional and not required for
an open-source repo.

## Palette

- Canvas: `#FBFAF7`
- Ink: `#17213A`
- Turquoise: `#44CDBB`
- Lavender: `#9B84F3`
- Warm yellow: `#E3BE45`
- Coral: `#EF8B9B`
