import Link from 'next/link';
import { Card, Meter, Quote, Section, Table, Terminal } from '@/components/site/ui';

/**
 * Showcase landing page: narrative hero, the four guarantees, the five
 * surfaces, the scanner-adapter table, honesty band, and CTAs into the
 * story / changelog / tour / roadmap sections.
 */

function GateChips() {
  const chips = [
    { code: '0', name: 'PASS', cls: 'bg-teal' },
    { code: '1', name: 'FAIL', cls: 'bg-coral' },
    { code: '2', name: 'INCOMPLETE', cls: 'bg-gold' },
  ];
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {chips.map((c) => (
        <span
          key={c.code}
          className={`pixel-label-sm rounded px-2 py-1 text-screen ${c.cls}`}
        >
          {c.name} · exit {c.code}
        </span>
      ))}
    </div>
  );
}

const GUARANTEES = [
  {
    kicker: 'Guarantee 01',
    title: 'Real evidence, no fabrication',
    body: 'Every finding, severity, and exit code comes from an actual scanner run. A check that cannot run is reported SKIPPED or ERROR with a reason — never a clean pass.',
  },
  {
    kicker: 'Guarantee 02',
    title: 'One engine, many surfaces',
    body: 'CLI, MCP, GitHub Actions, and the dashboard are thin adapters over a single core, so security logic exists in exactly one place and behaves identically everywhere.',
  },
  {
    kicker: 'Guarantee 03',
    title: 'Deterministic gate',
    body: 'Exit codes are stable — 0 PASS, 1 FAIL, 2 INCOMPLETE — so CI branching is predictable and auditable run to run.',
  },
  {
    kicker: 'Guarantee 04',
    title: 'Agent-safe policy',
    body: 'An AI agent cannot suppress findings or raise thresholds: exceptions must be documented, capped, expirable, and visible in the committed policy file and every gate report.',
  },
];

const SURFACES = [
  {
    name: 'CLI',
    status: 'Real scans, deterministic exit codes, safe dry-run hook installer. Not published to npm yet — run from dist/.',
  },
  {
    name: 'MCP server',
    status: 'Six validated tools, root-confinement + redaction. Requires pnpm build.',
  },
  {
    name: 'GitHub Actions gate',
    status: 'Real scan + SARIF upload, all actions pinned to SHAs. Advisory until a branch-protection rule requires the check.',
  },
  {
    name: 'Agent skills',
    status: 'Portable SKILL.md plus MCP configs for Claude Code, Codex, and Cursor.',
  },
  {
    name: 'Dashboard',
    status: 'Live scan data from the API; clearly-labeled DEMO MODE when the API is down.',
  },
];

