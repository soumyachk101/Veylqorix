/**
 * Story content for the /story section. Facts verified against README.md,
 * CHANGELOG.md, Veylqorix_Diagrams/05_eight_day_roadmap.dot, and the git
 * history of the Veylqorix repository (169 commits at time of writing).
 */

export type Post = {
  slug: string;
  date: string;
  tag: string;
  title: string;
  summary: string;
  /** Ordered blocks of the post body. */
  blocks: Array<
    | { type: 'p'; text: string }
    | { type: 'h2'; text: string }
    | { type: 'quote'; text: string; cite?: string }
    | { type: 'term'; title: string; lines: string[] }
    | { type: 'img'; src: string; alt: string; caption?: string }
    | { type: 'list'; items: string[] }
  >;
};

export const POSTS: Post[] = [
  {
    slug: 'the-gap',
    date: '2026-10-25',
    tag: 'WHY',
    title: 'Why: AI code moves faster than your safety net',
    summary:
      'AI coding agents now write a large share of production code — fast, plausible, and occasionally unsafe. Lint and CI were not designed for that volume. Veylqorix closes the gap.',
    blocks: [
      {
        type: 'p',
        text: 'AI coding agents now write a large share of production code. They are fast and plausible — and occasionally unsafe, in the quiet way that plausible code is: it compiles, it reads fine in review, and it fails only later. Lint and CI pipelines were not designed to verify that volume, at that pace, with that kind of output.',
      },
      {
        type: 'p',
        text: 'Veylqorix fills that gap with a simple stance: verify with real scanners. Dependency auditing via npm audit and pip-audit, offline secret detection across 9 rule families, manifest-level license checks, and quality runs (TypeScript, ESLint, Ruff, test suites). Their output is normalized into a single finding schema, then judged by a deterministic policy gate.',
      },
      {
        type: 'h2',
        text: 'The principle that holds it together',
      },
      {
        type: 'p',
        text: 'A scanner error, or a skipped mandatory check, degrades coverage. It is never mistaken for a clean pass. Veylqorix surfaces incomplete audits instead of green-washing them — a check that cannot run is reported SKIPPED or ERROR with a reason, and the gate reports INCOMPLETE.',
      },
      {
        type: 'quote',
        text: 'No Unsafe Code Gets Through — and no incomplete audit gets called clean.',
      },
    ],
  },
  {
    slug: 'eight-days',
    date: '2026-10-25',
    tag: 'PLAN',
    title: 'Eight days on the board',
    summary:
      'The target roadmap promised a Rust core on day 2. What shipped is a pnpm TypeScript monorepo — because a working MVP mattered more than the target language.',
    blocks: [
      {
        type: 'p',
        text: 'The plan was drawn before the code: an eight-day build roadmap, one target milestone per day, each to be validated before the next. Repository audit first; a core with scanner interfaces early; the integration surface — MCP, GitHub gate, API, dashboard — in the second half; and a reproducible showcase as the finish line.',
      },
      {
        type: 'img',
        src: '/diagrams/05_eight_day_roadmap.png',
        alt: 'Veylqorix eight-day build roadmap from day 1 repository audit to day 8 showcase preparation',
        caption:
          'The target sequence. The diagram depicts the target design — the shipped implementation made an honest pivot along the way.',
      },
      {
        type: 'list',
        items: [
          'Day 1 — repository audit: architecture, baseline tests.',
          'Day 2 — core + CLI: scanner interfaces, tests.',
          'Day 3 — real scanners: dependencies, secrets, static analysis.',
          'Day 4 — MCP + skill: validated tools, client setup.',
          'Day 5 — GitHub gate: hooks, Actions, JSON / SARIF output.',
          'Day 6 — API + dashboard: actual scan data, findings UI.',
          'Day 7 — integration hardening: end-to-end, permissions, bug fixes.',
          'Day 8 — showcase preparation: reproducible demo, docs.',
        ],
      },
      {
        type: 'h2',
        text: 'The honest pivot',
      },
      {
        type: 'p',
        text: 'Day 2 on the board said "Rust core". What shipped is a pnpm TypeScript monorepo: packages/core, a CLI app, an MCP server, a REST API, a Next.js dashboard, and a portable agent skill — all in TypeScript, all buildable with pnpm. The README says this plainly: the diagram depicts the target design, and the implementation kept the same engine/adapter separation with a different substrate. A working, testable MVP with real scanners beat a target-language stub. The gate decision logic, the finding schema, and the adapter architecture — the actual ideas — made it through intact.',
      },
      {
        type: 'quote',
        text: 'The diagram depicts the target design. Today’s implementation is a pnpm TypeScript monorepo with the same engine/adapter separation.',
        cite: 'README.md, How it works',
      },
    ],
  },
  {
    slug: 'incomplete',
    date: '2026-10-25',
    tag: 'PRINCIPLE',
    title: 'The day the gate learned to say INCOMPLETE',
    summary:
      'Exit codes 0, 1, and 2 — and why exit 2 exists: because a scanner that cannot run must never be mistaken for a clean pass.',
    blocks: [
      {
        type: 'p',
        text: 'Most gates have two answers: pass, or fail. Veylqorix has a third, and it is the most important one. The quality gate exits 0 for PASS, 1 for FAIL, and 2 for INCOMPLETE — the state where coverage was degraded: a scanner errored, a mandatory check was skipped, or a required binary was missing.',
      },
      {
        type: 'term',
        title: 'exit codes',
        lines: [
          '0  PASS        no blocking findings',
          '1  FAIL        blocking findings present',
          '2  INCOMPLETE  coverage degraded — never treated as green',
        ],
      },
      {
        type: 'h2',
        text: 'Policy the agent cannot game',
      },
      {
        type: 'p',
        text: 'The gate is driven by a committed policy file. Blocking severities, secret-blocking, test-failure-blocking, and — the key one — blockOnScannerError and blockOnSkippedCheck: the policy explicitly says a broken scanner counts against you, not for you. Exceptions are deliberately unfriendly to gaming: each requires a documented reason, the count is capped by maxExceptions, they can expire, and every gate decision records which exceptions were honored.',
      },
      {
        type: 'term',
        title: 'veylqorix-policy.json',
        lines: [
          '{',
          '  "blockOnSeverity": ["CRITICAL", "HIGH"],',
          '  "blockOnSecrets": true,',
          '  "blockOnTestFailure": true,',
          '  "blockOnScannerError": true,',
          '  "blockOnSkippedCheck": true,',
          '  "reportOnSeverity": ["MEDIUM", "LOW"],',
          '  "maxExceptions": 5,',
          '  "exceptions": []',
          '}',
        ],
      },
      {
        type: 'p',
        text: 'An AI agent cannot suppress findings or raise thresholds without an entry that is present in the committed policy file and visible in every report. Raise the bar? You can — but only with an exception that is documented, capped, expirable, and auditable.',
      },
    ],
  },
  {
    slug: 'one-engine',
    date: '2026-10-25',
    tag: 'ARCHITECTURE',
    title: 'One engine, many surfaces',
    summary:
      'packages/core sits under every front-end. The CLI, the MCP server, and the API are thin adapters that all call the same runAudit and gate functions.',
    blocks: [
      {
        type: 'p',
        text: 'The architectural rule that makes the rest of the system trustworthy: the core engine is independent of every front-end. CLI, MCP, and API are thin adapters that all call the same runAudit and policy/gate functions, so security logic exists in exactly one place and behaves identically everywhere. No surface can drift into its own private notion of "secure".',
      },
      {
        type: 'img',
        src: '/diagrams/04_ai_integrations.png',
        alt: 'Veylqorix AI integration model: clients, skill, MCP, and CLI adapters over one security core',
        caption:
          'AI clients (Claude Code, Codex, Cursor) reach one security core through a portable skill and MCP adapters.',
      },
      {
        type: 'p',
        text: 'The MCP server exposes six tools — scan_repository, scan_dependencies, scan_secrets, run_security_checks, get_findings, validate_fix — with Zod-validated inputs and structured, evidence-based output. Its filesystem access is confined to configured workspace roots: path traversal and symlink escapes are rejected. Secret values are redacted in every response. And the server has no write path at all — it cannot commit, push, or modify the repository it is scanning.',
      },
      {
        type: 'h2',
        text: 'Verify, don’t trust',
      },
      {
        type: 'p',
        text: 'One of the six tools, validate_fix, encodes the whole protocol: after you fix a finding, the scan re-runs to confirm the finding no longer reproduces. Remediation is part of the loop, not a suggestion — a fix is not confirmed without a rescan.',
      },
    ],
  },
  {
    slug: 'the-sync-loop',
    date: '2026-10-26',
    tag: 'PROCESS',
    title: 'Eighty pull requests in eight hours',
    summary:
      'The build was driven by an automated sync loop: 169 commits, 80 merged sync PRs, 18 web-iteration commits — every one with CI running and every action pinned to a commit SHA.',
    blocks: [
      {
        type: 'p',
        text: 'Look at the git log of Veylqorix and the first thing you notice is the cadence: 169 commits, 80 merged sync pull requests, and 18 commits titled "Next.js web application, dashboard components, and API integration" — all of it in roughly eight hours, from the first commit on the evening of October 25 to the early hours of October 26. An automated loop was proposing sync PRs; CI was judging them; the good ones got merged, one after another.',
      },
      {
        type: 'term',
        title: 'git log — the build days',
        lines: [
          'feat(web): Next.js web application, dashboard components, and API integration',
          'chore(web): Next.js web application, dashboard components, and API integration',
          'fix(web): Next.js web application, dashboard components, and API integration',
          'Merge pull request #78 from soumyachk101/sync/20261026023850',
        ],
      },
      {
        type: 'h2',
        text: 'Why boring reproducibility is a security virtue',
      },
      {
        type: 'p',
        text: 'An automated loop is only safe if everything it does is reviewable and repeatable. So the loop ran under a strict pipeline — install, build, test, typecheck, lint — and every GitHub Action was pinned to a commit SHA rather than a moving tag. No unreviewable drift: a change that could not pass the pipeline was not merged, and a merged change could be rebuilt exactly, because nothing in the toolchain was allowed to move underneath it.',
      },
      {
        type: 'p',
        text: 'That is the security lesson in the process itself: determinism you can audit. It is the same philosophy as the engine — no step is trusted because it sounds right; every step shows its evidence, and the boring, pinned, reproducible one is the one that holds.',
      },
    ],
  },
];

export const POST_BY_SLUG: Record<string, Post> = Object.fromEntries(
  POSTS.map((p) => [p.slug, p]),
);
