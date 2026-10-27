# Veylqorix Launch Film

The Veylqorix launch film: a 60-second, 1920×1080 @ 30 fps H.264 MP4 that makes one thing
clear — Veylqorix independently verifies code (AI-written or human) before it ships: one
engine, real scanners, a deterministic gate (0 PASS / 1 FAIL / 2 INCOMPLETE), across CLI,
GitHub Actions, MCP, agent skills and the dashboard/API. No voiceover. A licensed-free
cinematic music bed (`assets/bgm/track.wav`, generated locally with MusicGen via
`/media-use`) spans the full 60 s under the sparse SFX accent bed (ticks, pops, one
riser-impact, a 5.5 s hum, a soft end-card tick).

## Commands (pinned hyperframes@0.8.201)

```bash
npm run check                          # lint + runtime + layout + motion + contrast
npx hyperframes snapshot --at 1,3,5    # PNG frames at those seconds — look before you render
npx hyperframes preview --background   # agent-safe persistent Studio preview (handoff)
npx hyperframes preview --status       # verify the persistent preview is listening
npx hyperframes preview --stop         # stop it when review is finished
npm run render                         # render to MP4
npm run publish                        # publish and get a shareable link
```

All scripts pin `hyperframes@0.8.201` so the film re-renders identically over time.
`npm run dev` also exists but is a human-operated foreground preview; agents use
`npx hyperframes preview --background` for Studio handoff.

## Output

`npm run render` writes to `renders/veylqorix-launch-film_<YYYY-MM-DD>_<HH-MM-SS>.mp4`
(the pinned CLI's default output pattern, `<project>` from `meta.json`). For a stable,
fixed name — e.g. `veylqorix-launch-film.mp4` at the project root — pass the output
flag: `npx hyperframes@0.8.201 render -o veylqorix-launch-film.mp4`. Default quality is
`looks` (CRF 16); use `-q delivery` for the final master.

## Project structure

- `index.html` — host composition: the 60 s root timeline. One scene host per
  sub-composition (`s1`–`s7`, slots 0–5 / 5–12 / 12–19 / 19–31 / 31–40 / 40–49 / 49–60),
  plus the SFX `<audio>` clips on tracks 20–30.
- `compositions/` — the seven scene files, referenced via `data-composition-src`:
  `s1-silence.html`, `s2-complexity.html`, `s3-reveal.html`, `s4-pipeline.html`,
  `s5-engine.html`, `s6-confidence.html`, `s7-endcard.html`.
- `assets/` — verified logo PNGs (`logo-icon.png`, `logo-lockup.png`,
  `logo-wordmark.png`, `tagline-text.png`, `wordmark-text.png`), the site font files
  (`assets/fonts/`: Hanken Grotesk, JetBrains Mono, Press Start 2P woff2), bundled SFX
  (`sfx_001`–`sfx_006.mp3`), and the site reference capture (`site-fullpage.png`).
- `capture/` — the website-capture source: live-capture of
  https://veylqorix.vercel.app with the extracted brand tokens
  (`capture/extracted/tokens.json`) that every colour decision is verified against.
- `.media/` — proxied media registry (`manifest.jsonl` + `index.md`): the SFX sources
  in `.media/audio/sfx/` that `assets/` files mirror for the render.
- `STORYBOARD.md` — scene-by-scene shot breakdown + full timeline table.

## Where the brand truth lives

- `SPEC.md` — the SPEC: verified brand tokens (mint ground `#E7F4EC`, dark "the screen"
  `#0C2334`/`#0E2A3D`, teal `#14B3AD`, mint `#6FE9E2`, coral `#EF5F5F`, gold `#F0AC1B`,
  lavender `#9A8CF5`), materials, motion rules, the 5 transition kinds, and the claims
  list.
- `DESIGN.md` — the design reference: palette roles, typography, signature motifs, and
  the banned list.
- `SCRIPT.md` — the timing truth: the shot grid (verbatim copy + landing times),
  the hard beats (5, 12, 19, 31, 40, 49 s; payoff at 44; mark at 52) and the SFX map.

### Claims-accuracy rule

Only repo-verified claims may appear on screen (the `SPEC.md` §Claims list). No
fabricated stats, customer logos, or speed claims. The Rust engine is real but early —
v0.1.0, JSON-stdio, in repo — and is always labelled early-stage; **never
"production"** or "shipped everywhere". The scan output line
(`23 findings · … · 8 low`) is the site's own labelled-illustrative hero output; keep
the framing abstract/conceptual and keep the "illustrative" label visible.

## How to re-render

From this folder:

```bash
npx hyperframes check                 # lint + runtime + layout + motion + contrast
npx hyperframes preview --background  # studio handoff (agent-safe)
npm run render                        # → veylqorix-launch-film.mp4 (1920×1080, 30 fps, H.264 + AAC)
npx hyperframes preview --stop        # stop the persistent preview when done
```

If a render fails on memory, set `GENERATE_WEBM=false` or drop to a single worker /
lower concurrency per the `hyperframes-cli` rendering reference. The music bed is a
local asset (`assets/bgm/track.wav`); a missing or regenerating track never blocks a
picture render. To regenerate it: `pip install transformers torch soundfile numpy`
(into a Python 3.10–3.12 venv), then re-run the `/media-use` BGM generate step for a
60 s target and overwrite `assets/bgm/track.wav`.

## Production report

`npm run render` writes `veylqorix-launch-film.mp4` at the project root.

| Field | Value |
| --- | --- |
| Duration | ~60 s |
| Resolution | 1920×1080 |
| Frame rate | 30 fps |
| Video codec | H.264 |
| Audio | AAC (music bed + SFX accents present) |
| Music bed | present, 0–60 s, generated via local MusicGen |
| Render status | — |
| Known limitations | no voiceover; scan output line is labelled illustrative |

## SFX bed — aligned to the script map

The host (`index.html`) audio clips follow `SCRIPT.md`'s SFX map exactly: sfx_002
ticks on each title landing (1.6, 5.6, 13.6, 22.5, 25.0, 27.5, 31.5), sfx_003 pops on
chips (26.8, 44.0), sfx_005 riser-impact at 13.4, sfx_004 hum 31.2 for 5.5 s, sfx_006
soft tick at 52.0. `STORYBOARD.md` carries the same map.