const ADAPTERS = [
  {
    scanner: 'Dependencies',
    backed: 'npm audit (Node) / pip-audit (Python)',
    offline: 'optional',
  },
  {
    scanner: 'Secrets',
    backed: 'built-in rule set, 9 families — values redacted',
    offline: 'yes',
  },
  {
    scanner: 'Licenses',
    backed: 'manifest-level license checks, copyleft risk',
    offline: 'yes',
  },
  {
    scanner: 'Quality',
    backed: 'tsc, eslint, ruff, project test scripts',
    offline: 'no',
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl space-y-16 px-4 py-10 sm:px-6 sm:py-14">
      {/* ---- Hero ---- */}
      <section aria-labelledby="hero" className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="pixel-label rounded bg-navy px-3 py-1.5 text-mint">
              No Unsafe Code Gets Through
            </span>
            <span className="pixel-label text-teal-deep">showcase</span>
          </div>
          <h1
            id="hero"
            className="text-pixel-shadow mt-6 max-w-2xl text-4xl font-extrabold leading-[1.05] tracking-tight text-ink sm:text-5xl"
          >
            Verify the code your agents wrote.{' '}
            <span className="text-teal-deep">Before it ships.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-dim">
            Veylqorix independently verifies AI-generated and human-written code
            before it is committed, pushed, merged, or deployed. It orchestrates
            real scanners — dependency auditing, secret detection, license
            checks, static analysis, and test suites — normalizes their output
            into one finding schema, and turns it into a deterministic gate
            decision with auditable evidence.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link href="/story" className="btn-primary text-base">
              Read the build story
            </Link>
            <Link href="/changelog" className="btn-secondary text-base">
              See the changelog
            </Link>
          </div>
        </div>

        <Terminal title="veylqorix / gate-decision (illustrative)">
          <p className="text-screen-dim">$ veylqorix scan . --json</p>
          <p className="mt-2">
            <span className="text-mint">23 findings</span> · 2 critical · 5
            high · 8 medium · 8 low
          </p>
          <div className="mt-3 space-y-2">
            <p>
              <span className="text-coral">CRIT</span> secret: AWS access key
              in config.js:12 — AKIA…CDEF (20 chars, redacted)
            </p>
            <p>
              <span className="text-gold">HIGH</span> vulnerable dependency:
              lodash@4.17.15
            </p>
            <p>
              <span className="text-mint">MED</span> license risk: GPL
              dependency in an MIT project
            </p>
          </div>
          <GateChips />
          <p className="mt-4 border-t-2 border-line-soft pt-3 text-[11px] text-screen-dim">
            Illustrative output. Exit 2 (INCOMPLETE) means degraded coverage —
            never a clean pass.
          </p>
        </Terminal>
      </section>

      {/* ---- Four guarantees ---- */}
      <Section id="why" kicker="Why Veylqorix" title="Four guarantees">
        <p className="mb-6 max-w-3xl text-base leading-relaxed text-ink-dim">
          AI coding agents now write a large share of production code — fast,
          plausible, and occasionally unsafe. Lint and CI pipelines were not
          designed to verify that volume. Veylqorix fills the gap:
        </p>
        <div className="grid gap-6 sm:grid-cols-2">
          {GUARANTEES.map((g) => (
            <Card key={g.title} press title={g.kicker}>
              <h3 className="text-lg font-bold text-navy">{g.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-dim">{g.body}</p>
            </Card>
          ))}
        </div>
      </Section>

      {/* ---- Surfaces ---- */}
      <Section id="surfaces" kicker="One engine, many surfaces" title="Where Veylqorix plugs in">
        <p className="mb-6 max-w-3xl text-base leading-relaxed text-ink-dim">
          Every surface is a thin adapter over the same core engine
          (<code className="font-mono text-sm">packages/core</code>), so there
          is exactly one place where security logic lives:
        </p>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {SURFACES.map((s, i) => (
            <Card key={s.name} press>
              <div className="flex items-center justify-between gap-3">
                <h3 className="pixel-label text-navy">{s.name}</h3>
                <span className="pixel-label-sm text-teal-deep">{String(i + 1).padStart(2, '0')}</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-ink-dim">{s.status}</p>
            </Card>
          ))}
          <Card screen>
            <p className="pixel-label text-mint">Honest note</p>
            <p className="mt-3 text-sm leading-relaxed">
              The gate and the CLI hooks are <strong>advisory</strong> until
              enforcement is in place — a branch-protection rule that requires
              the check, or a published CLI. Findings are produced and the check
              fails; a merge can still be forced. That is stated everywhere,
              never hidden.
            </p>
          </Card>
        </div>
      </Section>

      {/* ---- Scanner adapters ---- */}
      <Section id="adapters" kicker="How it works" title="Scanner adapters reuse real tools">
        <Table
          head={['Scanner', 'Backed by', 'Offline?']}
          rows={ADAPTERS.map((a) => [a.scanner, a.backed, a.offline])}
        />
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <Card press>
            <img
              src="/diagrams/01_system_architecture.png"
              alt="Veylqorix system architecture: entry points, integration layer, core engine, and results surfaces"
              className="w-full rounded border-2 border-line-soft"
            />
            <p className="mt-3 text-xs text-ink-dim">
              System architecture — entry points reach one core engine; results
              fan out to CLI, API, and CI surfaces.
            </p>
          </Card>
          <Card press>
            <img
              src="/diagrams/02_scan_lifecycle.png"
              alt="Veylqorix scan lifecycle from code change to verified gate decision"
              className="w-full rounded border-2 border-line-soft"
            />
            <p className="mt-3 text-xs text-ink-dim">
              Scan lifecycle — normalize before judging, gate failures are
              first-class, verify don&apos;t trust.
            </p>
          </Card>
        </div>
      </Section>

      {/* ---- Honesty band ---- */}
      <Section id="honesty" kicker="Honest limitations" title="What Veylqorix is not">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="border-coral" screen>
            <p className="pixel-label text-gold">Read this first</p>
            <ul className="mt-4 list-disc space-y-3 pl-5 text-sm leading-relaxed">
              <li>
                Veylqorix reports what its scanners found. It does not certify
                the <em>absence</em> of vulnerabilities or secrets.
              </li>
              <li>
                A scanner that cannot run makes the gate INCOMPLETE (exit 2) —
                degraded coverage is surfaced, never green-washed.
              </li>
              <li>
                Regex secret detection has false positives and negatives; it
                complements tools like Gitleaks, it does not replace them.
              </li>
              <li>
                License scanning is manifest-level, not a transitive license
                audit. A clean quality check is not a security certification.
              </li>
            </ul>
          </Card>
          <Quote cite="docs/faq.md — honest limitations">
            A check that cannot run is reported SKIPPED or ERROR with a reason.
            Veylqorix surfaces incomplete audits instead of green-washing them.
          </Quote>
        </div>
      </Section>

      {/* ---- CTA ---- */}
      <Section id="explore" kicker="Keep going" title="The full story, in three places">
        <div className="grid gap-6 sm:grid-cols-3">
          <Link href="/story" className="pixel-box press block p-5">
            <p className="pixel-label text-teal-deep">Story</p>
            <p className="mt-2 text-base font-bold text-navy">How it was built</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-dim">
              Five diary-style posts: the gap, the eight-day board, INCOMPLETE,
              one engine, and the sync loop.
            </p>
          </Link>
          <Link href="/changelog" className="pixel-box press block p-5">
            <p className="pixel-label text-teal-deep">Changelog</p>
            <p className="mt-2 text-base font-bold text-navy">0.1.0 → 0.1.1</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-dim">
              Every release, every group of changes, and the release checklist
              with what&apos;s still open.
            </p>
          </Link>
          <Link href="/tour" className="pixel-box press block p-5">
            <p className="pixel-label text-teal-deep">Tour</p>
            <p className="mt-2 text-base font-bold text-navy">Inside the platform</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-dim">
              CLI, MCP, API, dashboard, GitHub gate, security model, and
              community ground rules.
            </p>
          </Link>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link href="/roadmap" className="btn-secondary">
            The eight-day roadmap
          </Link>
          <a
            href="https://github.com/soumyachk101/Veylqorix"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
          >
            GitHub repository
          </a>
          <Meter
            total={5}
            filled={3}
            label="checklist: 3 of 5 release items open"
          />
        </div>
      </Section>
    </div>
  );
}
