import { SectionTitle } from '../header';

function Endpoint({ method, path, body }: { method: string; path: string; body: string }) {
  return (
    <div className="rounded border-2 border-line bg-surface-2 p-3">
      <p className="flex items-center gap-2 font-mono text-[13px] font-bold text-ink">
        <span className="pixel-label-sm bg-navy px-1.5 py-0.5 text-mint">{method}</span>
        {path}
      </p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-dim">{body}</p>
    </div>
  );
}

export function Docs() {
  return (
    <section id="docs" aria-labelledby="docs-title" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <SectionTitle index="05 / Docs" title="Quick reference">
        Condensed from the monorepo docs: <code className="font-mono text-[0.9em]">docs/api.md</code>,{' '}
        <code className="font-mono text-[0.9em]">docs/github-actions.md</code>, and{' '}
        <code className="font-mono text-[0.9em]">docs/troubleshooting.md</code>.
      </SectionTitle>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
        <div id="api" className="pixel-box scroll-mt-24 rounded p-5">
          <h3 className="text-lg font-extrabold text-ink">API</h3>
          <p className="mt-1 text-sm text-ink-dim">Default base URL: <code className="font-mono text-[13px]">http://localhost:4173</code>. JSON in, JSON out. No auth — put a gateway in front for untrusted networks, and set <code className="font-mono text-[13px]">VEYLQORIX_ALLOWED_ROOTS</code> to restrict scannable paths.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Endpoint method="GET" path="/api/health" body="Liveness probe." />
            <Endpoint method="POST" path="/api/repositories" body="Register a repo: {path, name?}." />
            <Endpoint method="GET" path="/api/repositories" body="List registered repositories." />
            <Endpoint method="POST" path="/api/scan" body="Start a scan by repoId or path. 202 + scan id." />
            <Endpoint method="GET" path="/api/scan/:id" body="Full result; poll until status is DONE." />
            <Endpoint method="GET" path="/api/scan/:id/report" body="?format=markdown | json | sarif." />
            <Endpoint method="GET" path="/api/repo/:id/latest" body="Most recent completed scan." />
            <Endpoint method="GET" path="/api/repo/:id/history" body="Scan history, newest first." />
          </div>
        </div>

        <div className="grid gap-5">
          <div id="cli" className="pixel-box scroll-mt-24 rounded p-5">
            <h3 className="text-lg font-extrabold text-ink">CLI &amp; git hooks</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-dim">
              <code className="font-mono text-[13px]">veylqorix scan</code>, <code className="font-mono text-[13px]">veylqorix check</code>,{' '}
              <code className="font-mono text-[13px]">veylqorix report</code>, and{' '}
              <code className="font-mono text-[13px]">veylqorix config validate</code>. Exit codes are
              deterministic: <code className="font-mono text-[13px]">0</code> pass, <code className="font-mono text-[13px]">1</code>{' '}
              blocking findings, <code className="font-mono text-[13px]">2</code> incomplete coverage.
              <code className="font-mono text-[13px]"> veylqorix hooks install</code> writes pre-commit and
              pre-push hooks; <code className="font-mono text-[13px]">VEYLQORIX_OVERRIDE</code> is the
              explicit, auditable escape hatch.
            </p>
          </div>

          <div id="mcp" className="pixel-box scroll-mt-24 rounded p-5">
            <h3 className="text-lg font-extrabold text-ink">MCP server</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-dim">
              Six tools — <code className="font-mono text-[13px]">scan_repository</code>,{' '}
              <code className="font-mono text-[13px]">scan_dependencies</code>,{' '}
              <code className="font-mono text-[13px]">scan_secrets</code>,{' '}
              <code className="font-mono text-[13px]">run_security_checks</code>,{' '}
              <code className="font-mono text-[13px]">get_findings</code>,{' '}
              <code className="font-mono text-[13px]">validate_fix</code> — all backed by the same core
              engine. Filesystem access is confined to the roots you configure via{' '}
              <code className="font-mono text-[13px]">VEYLQORIX_ROOTS</code>; no shell is exposed to the
              agent.
            </p>
          </div>

          <div id="github-actions" className="pixel-box scroll-mt-24 rounded p-5">
            <h3 className="text-lg font-extrabold text-ink">GitHub Actions gate</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-dim">
              The monorepo ships <code className="font-mono text-[13px]">.github/workflows/veylqorix-gate.yml</code> as a{' '}
              <code className="font-mono text-[13px]">workflow_call</code> reusable workflow: it checks out
              the repo, builds the CLI, runs a scan, uploads SARIF to code scanning, and exits non-zero on
              any blocking finding or incomplete coverage. It blocks merges only when the calling repo
              requires the status check via branch protection or a ruleset.
            </p>
          </div>

          <div id="troubleshooting" className="pixel-box scroll-mt-24 rounded p-5">
            <h3 className="text-lg font-extrabold text-ink">Troubleshooting, in one line each</h3>
            <ul className="mt-2 space-y-2 text-sm leading-relaxed text-ink-dim">
              <li>
                <strong className="text-ink">Gate says INCOMPLETE (exit 2)</strong> — coverage was degraded
                (a scanner errored or was skipped, e.g. offline mode or a missing binary). Veylqorix refuses
                to call an incomplete scan clean; fix the scanner, re-run.
              </li>
              <li>
                <strong className="text-ink">No dependency findings for a known CVE</strong> — advisory DB
                not reached (offline), transitive dep outside <code className="font-mono text-[13px]">npm audit</code>{' '}
                package-lock mode, or a very new CVE. Run a full install first, re-scan online.
              </li>
              <li>
                <strong className="text-ink">Secret not detected</strong> — the built-in rule set covers
                common formats (AWS keys, GitHub/Slack/OpenAI tokens, PEM keys, Google API keys); unknown
                formats need Gitleaks wired in via the scanner registry.
              </li>
              <li>
                <strong className="text-ink">Dashboard shows demo data</strong> — the mode banner is
                amber DEMO MODE when the API is unreachable; start it with{' '}
                <code className="font-mono text-[13px]">node packages/api/dist/bin.js</code> for green LIVE.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
