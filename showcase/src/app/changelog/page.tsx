import Link from 'next/link';
import type { Metadata } from 'next';
import {
  RELEASES,
  RELEASE_CHECKLIST_DONE,
  RELEASE_CHECKLIST_OPEN,
  SYNC_STRIP,
  type Release,
} from '@/data/changelog';
import { Card, Meter, Section, Terminal } from '@/components/site/ui';

export const metadata: Metadata = {
  title: 'Changelog',
  description:
    'Veylqorix release history: 0.1.0 first public build and 0.1.1 dashboard, MCP, and CI pinning — plus the release checklist.',
};

function ChecklistBlocks({ items, label, tone }: { items: string[]; label: string; tone: 'teal' | 'gold' }) {
  return (
    <div className="min-w-0">
      <Meter total={items.length} filled={items.length} color={tone === 'teal' ? 'var(--color-teal)' : 'var(--color-gold)'} label={`${label} · ${items.length}`} />
      <ul className="mt-4 space-y-2.5">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-sm leading-relaxed text-ink-dim">
            <span
              className={`mt-1.5 h-3 w-3 shrink-0 rounded-[2px] border-2 border-line ${tone === 'teal' ? 'bg-teal' : 'bg-gold'}`}
              aria-hidden="true"
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReleaseCard({ release, featured }: { release: Release; featured: boolean }) {
  const groups = release.groups.length;
  return (
    <article className={`pixel-box p-5 sm:p-7 ${featured ? 'border-gold' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`pixel-label-sm rounded px-2.5 py-1.5 text-screen ${release.tone === 'gold' ? 'bg-gold' : 'bg-teal'}`}
          >
            v{release.version}
          </span>
          <span
            className={`pixel-label-sm rounded px-2.5 py-1.5 ${release.tone === 'gold' ? 'bg-surface-2 text-gold-faint' : 'bg-surface-2 text-teal-deep'}`}
          >
            {release.chip}
          </span>
          <span className="pixel-label-sm text-ink-dim">{release.date}</span>
        </div>
        <div className="flex items-center gap-3">
          <Meter
            total={7}
            filled={groups}
            color={release.tone === 'gold' ? 'var(--color-gold)' : 'var(--color-teal)'}
            label={`${groups} groups shipped`}
          />
        </div>
      </div>

      <h3 className="mt-5 text-xl font-extrabold tracking-tight text-navy">{release.headline}</h3>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {release.groups.map((group) => (
          <Card key={group.name} press>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <p className="pixel-label text-teal-deep">{group.name}</p>
              {group.path ? (
                <code className="font-mono text-xs text-ink-dim">{group.path}</code>
              ) : null}
            </div>
            <ul className="mt-3 space-y-2.5">
              {group.entries.map((entry, i) => (
                <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-ink-dim">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-[1px] bg-line-soft" aria-hidden="true" />
                  <span>{entry}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </article>
  );
}

export default function ChangelogPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-14 px-4 py-10 sm:px-6 sm:py-14">
      <Section kicker="Changelog" title="All notable changes">
        <p className="max-w-3xl text-base leading-relaxed text-ink-dim">
          Veylqorix ships small and honest. Each release below is grouped by
          surface so you can see exactly what changed and where. This page
          mirrors <code className="font-mono text-sm">CHANGELOG.md</code> in the
          repository.
        </p>
        <a
          href="https://github.com/soumyachk101/Veylqorix/blob/main/CHANGELOG.md"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary mt-6"
        >
          Raw CHANGELOG.md on GitHub
        </a>
      </Section>

      {/* Vertical pixel timeline */}
      <ol className="relative space-y-10 border-l-4 border-line pl-6 sm:pl-10">
        {RELEASES.map((release, i) => (
          <li key={release.version} className="relative">
            <span
              className="absolute -left-[35px] top-2 grid h-7 w-7 place-items-center rounded border-4 border-line bg-navy sm:-left-[51px]"
              aria-hidden="true"
            >
              <span className={`pixel-label-sm ${release.tone === 'gold' ? 'bg-gold' : 'bg-teal'} text-screen`}>
                {String(i + 1).padStart(2, '0')}
              </span>
            </span>
            <ReleaseCard release={release} featured={i === 0} />
          </li>
        ))}
      </ol>

      {/* Release checklist */}
      <Section kicker="Release checklist" title="Done, and what is next">
        <div className="grid gap-8 lg:grid-cols-2">
          <Card title="Shipped with the build" press>
            <ChecklistBlocks items={RELEASE_CHECKLIST_DONE} label="DONE" tone="teal" />
          </Card>
          <Card title="Open items" press>
            <ChecklistBlocks items={RELEASE_CHECKLIST_OPEN} label="UP NEXT" tone="gold" />
          </Card>
        </div>
      </Section>

      {/* Sync-loop activity strip */}
      <Section kicker="Activity strip" title="The build loop behind the releases">
        <Terminal title="build loop">
          <p className="text-screen-dim">{SYNC_STRIP.window}</p>
          <p className="mt-2">{SYNC_STRIP.line}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/story/the-sync-loop" className="btn-on-screen text-sm">
              Read the sync-loop story
            </Link>
            <Link href="/tour" className="btn-on-screen text-sm">
              See how CI enforces it
            </Link>
          </div>
        </Terminal>
      </Section>
    </div>
  );
}
