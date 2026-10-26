# Veylqorix Launch Film — SPEC

**One thing:** Veylqorix independently verifies code — AI-written or human — before it ships: one engine, real scanners, a deterministic gate (0 PASS / 1 FAIL / 2 INCOMPLETE), across CLI, GitHub Actions, MCP and agent skills.

**Duration:** 60 s · 1920×1080 · 30 fps · MP4 H.264 (+ sparse SFX bed; no music source available — see delivery note).

## LOOK (all numbers, from verified capture)

- Ground: mint `#E7F4EC` (the film's home stage) · dark world: `#0C2334` / `#0E2A3D` ("the screen")
- Ink `#0E2A3D`, ink-dim `#3C5B6A` · accents: teal `#14B3AD` (verified), mint `#6FE9E2` (PASS), coral `#EF5F5F` (BLOCK/risk), gold `#F0AC1B` (INCOMPLETE), lavender `#9A8CF5` (secondary fragment)
- Type: Hanken Grotesk 800 (titles, −0.03em, 72–150px) · JetBrains Mono (all technical text, 18–28px) · Press Start 2P (2–3 tiny pixel labels max per scene, 14–18px)
- Materials: flat premium cards with the site's hard pixel shadow `4px 4px 0 rgba(15,44,64,0.16)`, 4px navy borders, pixel-corner ticks — dimensional via layered parallax, scale dolly and soft radial light, not 3D plastic
- Motion: arrive on `expo.out`/`power4.out` long tails, exits ~40% shorter, camera drifts `power2.inOut`; one fast move per scene max, `data-motion-blur="on"` on root
- BANNED: the brief's cream palette (superseded by verified mint), neon glow/particles, rainbow gradients, generic shields/emoji, three-card feature rows, breathing/float loops on titles, titles drifting after landing, crossfades between worlds, fabricated stats or logos, "production-proven" claims for the Rust engine

## Shots (seconds, scene-local design; host slots: s1 0–5, s2 5–12, s3 12–19, s4 19–31, s5 31–40, s6 40–49, s7 49–60)

| s | world | content | copy (verbatim) |
|---|---|---|---|
| 1 | mint, near-empty | 8 navy pixels settle; 3 code chips (`diff +42 −7`, `Cargo.lock`, `manifest.json`) rise on hard shadows; thin grid drifts | **Every line of code carries a decision.** |
| 2 | mint, parallax depth | dep-graph edges draw, nodes pop (coral risk ×2, teal verified), layered cards; ends: 56px navy fragment grows center | **But not every change is safe to ship.** |
| 3 | mint → dark | fragment expands into a 900×540 panel that floods the frame dark (object-becomes-world); logo lockup reveals by teal scanline + 4-slice stagger; light sweep; slow orbit settle | **Meet Veylqorix.** / **No Unsafe Code Gets Through.** |
| 4 | dark "the screen" | `$ veylqorix scan . --json` types; 5 stage modules activate: Change → Discover → Scan (deps·secrets·license·static·tests) → Normalize + redact (`AKIA…CDEF (20 chars, redacted)`) → Policy; outcome chips: **FAIL · exit 1** (coral), **PASS · exit 0** (mint) | **Inspect.** / **Verify.** / **Enforce.** |
| 5 | mint flood | Rust engine hub (label: `veylqorix-engine v0.1.0 · JSON-stdio · in repo` — early, not production); 5 surface cards draw in: CLI, GitHub Actions, MCP (six tools), Agent skills, Dashboard/API; lines converge to hub | **Independent verification.** / **Before code ships.** |
| 6 | mint | balanced system silhouette draws; teal ticks sweep the pipeline; gate trio lands: **PASS · exit 0** / **FAIL · exit 1** / **INCOMPLETE · exit 2** | **Confidence, built into the workflow.** |
| 7 | clean mint | 6 pixel fragments settle; real lockup card lands (1.06→1.0, hard shadow); stillness held to end | **VEYLQORIX** (in lockup) / **No Unsafe Code Gets Through.** / **Verify before you ship.** |

Transitions with a cause (5 kinds): object-becomes-world (3→4), colour flood (4→5), blur swap on one stage (5→6, 6→7), fragment-expand (2→3), dip+hard cut on terminal world entry (inside 4). No crossfades between worlds.

## Claims on screen (all verified in the repo)

- `veylqorix scan . --json` — real CLI command (docs/cli.md)
- "23 findings · 2 critical · 5 high · 8 medium · 8 low" and `lodash@4.17.15`, `AKIA…CDEF` — the site's own labelled-Illustrative hero output; we keep the site's phrasing and keep our framing abstract/conceptual
- Scanners: dependency audit (npm audit / pip-audit), offline secret rules + optional gitleaks, license checks, static analysis + tests (tsc/eslint/ruff) — packages/core/src/scanners
- Redaction format `abcd…wxyz (N chars, redacted)`; ≤8 chars → `****` — secrets.ts, byte-parity in Rust engine
- Gate: 0 PASS / 1 FAIL / 2 INCOMPLETE, "never a clean pass" — packages/core/src/gate, docs/cli.md
- MCP: six tools `scan_repository, scan_dependencies, scan_secrets, run_security_checks, get_findings, validate_fix`
- GitHub Actions gate: reusable `workflow_call`, pinned actions, SARIF upload, advisory until branch protection
- Agent skills: SKILL.md + MCP configs for Claude Code, Codex, Cursor
- Rust engine: real v0.1.0 native binary, JSON-over-stdio, 60 tests — labelled early/in-repo; NEVER "production" or "shipped everywhere"

## Sound

No music (no HeyGen sign-in, no local model — silent bed, delivered with SFX only; note it). Sparse, exact SFX (bundled, free): tick on word landings, pop on chips, one riser-impact on the s3 reveal, 5.5s mechanical hum under s5 draw, impact on the end card. Each hit sits on its picture, +1 frame.
