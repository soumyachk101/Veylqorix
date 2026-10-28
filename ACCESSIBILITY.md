# Veylqorix Accessibility Statement

Veylqorix commits to making its user-facing surfaces — the web dashboard and
landing page, the CLI, and the documentation — usable by the widest possible
audience, including people with disabilities.

## Supported environments

- **Dashboard** (`apps/web`): tested with keyboard navigation and screen
  readers in current Chrome, Firefox, and Safari on macOS; responsive layout
  verified down to 360px width.
- **CLI** (`apps/cli`): machine-readable output (`--json`, `--format
  markdown|json|sarif`) is available so findings can be consumed by any
  assistive or automated tooling, not just a human reading a terminal.

## What we do

- **Accessible color contrast.** The dashboard uses an original design system
  with contrast ratios chosen for legibility; status is never communicated by
  color alone (PASS / FAIL / INCOMPLETE and LIVE / DEMO MODE are always
  labeled with text).
- **Keyboard navigation.** All interactive dashboard elements are reachable
  and operable without a mouse.
- **Plain-text-first design.** No emoji, no text-in-image that matters. The
  diagrams in `Veylqorix_Diagrams/` currently ship as PNGs without editable
  sources (the `.dot` sources are on the roadmap, per
  `Veylqorix_Diagrams/README.md`); the documented prose equivalent of their
  substance is the relevant `docs/` page (`docs/engine.md`,
  `docs/github-actions.md`, `docs/mcp.md`, `docs/plugin.md`,
  `docs/dashboard.md`) and, for the archived eight-day build plan, the
  Roadmap section of `README.md`.
- **Honest labeling.** Demo data is always labeled **DEMO MODE**; a demo is
  never presented as a live scan result.

## Known limitations

- The dashboard (Next.js) is not yet audited against a formal
  WCAG level (a WCAG 2.1 AA audit is on the roadmap).
- The API has no screen-reader-oriented alternative view; clients that need
  one should consume the CLI's Markdown or SARIF output instead.

## Reporting barriers

If you encounter an accessibility issue, please open an issue with the
[bug report template](.github/ISSUE_TEMPLATE/bug_report.md) and include:

1. The affected surface (dashboard, CLI, docs) and the URL or command.
2. Browser/OS version and any assistive technology in use.
3. What happened, and what you expected.

You can also reach the maintainer directly via a GitHub issue. Accessibility
reports are triaged by the maintainer (`soumyachk101`) alongside functional
bugs; there is no separate SLA, and they are treated with the same priority
as functional bugs.
