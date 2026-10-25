import Link from 'next/link';
import { Logo } from './logo';

export function Footer() {
  return (
    <footer className="mt-24 border-t-4 border-line bg-surface-2">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <Logo className="h-8 w-8" />
              <span className="pixel-label text-ink">VEYLQORIX</span>
            </div>
            <p className="mt-3 max-w-sm text-sm text-ink-dim">
              No Unsafe Code Gets Through. Dependency auditing, secret detection, static analysis, and a
              policy-driven quality gate — surfaced through CLI, MCP, and a live dashboard.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 text-sm">
            <nav aria-label="Product">
              <h3 className="pixel-label-sm mb-3 text-ink-dim">Product</h3>
              <ul className="space-y-2">
                <li>
                  <Link className="font-semibold text-ink-dim hover:text-ink" href="/#product">
                    Capabilities
                  </Link>
                </li>
                <li>
                  <Link className="font-semibold text-ink-dim hover:text-ink" href="/#architecture">
                    Architecture
                  </Link>
                </li>
                <li>
                  <Link className="font-semibold text-ink-dim hover:text-ink" href="/#integrations">
                    Integrations
                  </Link>
                </li>
                <li>
                  <Link className="font-semibold text-ink-dim hover:text-ink" href="/dashboard">
                    Dashboard
                  </Link>
                </li>
              </ul>
            </nav>
            <nav aria-label="Docs">
              <h3 className="pixel-label-sm mb-3 text-ink-dim">Docs</h3>
              <ul className="space-y-2">
                <li>
                  <Link className="font-semibold text-ink-dim hover:text-ink" href="/docs#api">
                    API
                  </Link>
                </li>
                <li>
                  <Link className="font-semibold text-ink-dim hover:text-ink" href="/docs#github-actions">
                    GitHub Actions
                  </Link>
                </li>
                <li>
                  <Link className="font-semibold text-ink-dim hover:text-ink" href="/docs#troubleshooting">
                    Troubleshooting
                  </Link>
                </li>
              </ul>
            </nav>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t-2 border-line-soft pt-5 text-xs text-ink-dim sm:flex-row sm:items-center sm:justify-between">
          <p>
            Veylqorix is released under the MIT license. Real claims only: it scans the code you point it
            at and blocks what your policy says to block.
          </p>
          <p className="pixel-label-sm" aria-hidden="true">
            VEYLQORIX / {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </footer>
  );
}
