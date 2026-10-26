# Veylqorix Launch Film — Brand Design Reference

Source of truth: live capture of https://veylqorix.vercel.app (`capture/extracted/tokens.json`),
verified repo assets, and `SPEC.md`.

## Palette (verified CSS custom properties from the live site)

| Role | Token | Hex | Use in film |
|---|---|---|---|
| Ground | `--color-bg` | `#E7F4EC` | Mint-tinted off-white world — the film's home stage |
| Surface | `--color-surface` / `--color-surface-2` | `#FFFFFF` / `#EEF7F1` | Cards, panels |
| Screen | `--color-screen` / `--color-screen-2` | `#0C2334` / `#0E2A3D` | Terminal/gate surfaces ("the screen"), end card accents |
| Screen ink | `--color-screen-ink` | `#E9F7F3` | Text on dark screens |
| Screen dim | `--color-screen-dim` | `#7FA6A8` | Secondary text on screens |
| Ink | `--color-ink` | `#0E2A3D` | Primary text on light ground |
| Ink dim | `--color-ink-dim` | `#3C5B6A` | Supporting text |
| Teal | `--color-teal` | `#14B3AD` | Verified structure, PASS, accents |
| Mint | `--color-mint` | `#6FE9E2` | PASS state, highlights on dark |
| Gold | `--color-gold` | `#F0AC1B` | Warnings / the one warm accent |
| Coral | `--color-coral` | `#EF5F5F` | BLOCK state, risk accents |
| Lavender | (logo) | `#9A8CF5` | Secondary fragment in logo + scene accents |

Note: the brief's starting palette (ivory `#FAF8F3`, navy `#17243A`, teal `#43C8B8`…) was
superseded by the verified site tokens above. The logo's own colors: navy `#16283C`-ish,
teal, lavender, coral, cream paper `#FDFDF9`.

## Typography (the site's own files, in `assets/fonts/`)

- **Hanken Grotesk** (variable, 400–800) — display and headlines. Film titles: 800, tight
  tracking (−0.03em), 70–150 px.
- **JetBrains Mono** (variable, 400–700) — all technical text, terminal content, labels:
  20–32 px.
- **Press Start 2P** (400) — the pixel signature: tiny labels (14–20 px), scanlines,
  badge corners. Used sparingly: 2–3 elements max per scene.

## Signature motifs (measured from the site)

- Hard pixel shadows: `4px 4px 0 rgba(15,44,64,0.16)` on light surfaces.
- Dark "screen" panels with pixel-corner ticks and mono chrome.
- Severity chips: CRIT (coral), HIGH (gold/coral), MED (gold), LOW (dim).
- Gate decision: PASS (teal/mint) · exit 0 / FAIL (coral) · exit 1 / INCOMPLETE (gold) · exit 2.
- Scan command line: `veylqorix scan . --json`, "23 findings · 2 critical · 5 high · 8 medium · 8 low".
- Logo: geometric "V" mark — navy sweep + overlapping translucent teal/lavender tiles +
  offset square pixels (coral/lavender/navy), with a coral square dot over the "i".

## Banned in this film

- The brief's cream palette (not the site's), neon glows, particles, gradient rainbow washes.
- Generic "shield" imagery, emoji, stock footage, terminal walls of random commands.
- Any claim of a feature not in the repo (see `SPEC.md` §Claims). No fabricated stats,
  customer logos, or speed claims. The Rust engine is shown as real but new (v0.1.0),
  not production-proven at scale.
