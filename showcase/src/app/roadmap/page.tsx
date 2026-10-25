import Link from 'next/link';
import type { Metadata } from 'next';
import { Card, Meter, Section } from '@/components/site/ui';

export const metadata: Metadata = {
  title: 'Roadmap',
  description:
    'The Veylqorix eight-day build roadmap, where the project stands now, and what is next — target design vs. shipped MVP, honestly framed.',
};

const DAYS = [
  {
    day: 'Day 1',
    focus: 'Repository audit',
    detail: 'Architecture review and baseline tests — know what you are about to verify.',
  },
  {
    day: 'Day 2',
    focus: 'Core + CLI',
    detail: 'Scanner interfaces and a working command line, with tests.',
  },
  {
    day: 'Day 3',
    focus: 'Real scanners',
    detail: 'Dependencies, secrets, and static analysis — the evidence layer.',
  },
  {
    day: 'Day 4',
    focus: 'MCP + Skill',
    detail: 'Validate the agent tools and wire up client setup.',
  },
  {
    day: 'Day 5',
    focus: 'GitHub gate',
    detail: 'Hooks, Actions, and JSON / SARIF output for CI.',
  },
  {
    day: 'Day 6',
    focus: 'API + Dashboard',
    detail: 'Actual scan data and a findings UI on top of it.',
  },
  {
    day: 'Day 7',
    focus: 'Integration hardening',
    detail: 'End-to-end flow, least-privilege permissions, bug fixes.',
  },
  {
    day: 'Day 8',
    focus: 'Showcase preparation',
    detail: 'A reproducible demo, docs, and slides you can stand behind.',
  },
];

const DONE = [
  'Core engine with deterministic gate (0 PASS / 1 FAIL / 2 INCOMPLETE)',
  'CLI, MCP server, REST API, and web dashboard shipped and tested',
  'Reusable, SHA-pinned GitHub Actions gate with SARIF upload',
  'Portable agent skill for Claude Code, Codex, and Cursor',
  'Honest demo-mode dashboard that never fakes live data',
];

const OPEN = [
  'Publish @veylqorix/cli to the npm registry — non-monorepo callers need it',
  'Gitleaks integration for higher-fidelity secret detection',
  'GitHub Actions branch-protection guide with screenshots',
];

export default function RoadmapPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-16 px-4 py-10 sm:px-6 sm:py-14">
      <Section kicker="Roadmap" title="The eight-day board">
        <p className="max-w-3xl text-base leading-relaxed text-ink-dim">
          The plan was a target sequence for a showcase-ready MVP, one
          validated milestone per day. The diagram below is the target design —
          the shipped implementation kept the same engine/adapter ideas with a
          different substrate, and this page says so plainly.
        </p>
        <Card press className="mt-6">
          <img
            src="/diagrams/05_eight_day_roadmap.png"
            alt="Veylqorix eight-day build roadmap from day 1 repository audit to day 8 showcase preparation"
            className="w-full rounded border-2 border-line-soft"
          />
          <p className="mt-3 text-xs text-ink-dim">
            Eight-day build roadmap — target sequence, each milestone validated
            before the next.
          </p>
        </Card>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {DAYS.map((d, i) => (
            <Card key={d.day} press>
              <div className="flex items-center justify-between gap-2">
                <p className="pixel-label text-teal-deep">{d.day}</p>
                <Meter total={8} filled={i + 1} label={`${i + 1} / 8`} />
              </div>
              <h3 className="mt-3 text-base font-bold text-navy">{d.focus}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-dim">{d.detail}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section kicker="Where we are now" title="Shipped vs. the board">
        <p className="max-w-3xl text-base leading-relaxed text-ink-dim">
          The board said “Rust core” on Day 2. What actually shipped is a pnpm
          TypeScript monorepo — because a working, testable MVP beat a
          target-language stub. The gate logic, finding schema, and adapter
          architecture made it through intact.
        </p>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card press title="Done">
            <Meter total={DONE.length} filled={DONE.length} label={`${DONE.length} milestones landed`} />
            <ul className="mt-4 space-y-2.5">
              {DONE.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-relaxed text-ink-dim">
                  <span className="mt-1.5 h-3 w-3 shrink-0 rounded-[2px] border-2 border-line bg-teal" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card press title="Still open">
            <Meter total={3} filled={0} color="var(--color-gold)" label={`${OPEN.length} items in flight`} />
            <ul className="mt-4 space-y-2.5">
              {OPEN.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-relaxed text-ink-dim">
                  <span className="mt-1.5 h-3 w-3 shrink-0 rounded-[2px] border-2 border-line bg-gold" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Section>

      <Section kicker="What is next" title="From advisory to enforced">
        <div className="grid gap-6 lg:grid-cols-3">
          <Card press>
            <p className="pixel-label text-teal-deep">Publish the CLI</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-dim">
              Release <code className="font-mono text-xs">@veylqorix/cli</code>{' '}
              to the registry so repositories outside this monorepo can run the
              gate directly.
            </p>
          </Card>
          <Card press>
            <p className="pixel-label text-teal-deep">Gitleaks adapter</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-dim">
              Point the scanner registry at Gitleaks for higher-fidelity secret
              detection, alongside the built-in rule families.
            </p>
          </Card>
          <Card press>
            <p className="pixel-label text-teal-deep">Branch-protection guide</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-dim">
              A screenshot-backed guide to requiring the gate status check, so
              the gate stops being advisory and starts blocking merges.
            </p>
          </Card>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link href="/changelog" className="btn-primary">
            See what shipped in 0.1.0 and 0.1.1
          </Link>
          <Link href="/story/eight-days" className="btn-secondary">
            The eight-day post
          </Link>
        </div>
      </Section>
    </div>
  );
}
