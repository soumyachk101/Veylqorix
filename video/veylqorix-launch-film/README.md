# Veylqorix Launch Film

A 50–60 second HyperFrames launch film: 16:9, 1920×1080 minimum, 30 fps,
MP4/H.264, AAC audio. Production documents: `STORYBOARD.md` (scene table),
`SCRIPT.md` (narration + timing), `DESIGN.md` (visual identity).

## Commands

Confirmed against the installed CLI: the project pins `hyperframes@0.8.201`
in its npm scripts (pulled via npx; 0.8.207 is currently in the npx cache).
Run from `video/veylqorix-launch-film/`:

```bash
npm run dev     # foreground Studio preview (agent-safe: npx hyperframes preview --background)
npm run check   # lint + runtime + layout + motion + contrast
npx hyperframes snapshot --at 0,5,12,19,31,40,49   # frames at scene boundaries
npm run render  # render to veylqorix-launch-film.mp4 (H.264 + AAC)
npm run publish # publish and get a shareable link
```

## Project layout

```
video/veylqorix-launch-film/
├── index.html            # root composition / host timeline
├── compositions/         # one file per scene (S1–S7)
├── assets/               # logos, wordmark, fonts, audio
├── STORYBOARD.md         # scene table with timings
├── SCRIPT.md             # narration script + caption/timing table
├── DESIGN.md             # palette, materials, motifs, motion, prohibited list
├── hyperframes.json      # project config
└── meta.json             # project metadata
```

## Re-rendering

1. Preview the film and snapshot key frames (scene boundaries at 0, 5, 12,
   19, 31, 40, 49 s) to verify on-screen copy and transitions.
2. Run `npm run check`; fix errors before rendering.
3. Render to MP4/H.264 with AAC audio (`npm run render`).
4. Spot-check the output: duration 50–60 s, 1920×1080, 30 fps.

## Known limitations

- `@veylqorix/cli` is not yet published to npm; non-monorepo use requires the
  repo or a prebuilt binary.
- The GitHub Actions gate workflow is advisory until branch protection is set
  by the caller — do not present it as blocking CI.
- S4/S6 outcome copy reads BLOCK · exit 1 / PASS · exit 0 / INCOMPLETE · exit 2, matching the CLI's real exit codes.
- Narration lines referencing scanners or integrations are verified against
  implementation status in `SCRIPT.md` (claims-accuracy verdict).
