import Link from 'next/link';
import { ArrowRight, Github } from 'lucide-react';
import { Wordmark } from './logo';

const COLUMNS: Array<{ title: string; links: Array<{ href: string; label: string; external?: boolean }> }> = [
  {
    title: 'Product',
    links: [
      { href: '/#product', label: 'Capabilities' },
      { href: '/#architecture', label: 'Architecture' },
      { href: '/#integrations', label: 'Integrations' },
      { href: '/dashboard', label: 'Dashboard' },
    ],
  },
  {
    title: 'Docs',
    links: [
      { href: '/docs#api', label: 'API' },
      { href: '/docs#cli', label: 'CLI' },
      { href: '/docs#mcp', label: 'MCP server' },
      { href: '/docs#github-actions', label: 'GitHub Actions' },
      { href: '/docs#troubleshooting', label: 'Troubleshooting' },
    ],
  },
  {
    title: 'Principles',
    links: [
      { href: '/#architecture', label: 'Deterministic gate' },
      { href: '/#product', label: 'Secrets redacted' },
      { href: '/#product', label: 'Evidence-backed findings' },
      { href: '/docs#troubleshooting', label: 'Honest limitations' },
    ],
  },
];

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-24 border-t-4 border-line bg-surface-2">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        {/* Top: brand + CTA */}
        <div className="grid gap-10 md:grid-cols-[1.2fr_2fr]">
          <div>
            <Wordmark withLink={false} />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-ink-dim">
              No Unsafe Code Gets Through. Dependency auditing, secret detection, static analysis, and a
              policy-driven quality gate — surfaced through CLI, MCP, GitHub Actions, and a live dashboard.
            </p>
            <Link href="/dashboard" className="btn-primary mt-6 text-sm">
              Open the dashboard
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {COLUMNS.map((col) => (
              <nav key={col.title} aria-label={col.title}>
                <h3 className="pixel-label-sm mb-4 text-ink-dim">{col.title}</h3>
                <ul className="space-y-2.5">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <Link
                        href={l.href}
                        className="text-sm font-semibold text-ink-dim transition-colors hover:text-ink focus-visible:text-ink"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="mt-12 border-t-2 border-line-soft pt-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-2xl text-xs leading-relaxed text-ink-dim">
              Veylqorix is released under the MIT license. Real claims only: it scans the code you point
              it at and blocks what your policy says to block. Scanner unavailability is reported, never
              green-washed.
            </p>
            <a
              href="https://github.com/soumyachk101/Veylqorix"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 self-start rounded border-2 border-line bg-surface px-3 py-2 text-xs font-semibold text-ink-dim transition-colors hover:text-ink"
            >
              <Github className="h-4 w-4" aria-hidden="true" />
              GitHub
            </a>
          </div>
          <p className="mt-6 flex items-center gap-2 text-xs text-ink-faint">
            <span className="pixel-label-sm text-teal-deep" aria-hidden="true">
              VEYLQORIX / {year}
            </span>
            <span aria-hidden="true">·</span>
            <span>No Unsafe Code Gets Through.</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
