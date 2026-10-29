# Veylqorix Launch Film — 9:16 Social Cutdown

A 9:16 (1080x1920) portrait social cutdown of the 16:9 Veylqorix launch film
(`../veylqorix-launch-film`). Same 60-second runtime, same content, same
timing, same audio bed; every scene re-laid out for portrait with a
center-weighted composition and full-bleed backgrounds.

## Layout

- `index.html` — main composition (1080x1920, 60s, root timeline)
- `compositions/` — 7 sub-compositions, s1–s7, at the same host times as the
  16:9 film (0–5, 5–12, 12–19, 19–31, 31–40, 40–49, 49–60)
- `assets/` — shared fonts, logo pngs, bgm, sfx (copied from the 16:9 project)
- `meta.json` — project metadata
- `hyperframes.json` — HyperFrames project config (identical to the 16:9 film)

## Commands

```bash
npm run dev      # npx hyperframes@0.8.201 preview (foreground)
npm run check    # npx hyperframes@0.8.201 check
npm run render   # npx hyperframes@0.8.201 render -o veylqorix-launch-film-9x16.mp4
npm run publish  # npx hyperframes@0.8.201 publish
```

Snapshot for frame review: `npx hyperframes@0.8.201 snapshot --at 1,3,5`.
