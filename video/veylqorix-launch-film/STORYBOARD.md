# Storyboard — Veylqorix Launch Film (60 s)

Scene-by-scene shot breakdown. Times are host-timeline seconds. Worlds: **mint ground**
`#E7F4EC` (the film's home stage) vs **dark "the screen"** `#0C2334` / `#0E2A3D`.
Copy is verbatim from `SCRIPT.md` with its landing time. Motion language throughout, per
`SPEC.md`: arrivals on `expo.out` / `power4.out` long tails, exits ~40% shorter, camera
drifts on `power2.inOut`, one fast move per scene max, `data-motion-blur="on"` on root.

## s1 — Silence (host 0–5) · mint, near-empty · `compositions/s1-silence.html`

- **0.0** — still, pixels settling: 8 navy 18px pixels drop with a premium spring
  (`back.out`), one teal and one coral among them; 3 code chips (`diff +42 −7`,
  `Cargo.lock`, `manifest.json`) rise on hard pixel shadows; thin 48px grid drifts as
  camera (not content).
- **1.6** — **Every line of code carries a decision.** lands word-by-word (blur 6→0,
  words 0.067 s apart), then holds dead-still to 4.6; no float, no drift after landing.
- **Transition out:** none stated — hard cut into s2 at 5 s (no crossfade).
- **SFX:** sfx_002 tick on the 1.6 title landing.

## s2 — Complexity (host 5–12) · mint, parallax depth · `compositions/s2-complexity.html`

- **5.6** — **But not every change is safe to ship.** lands word-by-word under a
  dependency graph: edges draw (`power3.out`), nodes pop (`back.out`), 2 coral risk
  nodes flash once (opacity only, no loop), teal verified nodes; layered white cards
  with 4px navy borders and hard shadows at three parallax depths (back/mid/fore
  drift at different rates).
- **~11.3** — a 56 px navy fragment grows center (scale 0.6→1, then 3.4×) — the object
  that becomes the next world.
- **Transition out:** **fragment-expand** (2→3) — the fragment swells into the s3 panel.
- **SFX:** sfx_002 tick on the 5.6 title landing.

## s3 — Reveal (host 12–19) · mint → dark · `compositions/s3-reveal.html`

- **12.4–13.2** — the fragment expands into a 900×540 panel that floods the frame dark
  (dark world `#0C2334` over ~0.8 s, `power2.inOut`).
- **13.6** — **Meet Veylqorix.** the logo lockup reveals: teal scanline passes across
  the wordmark, 4 canvas-built slices rise in stagger, matte lifts; a single
  restrained light sweep crosses the frame; slow orbit-settle dolly (`power2.out` 4.5 s).
- **15.8** — **No Unsafe Code Gets Through.** pixel tagline lands below the mark;
  breathing room held to 18.8.
- **Transition out:** **object-becomes-world** (3→4) — the dark panel *is* the screen
  the pipeline runs on.
- **SFX:** sfx_005 riser→impact on the reveal (13.4); sfx_002 tick on the 13.6 landing.

## s4 — The Screen (host 19–31) · dark "the screen" · `compositions/s4-pipeline.html`

- **19.5–21.3** — `$ veylqorix scan . --json` types into the terminal; stage modules
  (01 CHANGE → 02 DISCOVER → 03 SCAN → 04 NORMALIZE → 05 POLICY) activate across
  21.5–26.5; SCAN shows deps·secrets·license·static·tests chips; NORMALIZE shows the
  redaction chip `AKIA…CDEF (20 chars, redacted)`; findings line
  `23 findings · 2 critical · 5 high · 8 medium · 8 low` (illustrative).
- **22.5** — **Inspect.** (modules 1–2: change → discover)
- **25.0** — **Verify.** (modules 3–4: scan → normalize + redaction chip)
- **27.5** — **Enforce.** (module 5: policy) + outcome chips **FAIL · exit 1** (coral)
  / **PASS · exit 0** (mint) landing as the scan resolves.
- **~30.5** — **dip+hard cut** on terminal-world entry (inside 4): a 0.5 s dip into
  `#0C2334` then a hard cut — no crossfade.
- **SFX:** sfx_002 ticks on each word landing (22.5, 25.0, 27.5); sfx_003 pop on the
  outcome chips (26.8).

## s5 — Engine (host 31–40) · mint flood · `compositions/s5-engine.html`

- **~31.0** — dark base carried from the terminal world resolves; **colour flood**
  (4→5) — mint floods back over the frame.
- **31.5** — **Independent verification.** the Rust engine hub lands dead-still
  (label: `veylqorix-engine v0.1.0 · in repo` — early, not production); 5 surface
  cards draw in under the hum: CLI, GitHub Actions, Dashboard + API, MCP server
  (six validated tools), Agent skills (Claude Code · Codex · Cursor).
- **34.5** — **Before code ships.** thin architectural lines converge to the hub; the
  hub pulses once (teal) and everything settles with a slow pull-back.
- **Transition out:** **blur swap on one stage** (5→6) — blur out, blur in, same
  stage position; no crossfade.
- **SFX:** sfx_004 5.5 s mechanical hum under the s5 draw (31.2); sfx_002 tick on the
  31.5 landing.

## s6 — Confidence (host 40–49) · mint · `compositions/s6-confidence.html`

- **40.5** — **Confidence, built into the workflow.** a balanced system silhouette
  (change · discover · scan · normalize · policy modules) draws in; a single teal tick
  sweeps the pipeline left-to-right; supporting line `one engine · many surfaces ·
  one deterministic gate`.
- **44.0** — the gate trio lands (the film's payoff, hard beat): **PASS · exit 0**
  (teal/mint) / **FAIL · exit 1** (coral) / **INCOMPLETE · exit 2** (gold), each card a
  frame apart; the modules fade back so the trio is the clear focus; hold with a
  slight pull-back.
- **Transition out:** **blur swap on one stage** (6→7).
- **SFX:** sfx_003 pop on the gate trio (44.0).

## s7 — End Card (host 49–60) · clean mint · `compositions/s7-endcard.html`

- **49.5** — (clean) six small geometric pixel fragments settle around the card;
  quiet camera drift keeps the hold alive.
- **52.0** — end card lands: the real **VEYLQORIX** lockup card (560 px mark, cream
  paper `#FDFDF9`, 4px navy border, hard pixel shadow; lands 1.06→1.0 and settles
  dead still; 4 pixel scan-bands resolve the lockup top-to-bottom).
- **53.0** — **No Unsafe Code Gets Through.** tagline line under the lockup.
- **55.5** — **Verify before you ship.** final pixel line; stillness held to 60.0,
  no exit.
- **Transition out:** none — final frame holds.
- **SFX:** sfx_006 soft tick on the end-card landing (52.0).

---

## Full timeline (mirrors SCRIPT.md's shot grid)

| Time | Scene | Action | Copy (verbatim) | SFX |
|------|-------|--------|-----------------|-----|
| 0.0 | s1 | still; pixels settling | (still, pixels settling) | — |
| 1.6 | s1 | title lands word-by-word, holds to 4.6 | **Every line of code carries a decision.** | sfx_002 tick |
| 5.6 | s2 | dep-graph draws; coral risk nodes | **But not every change is safe to ship.** | sfx_002 tick |
| 11.3 | s2 | 56 px fragment grows center | — | — |
| 12.4 | s3 | panel → colour flood to dark 12.4–13.2 | — | sfx_005 riser→impact (13.4) |
| 13.6 | s3 | logo lockup: teal scanline + 4-slice stagger | **Meet Veylqorix.** | sfx_002 tick |
| 14.5 | s3 | light sweep; orbit-settle | — | — |
| 15.8 | s3 | pixel tagline below mark, room to 18.8 | **No Unsafe Code Gets Through.** | — |
| 19.5 | s4 | command types 19.5–21.3; modules 21.5–26.5 | `$ veylqorix scan . --json` | — |
| 22.5 | s4 | module 1–2 (change → discover) | **Inspect.** | sfx_002 tick |
| 25.0 | s4 | module 3–4 (scan → normalize + redaction chip) | **Verify.** | sfx_002 tick |
| 26.8 | s4 | outcome chips | **FAIL · exit 1** / **PASS · exit 0** | sfx_003 pop |
| 27.5 | s4 | module 5 (policy) | **Enforce.** | sfx_002 tick |
| 31.2 | s5 | hum begins under the draw | — | sfx_004 hum |
| 31.5 | s5 | engine hub lands; 5 surface cards draw in | **Independent verification.** | sfx_002 tick |
| 34.5 | s5 | lines converge to hub; hub pulses once (teal) | **Before code ships.** | — |
| 40.5 | s6 | system silhouette; teal tick sweep | **Confidence, built into the workflow.** | — |
| 44.0 | s6 | gate trio lands (payoff beat) | **PASS · exit 0** / **FAIL · exit 1** / **INCOMPLETE · exit 2** | sfx_003 pop |
| 49.5 | s7 | pixel fragments settle | (clean) | — |
| 52.0 | s7 | end card lands | **VEYLQORIX** (in lockup) | sfx_006 soft tick |
| 53.0 | s7 | tagline line under lockup | **No Unsafe Code Gets Through.** | — |
| 55.5 | s7 | final line; stillness held to 60.0 | **Verify before you ship.** | — |

*Note: this grid mirrors `SCRIPT.md`, and the SFX clips placed in `index.html`
follow the same map (ticks on sfx_002, pops on sfx_003, riser sfx_005, hum
sfx_004, end-card sfx_006).*

### Transitions (the 5 kinds, no crossfades)

- **fragment-expand** — s2 → s3 (56 px fragment grows into the 900×540 panel)
- **object-becomes-world** — s3 → s4 (the dark panel is the screen)
- **colour flood** — s4 → s5 (mint floods back over the terminal world)
- **blur swap on one stage** — s5 → s6 and s6 → s7
- **dip+hard cut** — terminal-world entry inside s4 (~30.5 s)
