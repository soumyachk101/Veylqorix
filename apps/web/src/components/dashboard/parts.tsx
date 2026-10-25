'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import type { GateResult, Severity } from '../../lib/types';

export function PixelLabel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`pixel-label-sm text-ink-dim ${className}`}>{children}</p>;
}

export function Panel({
  label,
  right,
  children,
  className = '',
}: {
  label?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`pixel-box rounded p-5 ${className}`}>
      {(label || right) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {label ? <h2 className="pixel-label-sm text-ink-dim">{label}</h2> : <span />}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export const SEVERITY_COLOR: Record<Severity, string> = {
  CRITICAL: 'var(--color-coral)',
  HIGH: 'var(--color-gold)',
  MEDIUM: 'var(--color-teal)',
  LOW: 'var(--color-mint)',
  INFO: 'var(--color-screen-dim)',
};

/** Small hard-edged severity chip. */
export function SeverityChip({ severity }: { severity: Severity }) {
  const darkText = severity === 'MEDIUM' || severity === 'LOW' || severity === 'INFO';
  return (
    <span
      className="inline-flex items-center rounded border-2 border-ink px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wide"
      style={{
        background: SEVERITY_COLOR[severity],
        color: darkText ? 'var(--color-ink)' : 'var(--color-surface)',
      }}
    >
      {severity}
    </span>
  );
}

const GATE_STYLE: Record<GateResult, { bg: string; fg: string }> = {
  PASS: { bg: 'var(--color-mint)', fg: 'var(--color-ink)' },
  FAIL: { bg: 'var(--color-coral)', fg: 'var(--color-surface)' },
  INCOMPLETE: { bg: 'var(--color-gold)', fg: 'var(--color-ink)' },
};

export function GateChip({ result }: { result: GateResult }) {
  const s = GATE_STYLE[result];
  return (
    <span
      className="inline-flex items-center rounded border-2 border-ink px-2.5 py-1 font-mono text-xs font-bold uppercase"
      style={{ background: s.bg, color: s.fg }}
    >
      {result}
    </span>
  );
}

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  RUNNING: { bg: 'var(--color-gold)', fg: 'var(--color-ink)' },
  DONE: { bg: 'var(--color-mint)', fg: 'var(--color-ink)' },
  ERROR: { bg: 'var(--color-coral)', fg: 'var(--color-surface)' },
  PASS: { bg: 'var(--color-mint)', fg: 'var(--color-ink)' },
  FAIL: { bg: 'var(--color-coral)', fg: 'var(--color-surface)' },
  SKIPPED: { bg: 'var(--color-surface-2)', fg: 'var(--color-ink-dim)' },
};

export function StatusChip({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? { bg: 'var(--color-surface-2)', fg: 'var(--color-ink-dim)' };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded border-2 border-ink px-2 py-0.5 font-mono text-[11px] font-bold uppercase"
      style={{ background: s.bg, color: s.fg }}
    >
      {status === 'RUNNING' && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
      {status}
    </span>
  );
}

/**
 * Pixel-block meter: 10 hard-segmented squares, filled proportionally.
 * CSS-only — no chart library.
 */
export function PixelBlocks({
  value,
  max,
  color,
  count,
}: {
  value: number;
  max: number;
  color: string;
  count?: number;
}) {
  const blocks = 10;
  const filled = max <= 0 ? 0 : Math.round((value / max) * blocks);
  return (
    <div
      className="pixel-blocks"
      style={{ ['--block-color' as string]: color }}
      role="img"
      aria-label={count != null ? `${count} items` : `value ${value} of ${max}`}
    >
      {Array.from({ length: blocks }, (_, i) => (
        <span key={i} data-filled={i < filled ? '' : undefined} />
      ))}
    </div>
  );
}

/** Skeleton pixel-box placeholder for loading states. */
export function Skeleton({ lines = 2, tall = false }: { lines?: number; tall?: boolean }) {
  return (
    <div className={`pixel-box rounded p-4 ${tall ? 'min-h-40' : ''}`} aria-hidden="true" data-testid="skeleton">
      <div className="space-y-2.5">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="h-3 rounded bg-surface-2" style={{ width: `${90 - i * 18}%` }} />
        ))}
      </div>
    </div>
  );
}

export function ErrorState({ title, detail, onRetry }: { title: string; detail?: string; onRetry?: () => void }) {
  return (
    <div className="pixel-box rounded p-5" role="alert" data-testid="error-state">
      <p className="pixel-label-sm text-coral-faint">{title}</p>
      {detail && <p className="mt-2 text-sm text-ink-dim">{detail}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="btn-primary mt-4 text-sm"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="pixel-box rounded p-6 text-center" data-testid="empty-state">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded border-4 border-line bg-surface-2 mx-auto">
        <span aria-hidden="true" className="grid grid-cols-2 gap-0.5">
          <span className="h-1.5 w-1.5 bg-teal" />
          <span className="h-1.5 w-1.5 bg-mint" />
          <span className="h-1.5 w-1.5 bg-gold" />
          <span className="h-1.5 w-1.5 bg-coral" />
        </span>
      </div>
      <p className="pixel-label text-ink">{title}</p>
      {detail && <p className="mx-auto mt-3 max-w-md text-sm text-ink-dim">{detail}</p>}
      {children ? <div className="mt-5">{children}</div> : null}
    </div>
  );
}

/** Clearly-labeled demo banner (used only when intentionally showing sample data). */
export function DemoBanner({ children }: { children: ReactNode }) {
  return (
    <div className="rounded border-4 border-gold bg-surface px-4 py-2.5 text-sm" role="status" data-testid="demo-banner">
      <span className="pixel-label-sm mr-2 text-gold-faint">SAMPLE DATA</span>
      <span className="text-ink-dim">{children}</span>
    </div>
  );
}

export function LiveBanner({ children }: { children: ReactNode }) {
  return (
    <div className="rounded border-4 border-teal bg-surface px-4 py-2.5 text-sm" role="status" data-testid="live-banner">
      <span className="pixel-label-sm mr-2 text-teal-deep">LIVE</span>
      <span className="text-ink-dim">{children}</span>
    </div>
  );
}
