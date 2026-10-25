import { Section } from "@/components/site/ui";

/**
 * Site footer: pixel-box with three columns (About + MIT, Site links,
 * Docs/GitHub links) and a bottom strip carrying the honesty one-liner.
 */
export function Footer() {
  return (
    <footer className="mx-auto max-w-6xl px-4 py-8">
      <div className="pixel-box p-5 sm:p-6">
        <div className="grid gap-6 sm:grid-cols-3">
          <div className="min-w-0">
            <img src="/logo-icon.png" alt="Veylqorix" className="h-9 w-auto" />
            <p className="mt-3 text-sm leading-relaxed text-ink-dim">
              A universal code-security and quality platform that verifies
              AI-generated and human-written code before it ships.
            </p>
            <p className="mt-2 text-xs font-semibold text-ink-dim">MIT licensed</p>
          </div>

          <div className="min-w-0">
            <p className="pixel-label text-navy">Site</p>
            <ul className="mt-2 space-y-1 text-sm font-medium text-ink">
              <li><a className="hover:text-teal-deep" href="/">Home</a></li>
              <li><a className="hover:text-teal-deep" href="/story">Story</a></li>
              <li><a className="hover:text-teal-deep" href="/changelog">Changelog</a></li>
              <li><a className="hover:text-teal-deep" href="/tour">Tour</a></li>
              <li><a className="hover:text-teal-deep" href="/roadmap">Roadmap</a></li>
            </ul>
          </div>

          <div className="min-w-0">
            <p className="pixel-label text-navy">Docs &amp; GitHub</p>
            <ul className="mt-2 space-y-1 text-sm font-medium text-ink">
              <li><a className="hover:text-teal-deep" href="/tour#cli">Tour: CLI</a></li>
              <li><a className="hover:text-teal-deep" href="/tour#mcp">Tour: MCP</a></li>
              <li><a className="hover:text-teal-deep" href="/tour#gate">Tour: GitHub gate</a></li>
              <li>
                <a
                  className="inline-flex items-center gap-1 font-semibold text-navy hover:text-teal-deep"
                  href="https://github.com/soumyachk101/Veylqorix"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-6 border-t-4 border-line-soft pt-4">
          <p className="text-xs leading-relaxed text-ink-dim">
            Veylqorix reports what its scanners found. It does not certify the
            absence of vulnerabilities.
          </p>
        </div>
      </div>
    </footer>
  );
}
