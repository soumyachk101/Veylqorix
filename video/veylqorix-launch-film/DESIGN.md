# Design — Veylqorix Launch Film

Visual identity for the 50–60 second launch film. Every scene, transition, and
end frame in `STORYBOARD.md` obeys these rules.

## Palette

Reconciled with the verified site design tokens (`apps/web/src/app/globals.css`,
identical in `veylqorix-website`):

| Role | Colour | Hex | Note |
|------|--------|-----|------|
| Ground / paper | Mint-cream | `#e7f4ec` | Site `--color-bg`; the brief's warm ivory `#FAF8F3` and the logo.png cream `#fdfdf9` stay the ivory family for end cards |
| Structure / type | Deep navy | `#0f2c40` | Site `--color-ink` |
| Verified / active | Muted teal | `#14b3ad` | Site `--color-teal` (deep `#0c8a86`) |
| PASS state | Soft mint | `#6fe9e2` | Site `--color-mint` |
| BLOCK / risk | Coral | `#ef5f5f` | Site `--color-coral` (faint `#a83232`) |
| Highlight accent | Warm yellow | `#f0ac1b` | Site `--color-gold` |
| Secondary accent | Lavender | `#b8a8f8` | Not a site token — exists only in the logo mark; use sparingly |

Typography is the site's set: Hanken Grotesk (sans), JetBrains Mono (code),
Press Start 2P (pixel labels); pixel signature is 4px hard borders with a
`4px 4px 0 rgba(15,44,64,0.16)` offset shadow.

Use coral sparingly — only for risk and BLOCK. Muted teal and soft mint carry
"verified" and "PASS." Everything else lives on the mint-cream ground with
deep navy.

## Material rules

- Glass, ceramic, and brushed metal only. Surfaces read as engineered, not
  consumer-glossy.
- Soft contact shadows under dimensional objects; no hard drop shadows, no
  glowing halos.
- No plastic look: no high-gloss reflections, no specular blowouts.

## Motifs

- **Pixel grid**: a thin architectural grid underlies every scene; transitions
  resolve or dissolve through it.
- **Digital disintegration**: fragments, code lines, and data break apart and
  reassemble between states — used deliberately, never as noise.
- Both motifs are tied to the wordmark: the Veylqorix mark is pixel-inspired
  and must appear as-is (never redesigned, never redrawn).

## Typography

- Refined modern sans. Large, confident headlines.
- High contrast: deep navy on warm ivory, ivory on deep navy.
- Minimal copy — one idea per frame. No paragraphs on screen.

## Motion language

- Macro-to-micro transitions: pull back from the system into a single pixel,
  or expand one fragment into a whole structure.
- Dolly and parallax for depth; dimensional type that reads as solid, not
  flat.
- All motion lives on deterministic, seekable GSAP timelines. No random
  timers, no `Date.now()`, no `Math.random()`.

## Prohibited (strict)

- No neon green, no neon pink.
- No glowing cyan.
- No rainbow gradients.
- No cyberpunk styling.
- No emoji logos.
- No generic "AI shield" iconography.
- No Ditto branding of any kind.
- No Apple footage or Apple trademarks.
