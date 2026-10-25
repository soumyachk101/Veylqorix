import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { SectionTitle } from '../header';

export function Architecture() {
  return (
    <section id="architecture" aria-labelledby="architecture-title" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <SectionTitle index="02 / How it works" title="Platform architecture">
        AI coding agents and the CLI feed one detection engine. Findings from every scanner are
        normalized, evaluated by your policy, and reported to the gate — and to the dashboard.
      </SectionTitle>

      <div className="pixel-box rounded p-5 sm:p-8">
        {/* Agents */}
        <Stage label="Agents & entry points">
          <Chip name="Claude Code" sub="MCP" />
          <Chip name="Codex" sub="MCP" />
          <Chip name="Cursor" sub="MCP" />
          <Chip name="MCP server" sub="tools" />
          <Chip name="CLI" sub="veylqorix" />
        </Stage>
        <FlowArrow />
        {/* Core engine */}
        <div className="pixel-box--screen rounded p-4 sm:p-5">
          <p className="pixel-label-sm mb-3 text-mint">Core engine</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <EngineStep name="detect" sub="ecosystem & manifests" />
            <EngineStep name="scan" sub="deps · secrets · SAST · quality" />
            <EngineStep name="normalize" sub="one finding model" />
            <EngineStep name="policy" sub="block / report / exempt" />
            <EngineStep name="report" sub="SARIF · JSON · Markdown" />
          </div>
        </div>
        <FlowArrow />
        {/* Gates */}
        <Stage label="Gates">
          <Chip name="Git hooks" sub="pre-commit" />
          <Chip name="GitHub Actions" sub="required check" />
        </Stage>
        <FlowArrow />
        {/* Dashboard */}
        <div className="pixel-box--screen rounded p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="pixel-label-sm text-mint">Dashboard</p>
              <p className="mt-1 font-mono text-sm text-screen-ink">
                live scans · findings · gate verdict · history
              </p>
            </div>
            <Link
              href="/dashboard"
              className="pixel-box press flex items-center gap-2 rounded bg-surface px-4 py-2 text-sm font-bold text-ink"
            >
              Open it
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function Stage({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="pixel-label-sm mb-2 text-ink-dim">{label}</p>
      <div className="flex flex-wrap gap-3">{children}</div>
    </div>
  );
}

function Chip({ name, sub }: { name: string; sub: string }) {
  return (
    <div className="pixel-box rounded px-4 py-2.5">
      <p className="text-sm font-bold text-ink">{name}</p>
      <p className="font-mono text-xs text-ink-dim">{sub}</p>
    </div>
  );
}

function EngineStep({ name, sub }: { name: string; sub: string }) {
  return (
    <div className="rounded border-2 border-line bg-screen-2 px-3 py-2">
      <p className="pixel-label-sm text-screen-ink">{name}</p>
      <p className="mt-1 text-xs text-screen-dim">{sub}</p>
    </div>
  );
}

function FlowArrow() {
  return (
    <div aria-hidden="true" className="flex justify-center py-2">
      <svg width="24" height="20" viewBox="0 0 24 20" fill="none" className="text-line">
        <path d="M12 0 V12 M4 8 L12 16 L20 8 M12 16 V20" stroke="currentColor" strokeWidth="4" strokeLinecap="square" />
      </svg>
    </div>
  );
}
