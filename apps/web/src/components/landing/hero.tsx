'use client';

import Link from 'next/link';
import { ArrowRight, FileSearch } from 'lucide-react';

export function Hero() {
  return (
    <section aria-labelledby="hero" className="mx-auto max-w-6xl px-4 pt-14 sm:px-6 sm:pt-20">
      <div className="pixel-box press rounded p-6 sm:p-10">
        <p className="pixel-label text-teal-deep" aria-hidden="true">
          01 / No Unsafe Code Gets Through
        </p>
        <h1 id="hero" className="text-pixel-shadow mt-4 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight text-ink sm:text-6xl">
          No Unsafe Code Gets Through.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-ink-dim sm:text-xl">
          Veylqorix is an AI-native code security platform. It audits dependencies, detects and redacts
          secrets, runs static analysis, and enforces a policy-driven quality gate — from your editor agent
          to your CI pipeline.
        </p>
        <div className="mt-8 flex flex-wrap gap-4">
          <Link
            href="/dashboard"
            className="pixel-box press flex items-center gap-2 rounded bg-navy px-6 py-3 font-bold text-screen-ink"
          >
            Open Dashboard
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link
            href="/dashboard"
            className="pixel-box press flex items-center gap-2 rounded bg-surface px-6 py-3 font-bold text-ink"
          >
            <FileSearch className="h-4 w-4 text-teal-deep" aria-hidden="true" />
            See a live scan report
          </Link>
        </div>
        <p className="mt-5 text-sm text-ink-dim">
          The dashboard reads real scan data from the Veylqorix API. Start the API with{' '}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-ink">
            pnpm --filter @veylqorix/api start
          </code>{' '}
          and register a repository to run a scan.
        </p>
      </div>
    </section>
  );
}
