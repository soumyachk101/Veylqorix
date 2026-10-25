'use client';

import Link from 'next/link';
import { ArrowRight, FileSearch, ShieldCheck, Crosshair, Lock, PlayCircle } from 'lucide-react';

/** A tiny severity chip matching the dashboard's language. */
function SeverityChip({ label, tone }: { label: string; tone: 'crit' | 'high' | 'med' | 'ok' }) {
  const map = {
    crit: 'bg-coral text-screen',
    high: 'bg-gold text-screen',
    med: 'bg-mint text-screen',
    ok: 'bg-teal text-screen',
  } as const;
  return (
    <span className={`pixel-label-sm rounded px-2 py-1 ${map[tone]}`}>{label}</span>
  );
}

/** One row of the mock terminal: stacks vertically on narrow phones,
 *  title-left/meta-right on wider screens. */
function TerminalRow({
  chip,
  tone,
  title,
  meta,
}: {
  chip: string;
  tone: 'crit' | 'high' | 'med' | 'ok';
  title: string;
  meta: string;
}) {
  return (
    <div className="rounded border-2 border-line bg-screen-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityChip label={chip} tone={tone} />
        <span className="text-screen-ink">{title}</span>
      </div>
      <p className="mt-1.5 break-words text-xs text-screen-dim">{meta}</p>
    </div>
  );
}

export function Hero() {
  return (
    <section aria-labelledby="hero" className="mx-auto max-w-6xl px-4 pb-16 pt-12 sm:px-6 sm:pt-16">
      <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Left: value proposition */}
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="pixel-label rounded bg-navy px-3 py-1.5 text-mint" aria-hidden="true">
              AI-native security
            </span>
            <span className="pixel-label text-teal-deep" aria-hidden="true">
              01 / No Unsafe Code Gets Through
            </span>
          </div>

          <h1
            id="hero"
            className="text-pixel-shadow mt-6 max-w-2xl text-4xl font-extrabold leading-[1.05] tracking-tight text-ink sm:text-6xl"
          >
            No Unsafe Code <span className="text-teal-deep">Gets Through.</span>
          </h1>

          <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-dim sm:text-xl">
            Veylqorix independently verifies code before it is committed, merged, or shipped — auditing
            dependencies, redacting secrets, running static analysis, and enforcing a policy-driven gate,
            from your editor agent to your CI pipeline.
          </p>

          <div className="mt-8 flex flex-wrap gap-4">
            <Link href="/dashboard" className="btn-primary text-base">
              Open Dashboard
              <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </Link>
            <Link href="/dashboard" className="btn-secondary text-base">
              <FileSearch className="h-5 w-5 text-teal-deep" aria-hidden="true" />
              See a live scan report
            </Link>
          </div>

          {/* Trust/proof line — honest, no invented claims */}
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 border-t-2 border-line-soft pt-6 text-sm text-ink-dim">
            <span className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-teal-deep" aria-hidden="true" />
              Deterministic policy gate
            </span>
            <span className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-teal-deep" aria-hidden="true" />
              Secrets redacted by default
            </span>
            <span className="flex items-center gap-2">
              <Crosshair className="h-4 w-4 text-teal-deep" aria-hidden="true" />
              Evidence for every finding
            </span>
          </div>
        </div>

        {/* Right: a mock "scan result" screen in the pixel-box language */}
        <div className="pixel-box--screen press rounded p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <span className="pixel-label-sm text-mint">veylq / security-report</span>
            <span className="pixel-label-sm text-coral">GATE · FAIL</span>
          </div>

          <div className="mt-4 space-y-2 font-mono text-[13px] leading-relaxed text-screen-ink">
            <p className="text-screen-dim">$ veylq scan --staged --strict</p>
            <p>
              <span className="text-mint">23 findings</span> · 2 critical · 5 high · 8 med · 9 low
            </p>

            <div className="mt-4 space-y-2">
              <TerminalRow chip="CRIT" tone="crit" title="Exposed AWS key" meta="config.js:12 · AKIA…CDEF (redacted)" />
              <TerminalRow chip="HIGH" tone="high" title="vulnerable dep" meta="lodash@4.17.15 → 4.17.21" />
              <TerminalRow chip="MED" tone="med" title="license risk" meta="GPL dep in MIT app" />
            </div>

            <p className="mt-4 flex items-center gap-2 text-mint">
              <PlayCircle className="h-4 w-4" aria-hidden="true" />
              fix &amp; re-run to verify — a fix isn't confirmed without a rescan
            </p>
          </div>

          <p className="mt-4 border-t-2 border-line-soft pt-3 font-mono text-[11px] text-screen-dim">
            Sample output. The dashboard reads real results from the Veylqorix API.
          </p>
        </div>
      </div>
    </section>
  );
}
