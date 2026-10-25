'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Menu, X, ArrowRight } from 'lucide-react';
import { Logo } from './logo';

const LINKS: Array<{ href: string; label: string }> = [
  { href: '/#product', label: 'Product' },
  { href: '/#architecture', label: 'Architecture' },
  { href: '/#integrations', label: 'Integrations' },
  { href: '/#docs', label: 'Docs' },
];

export function Header() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <header className="sticky top-0 z-50 border-b-4 border-line bg-bg/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="press pixel-box-flat flex items-center gap-3 px-3 py-2" aria-label="Veylqorix home">
          <Logo className="h-8 w-8" />
          <span className="pixel-label text-ink">VEYLQORIX</span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded px-3 py-2 text-sm font-semibold text-ink-dim transition-colors hover:text-ink"
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/dashboard"
            className="pixel-box press ml-2 flex items-center gap-2 rounded px-4 py-2 text-sm font-bold text-ink"
          >
            Open Dashboard
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </nav>

        <button
          type="button"
          className="rounded border-2 border-line bg-surface p-2 text-ink md:hidden"
          aria-expanded={open}
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
        </button>
      </div>

      {open && (
        <nav aria-label="Mobile" className="border-t-4 border-line bg-surface px-4 py-3 md:hidden">
          <ul className="flex flex-col gap-1">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={close} className="block rounded px-3 py-2 font-semibold text-ink-dim hover:text-ink">
                  {l.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href="/dashboard"
                onClick={close}
                className="pixel-box press mt-2 flex items-center justify-center gap-2 rounded px-4 py-2 font-bold text-ink"
              >
                Open Dashboard
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}

/** Small section heading used across the landing page. */
export function SectionTitle({
  index,
  title,
  children,
}: {
  index: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-8">
      <p className="pixel-label text-ink-dim" aria-hidden="true">
        {index}
      </p>
      <h2 className="text-pixel-shadow mt-2 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">{title}</h2>
      {children ? <p className="mt-3 max-w-2xl text-lg text-ink-dim">{children}</p> : null}
    </div>
  );
}
