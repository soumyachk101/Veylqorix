---
name: Feature request
about: Suggest a new feature or improvement for Veylqorix
title: 'feat: '
labels: enhancement
assignees: soumyachk101
---

## The problem

What problem does this solve? (e.g. a scanner that can't run, a surface that's
missing, a policy gap.)

## Proposed solution

Describe the feature you'd like, and which surface it should land on:

- [ ] Core engine (`packages/core`)
- [ ] CLI (`apps/cli`)
- [ ] MCP server (`packages/mcp-server`)
- [ ] API / dashboard (`packages/api`, `apps/web`)
- [ ] GitHub Actions gate
- [ ] Skills (`packages/skills`)

## Constraints to respect

Veylqorix has non-negotiable rules (see [CONTRIBUTING.md](../../CONTRIBUTING.md)):

- No fabricated results — a check that can't run must report SKIPPED / ERROR,
  never a clean pass.
- Never weaken the gate to make a test pass.
- Secrets stay redacted in every output path.
- No new dependencies without justification.

If your proposal would conflict with any of these, say so explicitly — that
discussion is welcome.

## Alternatives considered

Other tools or approaches that address the same problem.

## Additional context

Anything else that helps evaluation.
