import Link from 'next/link';

const NAV = [
  { label: 'Home', href: '/' },
  { label: 'Story', href: '/story' },
  { label: 'Changelog', href: '/changelog' },
  { label: 'Tour', href: '/tour' },
  { label: 'Roadmap', href: '/roadmap' },
];

/** Sticky top bar in the pixel-box language. Wraps on narrow phones.
 *  The logo links to the home page. */
export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b-4 border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <Link
          href="/"
          aria-label="Veylqorix home"
          className="flex min-w-0 items-center gap-3 rounded border-2 border-transparent transition-colors hover:border-line"
        >
          {/* Official logo lockup — warm off-white source background blends
              with the surface; icon crop used at small widths. */}
          <img
            src="/logo.png"
            alt="Veylqorix — No Unsafe Code Gets Through"
            className="hidden h-12 w-auto sm:block"
          />
          <img
            src="/logo-icon.png"
            alt="Veylqorix"
            className="block h-10 w-auto sm:hidden"
          />
          <span className="pixel-label-sm text-ink-dim sm:hidden">Veylqorix</span>
        </Link>

        <nav aria-label="Primary" className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="pixel-label-sm rounded px-2 py-1 text-navy transition-colors hover:bg-surface-2"
            >
              {item.label}
            </Link>
          ))}
          <a
            href="https://github.com/soumyachk101/Veylqorix"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary !px-3 !py-2 text-sm"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
