# Script — Veylqorix Launch Film

Narration script for the 50–60 second launch film. The narration is sparse and
confident; most of the film carries its meaning through on-screen copy and motion.

## Narration lines

```
Every change begins with code.
But before it ships, it deserves verification.
Dependencies. Secrets. Security. Quality.
One unified approach to understanding risk and enforcing policy.
Veylqorix.
No Unsafe Code Gets Through.
```

## Caption / timing table

Each narration line maps to scene timecodes (host-timeline seconds).

| Narration line | Timecode | Scene |
|----------------|----------|-------|
| `Every change begins with code.` | 0:02 – 0:05 | S1 (0–5s) |
| `But before it ships, it deserves verification.` | 0:07 – 0:12 | S2 (5–12s) |
| `Dependencies. Secrets. Security. Quality.` | 0:14 – 0:19 | S3–S4 boundary (12–19s) |
| `One unified approach to understanding risk and enforcing policy.` | 0:20 – 0:31 | S4 (19–31s) |
| `Veylqorix.` | 0:32 – 0:36 | S5 (31–40s) |
| `No Unsafe Code Gets Through.` | 0:44 – 0:49 | S6 (40–49s) |

If the film lands at the 50-second end of the spec rather than 60, compress S7 to
49–55s and hold the final frame to 55s; the caption table scales proportionally.

## Claims-accuracy verdict (verified 2026-10-28 against the repo)

- "Dependencies. Secrets. Security. Quality." — accurate as written.
  Dependency audit (npm/pip), secret detection (offline regex rules, values
  masked at source), and quality checks (ESLint, Ruff, TypeScript, tests)
  are implemented scanners. "Security" = secret detection + policy
  evaluation; no SAST scanner (Semgrep/CodeQL) is wired, so do not voice
  "Security." as a SAST service.
- "One unified approach to understanding risk and enforcing policy." —
  accurate: the policy engine is implemented with a default
  `veylqorix-policy.json` at the repo root.
- GitHub Actions: the reusable gate workflow exists
  (`.github/workflows/veylqorix-gate.yml`) but is advisory until branch
  protection is set by the caller — never voice it as blocking CI.
- MCP server, CLI, and the Rust engine (`crates/veylqorix-engine`) are real
  and wired; the film's "static analysis" module maps to ESLint under quality
  checks, which is a genuine static-analysis tool.
- `@veylqorix/cli` is not yet published to npm — keep any CLI line scoped to
  "available via the repo" if it is voiced at all.
