import { SectionTitle } from '../header';

function ScreenCard({ label, title, code }: { label: string; title: string; code: string }) {
  return (
    <div className="pixel-box--screen rounded p-4 sm:p-5">
      <p className="pixel-label-sm text-mint" aria-hidden="true">
        {label}
      </p>
      <h3 className="mt-2 text-base font-bold text-screen-ink">{title}</h3>
      <pre className="mt-3 overflow-x-auto rounded border-2 border-line bg-screen-2 p-3 text-[13px] leading-relaxed text-screen-ink">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
}

const CLI_SNIPPET = [
  '$ veylqorix scan .',
  '> detect    node / pnpm / package-lock.json',
  '> scan      dependencies · secrets · quality',
  '> policy    veylqorix-policy.json (workspace)',
  '> gate      FAIL (2 HIGH findings)',
  'exit code 1',
].join('\n');

const GITHUB_SNIPPET = [
  'jobs:',
  '  veylqorix:',
  '    uses: your-org/veylqorix/',
  '           .github/workflows/veylqorix-gate.yml@main',
  '    with:',
  '      root: .',
  '      run-tests: false',
  '      block-on: HIGH,CRITICAL',
].join('\n');

const MCP_SNIPPET = [
  '{',
  '  "mcpServers": {',
  '    "veylqorix": {',
  '      "command": "node",',
  '      "args": ["/ABSOLUTE/PATH/to/Veylqorix/packages/mcp-server/dist/bin.js"],',
  '      "env": {',
  '        "VEYLQORIX_ROOTS": "/ABSOLUTE/PATH/to/your/project",',
  '        "VEYLQORIX_TIMEOUT_MS": "120000"',
  '      }',
  '    }',
  '  }',
  '}',
].join('\n');

export function Integrations() {
  return (
    <section id="integrations" aria-labelledby="integrations-title" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <SectionTitle index="04 / Integrations" title="Where it plugs in">
        Editor agents get the engine through MCP tools. Humans get a CLI. CI gets a gate that can
        block a merge.
      </SectionTitle>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[repeat(3,minmax(0,1fr))]">
        <div className="pixel-box press rounded p-5">
          <div className="pixel-box-flat flex h-12 w-12 items-center justify-center rounded font-mono text-sm font-bold text-ink">
            MCP
          </div>
          <h3 className="mt-4 text-lg font-extrabold text-ink">MCP server</h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-dim">
            Six validated tools for AI agents — <code className="font-mono text-[13px]">scan_repository</code>,{' '}
            <code className="font-mono text-[13px]">scan_dependencies</code>,{' '}
            <code className="font-mono text-[13px]">scan_secrets</code>,{' '}
            <code className="font-mono text-[13px]">run_security_checks</code>,{' '}
            <code className="font-mono text-[13px]">get_findings</code>,{' '}
            <code className="font-mono text-[13px]">validate_fix</code>. Claude Code, Codex,
            and Cursor share one server config.
          </p>
        </div>

        <div className="pixel-box press rounded p-5 lg:col-span-2">
          <h3 className="text-lg font-extrabold text-ink">CLI & CI</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <ScreenCard label="cli" title="Run a scan" code={CLI_SNIPPET} />
            <ScreenCard label="github-actions" title="Reusable gate workflow" code={GITHUB_SNIPPET} />
          </div>
          <div className="mt-4">
            <ScreenCard label="mcp" title="MCP client config" code={MCP_SNIPPET} />
          </div>
        </div>
      </div>

      {/* Skills */}
      <div className="pixel-box press mt-5 rounded p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-extrabold text-ink">Skills</h3>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-dim">
              A portable <code className="font-mono text-[13px]">SKILL.md</code> (Anthropic Agent Skills
              format) teaches an agent the Veylqorix workflow: run the real scanners, read the gate
              verdict, and never ship what the policy blocks. Ships with ready-made MCP configs for
              Claude Code, Codex, and Cursor.
            </p>
          </div>
          <div className="pixel-box--screen rounded px-4 py-3">
            <p className="font-mono text-sm text-screen-ink">$ pnpm --filter @veylqorix/skills</p>
            <p className="font-mono text-xs text-screen-dim">skill + mcp configs</p>
          </div>
        </div>
      </div>
    </section>
  );
}
