import Link from 'next/link';
import type { Metadata } from 'next';
import { Card, Meter, Quote, Section, Table, Terminal } from '@/components/site/ui';

export const metadata: Metadata = {
  title: 'Tour — Inside Veylqorix',
  description:
    'A full tour of the Veylqorix platform: CLI, MCP server, REST API, dashboard, GitHub gate, security model, honest limitations, and community ground rules.',
};

const SUBNAV = [
  { id: 'overview', label: 'Overview' },
  { id: 'cli', label: 'CLI' },
  { id: 'mcp', label: 'MCP' },
  { id: 'api', label: 'API' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'gate', label: 'GitHub gate' },
  { id: 'limitations', label: 'Limitations' },
  { id: 'community', label: 'Community' },
];

export default function TourPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-16 px-4 py-10 sm:px-6 sm:py-14">
      <section aria-labelledby="tour-title" className="max-w-3xl">
        <p className="pixel-label text-teal-deep">Tour</p>
        <h1 id="tour-title" className="text-pixel-shadow mt-4 text-3xl font-extrabold tracking-tight text-ink sm:text-5xl">
          Inside Veylqorix
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-ink-dim">
          Everything the platform does, surface by surface. One core engine,
          six entry points, and a gate that refuses to green-wash — here is
          how each piece fits.
        </p>
        <nav aria-label="Tour sections" className="mt-6 flex flex-wrap gap-2">
          {SUBNAV.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="pixel-label-sm rounded border-2 border-line bg-surface px-2.5 py-1.5 text-navy hover:bg-surface-2"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </section>

      {/* ---------------- Overview ---------------- */}
      <Section id="overview" kicker="Overview" title="The architecture in words">
        <p className="max-w-3xl text-base leading-relaxed text-ink-dim">
          The system separates four layers: <strong>entry points</strong> (who
          runs a scan — terminal, agent, CI, browser), the{' '}
          <strong>integration layer</strong> (how they reach the engine — CLI,
          MCP, REST), the <strong>core engine</strong> (which scanner runs,
          when, and how results are normalized and gated), and the{' '}
          <strong>results &amp; enforcement surfaces</strong> (reports,
          dashboards, and CI status checks).
        </p>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card press>
            <img
              src="/diagrams/01_system_architecture.png"
              alt="Veylqorix system architecture: entry points, integration layer, core engine, and results surfaces"
              className="w-full rounded border-2 border-line-soft"
            />
            <p className="mt-3 text-xs text-ink-dim">
              System architecture — the diagram depicts the target design; the
              shipped implementation keeps the same engine/adapter separation
              in a pnpm TypeScript monorepo.
            </p>
          </Card>
          <Card press>
            <img
              src="/diagrams/02_scan_lifecycle.png"
              alt="Veylqorix scan lifecycle: code change to normalized findings to gate decision to verified fix"
              className="w-full rounded border-2 border-line-soft"
            />
            <p className="mt-3 text-xs text-ink-dim">
              Scan lifecycle — normalize before judging, gate failures are
              first-class, verify don&apos;t trust.
            </p>
          </Card>
        </div>
        <div className="mt-8">
          <h3 className="pixel-label text-navy">Monorepo layout</h3>
          <Table
            head={['Package / path', 'Role']}
            rows={[
              ['packages/core', 'Engine: detection, scanners, policy, gate, reports, path safety, git + hook helpers, policy validation. Independent of every front-end.'],
              ['apps/cli', 'The veylqorix command-line interface.'],
              ['packages/mcp-server', 'MCP server exposing the engine to AI coding agents.'],
              ['packages/api', 'Dependency-free REST API that runs real scans for the dashboard.'],
              ['packages/skills', 'Portable AI-agent skill plus per-client MCP configs.'],
              ['apps/web', 'Landing page + security dashboard (real API data, labeled demo fallback).'],
              ['Veylqorix_Diagrams/', 'Editable Graphviz sources and rendered PNGs.'],
              ['docs/', 'Per-surface documentation: CLI, MCP, API, dashboard, GitHub Actions, FAQ, troubleshooting.'],
              ['tests/', 'Unit tests + integration fixtures (fake data only, never real credentials).'],
            ]}
          />
        </div>
      </Section>

      {/* ---------------- CLI ---------------- */}
      <Section id="cli" kicker="Surface 01" title="CLI — veylqorix">
        <p className="max-w-3xl text-base leading-relaxed text-ink-dim">
          The CLI is a thin adapter over the core engine: every result comes
          from a real scanner run, and a scanner that cannot run is reported as
          SKIPPED or ERROR, never as a clean pass. It is not published to npm
          yet — run it from the monorepo build.
        </p>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Terminal title="commands">
            <pre className="text-[13px] leading-relaxed">
{`veylqorix scan [root]                  full audit + quality gate
veylqorix check [root]                 quality checks only
veylqorix report [root]                Markdown report
veylqorix config validate FILE         validate a policy
veylqorix hooks install|uninstall      safe Git hooks`}
            </pre>
          </Terminal>
          <Terminal title="exit codes">
            <pre className="text-[13px] leading-relaxed">
{`0   PASS         gate passed
1   FAIL         blocking findings
2   INCOMPLETE   coverage degraded — never green
64  usage error
65  bad root / missing policy
70  unexpected error`}
            </pre>
          </Terminal>
        </div>
        <div className="mt-6">
          <h3 className="pixel-label text-navy">Options</h3>
          <Table
            head={['Option', 'Effect']}
            rows={[
              ['--staged', 'Scope the secret scan to Git-staged files (used by the pre-commit hook).'],
              ['--json', 'Machine-readable JSON on stdout.'],
              ['--format markdown|json|sarif', 'Report format.'],
              ['--report-out FILE', 'Write the Markdown report to a file.'],
              ['--sarif-out FILE', 'Write a SARIF 2.1.0 report to a file.'],
              ['--offline', 'Skip network-dependent scanners (no advisory DB pull).'],
              ['--no-tests', 'Skip test/build quality checks.'],
              ['--scanners a,b', 'Restrict which scanners run.'],
              ['--block-on a,b', 'Severities that block the gate.'],
              ['--policy FILE', 'Load a custom policy JSON file.'],
              ['hooks --yes / --pre-push / --force', 'Actually write hooks; add pre-push; back up a foreign hook before replacing.'],
            ]}
          />
        </div>
        <Card screen className="mt-6">
          <p className="pixel-label text-mint">The hook installer is safe on purpose</p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
            <li>It never touches <code className="font-mono text-xs">git config</code>.</li>
            <li>It backs up any non-Veylqorix hook before replacing it.</li>
            <li>It is a dry run unless you pass <code className="font-mono text-xs">--yes</code>.</li>
            <li>Local override: <code className="font-mono text-xs">VEYLQORIX_OVERRIDE=1</code>.</li>
          </ul>
          <p className="mt-3 text-sm text-gold-faint">
            Hooks are a local convenience, not a security boundary. The
            authoritative enforcement point is the GitHub Actions gate plus
            branch protection.
          </p>
        </Card>
      </Section>

      {/* ---------------- MCP ---------------- */}
      <Section id="mcp" kicker="Surface 02" title="MCP — six tools for coding agents">
        <p className="max-w-3xl text-base leading-relaxed text-ink-dim">
          The MCP server exposes the engine to Claude Code, Codex, Cursor, and
          any MCP client. Inputs are Zod-validated; every response is
          structured, evidence-based, and redacted. The server only reads and
          scans — it has no write path.
        </p>
        <div className="mt-6">
          <Table
            head={['Tool', 'Purpose']}
            rows={[
              ['scan_repository', 'Full audit: dependency, secret, license, and quality scans plus the gate decision.'],
              ['scan_dependencies', 'Dependency audit only (npm audit / pip-audit).'],
              ['scan_secrets', 'Secret detection only; matched values are redacted in the response.'],
              ['run_security_checks', 'Quality checks only (type, lint, tests).'],
              ['get_findings', 'Fetch findings for a completed scan, optionally filtered by ids.'],
              ['validate_fix', 'Re-check a file set after a fix to confirm a finding no longer reproduces.'],
            ]}
          />
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Terminal title=".mcp.json">
            <pre className="text-[13px] leading-relaxed">
{`{
  "mcpServers": {
    "veylqorix": {
      "command": "node",
      "args": ["/abs/path/packages/mcp-server/dist/bin.js"],
      "env": {
        "VEYLQORIX_ROOTS": "/abs/path/your/project",
        "VEYLQORIX_TIMEOUT_MS": "120000"
      }
    }
  }
}`}
            </pre>
          </Terminal>
          <Card press title="Safety properties">
            <ul className="list-disc space-y-2.5 pl-5 text-sm leading-relaxed text-ink-dim">
              <li>
                <strong>Path confinement</strong> — roots are canonicalized;{' '}
                <code className="font-mono text-xs">..</code> traversal and
                symlink escapes are rejected. Always set{' '}
                <code className="font-mono text-xs">VEYLQORIX_ROOTS</code>.
              </li>
              <li>
                <strong>Redaction</strong> — secret values are redacted in
                every tool response, same as CLI and API.
              </li>
              <li>
                <strong>No write path</strong> — the server cannot commit,
                push, or modify the repository.
              </li>
              <li>
                <strong>Offline honesty</strong> —{' '}
                <code className="font-mono text-xs">VEYLQORIX_OFFLINE=1</code>{' '}
                skips the advisory DB, so the gate can report INCOMPLETE rather
                than PASS.
              </li>
            </ul>
          </Card>
        </div>
      </Section>

      {/* ---------------- API ---------------- */}
      <Section id="api" kicker="Surface 03" title="REST API — real scans over HTTP">
        <p className="max-w-3xl text-base leading-relaxed text-ink-dim">
          A dependency-free REST API on port 4173 that registers repositories,
          runs real scans, and serves reports as JSON, Markdown, or SARIF.
          Every error is structured JSON; paths are validated against
          <code className="font-mono text-sm"> VEYLQORIX_ALLOWED_ROOTS</code>{' '}
          when set; secrets are redacted in every response.
        </p>
        <div className="mt-6">
          <Table
            head={['Endpoint', 'What it does']}
            rows={[
              ['GET /api/health', 'Liveness probe.'],
              ['POST /api/repositories', 'Register a repository (403 outside allowed roots).'],
              ['GET /api/repositories', 'List registered repositories.'],
              ['POST /api/scan', 'Start a scan by repoId or path; returns 202 with a RUNNING scan.'],
              ['GET /api/scan/:id', 'Full scan result when complete: gate, coverage, exit code, findings, scanner summaries.'],
              ['GET /api/scan/:id/findings', 'Findings only.'],
              ['GET /api/scan/:id/report', 'Report inline (?format=markdown|json|sarif).'],
              ['GET /api/scans', 'List scans, newest first; ?repoId filter. (0.1.1)'],
              ['GET /api/scans/:id', 'Full detail for one scan. (0.1.1)'],
              ['GET /api/reports/:scanId', 'Downloadable report attachment — 202 while running, 404 unknown scan, 400 unknown format. (0.1.1)'],
              ['GET /api/repo/:id/latest | /history', 'Most recent completed scan, or the full history.'],
            ]}
          />
        </div>
      </Section>

      {/* ---------------- Dashboard ---------------- */}
      <Section id="dashboard" kicker="Surface 04" title="Dashboard — labeled, never faked">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card press title="What it shows">
            <ul className="list-disc space-y-2.5 pl-5 text-sm leading-relaxed text-ink-dim">
              <li>Gate result: PASS / FAIL / INCOMPLETE, with blocking reasons and coverage.</li>
              <li>Normalized findings sorted by severity, with redacted secret values.</li>
              <li>Per-scanner status, so you can see which checks actually ran.</li>
              <li>Scan history for the selected repository.</li>
            </ul>
          </Card>
          <Card press screen>
            <p className="pixel-label text-mint">LIVE vs DEMO MODE</p>
            <p className="mt-3 text-sm leading-relaxed">
              When the API is reachable, the dashboard shows <strong>real</strong>{' '}
              scan data (LIVE, green). When it is not, it renders
              clearly-labeled sample data under a{' '}
              <strong>DEMO MODE</strong> banner (amber). It never presents a
              demo as a live result.
            </p>
            <p className="mt-3 font-mono text-xs text-screen-dim">
              pnpm --filter @veylqorix/web dev — dashboard on :3000, API on :4173
            </p>
          </Card>
        </div>
      </Section>

      {/* ---------------- GitHub gate ---------------- */}
      <Section id="gate" kicker="Surface 05" title="GitHub security gate">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card press>
            <img
              src="/diagrams/03_github_security_gate.png"
              alt="Veylqorix GitHub pull-request security gate flow from PR to enforced check"
              className="w-full rounded border-2 border-line-soft"
            />
            <p className="mt-3 text-xs text-ink-dim">
              The reusable veylqorix-gate workflow: check out the PR, run a real
              scan, emit SARIF to code scanning, upload artifacts.
            </p>
          </Card>
          <div className="space-y-6">
            <Card press title="How it works">
              <ul className="list-disc space-y-2.5 pl-5 text-sm leading-relaxed text-ink-dim">
                <li>Reusable workflow_call — independent of local hooks.</li>
                <li>All actions pinned to commit SHAs; least-privilege permissions.</li>
                <li>SARIF output feeds GitHub code scanning; JSON + stderr upload as artifacts.</li>
                <li>On blocking findings or incomplete coverage, it exits non-zero.</li>
              </ul>
            </Card>
            <div>
              <Meter total={4} filled={4} label="advisory → enforced: 4 steps" />
            </div>
            <Card screen>
              <p className="pixel-label text-gold">The enforcement note</p>
              <p className="mt-3 text-sm leading-relaxed">
                The workflow does not block merges by itself. It becomes
                authoritative when the repository <strong>requires its status
                check</strong> via branch protection or a ruleset. Until then
                it is advisory: findings are produced, the check fails — but a
                merge can still be forced. That is documented in the workflow
                file itself.
              </p>
            </Card>
          </div>
        </div>
      </Section>

      {/* ---------------- Limitations ---------------- */}
      <Section id="limitations" kicker="Honest limitations" title="What the gate will not say">
        <p className="max-w-3xl text-base leading-relaxed text-ink-dim">
          Veylqorix reports what its scanners found. It does not certify the
          absence of vulnerabilities or secrets. Five things it is honest
          about, always:
        </p>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <Card press className="border-coral">
            <p className="pixel-label-sm text-coral-faint">01</p>
            <h3 className="mt-2 text-base font-bold text-navy">Degraded coverage is surfaced, not hidden</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-dim">
              Offline mode, a missing pip-audit binary, or a missing lockfile
              makes a scanner SKIPPED or ERROR — and the gate INCOMPLETE
              (exit 2), never a pass.
            </p>
          </Card>
          <Card press className="border-coral">
            <p className="pixel-label-sm text-coral-faint">02</p>
            <h3 className="mt-2 text-base font-bold text-navy">Regex secrets have false positives and negatives</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-dim">
              The built-in rule set complements tools like Gitleaks; it does
              not replace them. Unknown formats are not covered.
            </p>
          </Card>
          <Card press className="border-coral">
            <p className="pixel-label-sm text-coral-faint">03</p>
            <h3 className="mt-2 text-base font-bold text-navy">License scanning is manifest-level</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-dim">
              It checks declared licenses and copyleft risk in manifests — it
              is not a transitive license audit.
            </p>
          </Card>
          <Card press className="border-coral">
            <p className="pixel-label-sm text-coral-faint">04</p>
            <h3 className="mt-2 text-base font-bold text-navy">A clean quality check is not a certification</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-dim">
              Passing lint, type checks, and tests is evidence — not proof
              that the code is secure.
            </p>
          </Card>
          <Card press className="border-coral sm:col-span-2">
            <p className="pixel-label-sm text-coral-faint">05</p>
            <h3 className="mt-2 text-base font-bold text-navy">The gate and hooks are advisory until enforced</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-dim">
              Local hooks are bypassable (git commit --no-verify,{' '}
              VEYLQORIX_OVERRIDE=1), and the Actions gate blocks only when a
              branch-protection rule requires its status check. Until then, a
              merge can still be forced.
            </p>
          </Card>
        </div>

        <div className="mt-8">
          <h3 className="pixel-label text-navy">Troubleshooting quick answers</h3>
          <Table
            head={['Symptom', 'Why', 'Fix']}
            rows={[
              ['Gate reports INCOMPLETE (exit 2)', 'A scanner errored or was skipped — degraded coverage is never green.', 'Restore the missing binary / network / lockfile, re-run without --offline.'],
              ['No dependency findings despite a published CVE', 'Offline mode, a transitive dependency, or a stale advisory-DB pull.', 'Remove --offline, run a full pnpm install, re-scan.'],
              ['Secret not detected', 'The built-in rule set does not cover every format.', 'Use Gitleaks for higher fidelity; report the format gap.'],
              ['Dashboard shows demo data', 'The API is unreachable, so it falls back to labeled sample data.', 'Start the API on :4173 — the banner flips to LIVE.'],
              ['hooks install says “not a Git repository”', 'The installer requires .git/ and will not create a repo.', 'Run it from inside a Git work tree.'],
            ]}
          />
        </div>
      </Section>

      {/* ---------------- Community ---------------- */}
      <Section id="community" kicker="Community" title="Ground rules for contributors">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card press title="Contributing">
            <ul className="list-disc space-y-2.5 pl-5 text-sm leading-relaxed text-ink-dim">
              <li>No fabricated results — every finding must come from a real scanner run.</li>
              <li>Never weaken the gate to make a test pass.</li>
              <li>Redact secrets everywhere, in code, fixtures, and output.</li>
              <li>No new dependencies without justification.</li>
            </ul>
            <p className="mt-4 font-mono text-xs text-ink-dim">
              pnpm build · pnpm typecheck · pnpm lint · pnpm test — the release checklist runs all four.
            </p>
          </Card>
          <Card press title="The codebase, as it is">
            <ul className="list-disc space-y-2.5 pl-5 text-sm leading-relaxed text-ink-dim">
              <li>MIT licensed — see LICENSE.</li>
              <li>Code of Conduct: Contributor Covenant v2.0.</li>
              <li>Accessibility commitment with known limitations, documented in ACCESSIBILITY.md.</li>
              <li>Threat model and disclosure policy in SECURITY.md.</li>
              <li>Test fixtures contain only fake, well-known placeholder values.</li>
            </ul>
            <div className="mt-4 flex flex-wrap gap-3">
              <a
                href="https://github.com/soumyachk101/Veylqorix"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary text-sm"
              >
                GitHub repository
              </a>
              <Link href="/story" className="btn-secondary text-sm">
                Read the build story
              </Link>
            </div>
          </Card>
        </div>
        <div className="mt-8">
          <Quote cite="docs/faq.md — the short version">
            Veylqorix surfaces incomplete audits instead of green-washing
            them. The gate is advisory until you enforce it, and it says so in
            the workflow file.
          </Quote>
        </div>
      </Section>
    </div>
  );
}
