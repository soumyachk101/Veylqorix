/**
 * Sticky site header: a pixel-box bar with the VEYLQORIX wordmark, tagline,
 * and nav links. Wraps on mobile; links are plain <a> elements (Home, Story,
 * Changelog, Tour, Roadmap) plus an external GitHub link.
 */
export function Header() {
  return (
    <header className="sticky top-0 z-50">
      <div className="border-b-4 border-line bg-surface-2/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="pixel-label text-navy">Veylqorix</span>
            <span className="text-xs font-medium text-ink-dim">
              No unsafe code gets through
            </span>
          </div>
          <nav className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-semibold text-ink">
            <a href="/" className="rounded px-1.5 py-0.5 hover:bg-surface-2 hover:text-navy">
              Home
            </a>
            <a href="/story" className="rounded px-1.5 py-0.5 hover:bg-surface-2 hover:text-navy">
              Story
            </a>
            <a href="/changelog" className="rounded px-1.5 py-0.5 hover:bg-surface-2 hover:text-navy">
              Changelog
            </a>
            <a href="/tour" className="rounded px-1.5 py-0.5 hover:bg-surface-2 hover:text-navy">
              Tour
            </a>
            <a href="/roadmap" className="rounded px-1.5 py-0.5 hover:bg-surface-2 hover:text-navy">
              Roadmap
            </a>
            <a
              className="pixel-label-sm bg-navy px-2 py-1.5 text-screen-ink shadow-pixel-sm transition-transform hover:-translate-y-px"
              href="https://github.com/soumyachk101/Veylqorix"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </nav>
        </div>
      </div>
    </header>
  );
}
