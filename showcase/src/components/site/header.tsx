'use client';

import { useState } from 'react';

const NAV = [
  { label: 'Home', href: '/' },
  { label: 'Story', href: '/story' },
  { label: 'Changelog', href: '/changelog' },
  { label: 'Tour', href: '/tour' },
  { label: 'Roadmap', href: '/roadmap' },
];

/** Sticky top bar in the pixel-box language. Inline nav on sm and up;
 *  a hamburger-toggled menu below that. The wordmark links to the home page. */
export function Header() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <header className="sticky top-0 z-50">
      <div className="border-b-4 border-line bg-surface-2/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center gap-x-4 px-4 py-3 sm:px-6">
          <a
            href="/"
            aria-label="Veylqorix home"
            className="flex min-w-0 flex-wrap items-baseline gap-x-3"
          >
            <span className="pixel-label text-navy">Veylqorix</span>
            <span className="hidden text-xs font-medium text-ink-dim sm:inline">
              No unsafe code gets through
            </span>
          </a>

          <nav aria-label="Primary" className="ml-auto hidden items-center gap-x-3 sm:flex">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded px-1.5 py-0.5 text-sm font-semibold text-ink hover:bg-surface-2 hover:text-navy"
              >
                {item.label}
              </a>
            ))}
            <a
              className="pixel-label-sm bg-navy px-2 py-1.5 text-screen-ink shadow-pixel-sm transition-transform hover:-translate-y-px"
              href="https://github.com/soumyachk101/Veylqorix"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </nav>

          <button
            type="button"
            className="pixel-label-sm ml-auto border-2 border-line bg-surface px-2.5 py-1.5 text-navy shadow-pixel-sm transition-transform hover:-translate-y-px sm:hidden"
            aria-expanded={open}
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Close' : 'Menu'}
          </button>
        </div>

        {open && (
          <nav
            aria-label="Mobile"
            className="border-t-4 border-line bg-surface px-4 py-3 sm:hidden"
          >
            <ul className="flex flex-col gap-2">
              {NAV.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    onClick={close}
                    className="block rounded px-2 py-1.5 text-sm font-semibold text-ink hover:text-navy"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
              <li>
                <a
                  className="pixel-label-sm inline-block bg-navy px-2 py-1.5 text-screen-ink shadow-pixel-sm"
                  href="https://github.com/soumyachk101/Veylqorix"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub
                </a>
              </li>
            </ul>
          </nav>
        )}
      </div>
    </header>
  );
}
