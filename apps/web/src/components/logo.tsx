import Link from 'next/link';

/**
 * Veylqorix mark: an original inline-SVG shield holding a compact "scan grid"
 * of pixel cells, one highlighted in gold to read as a detected finding.
 * A single, fixed mark used across the header, footer, and every page so the
 * brand stays consistent.
 */
export function Logo({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="Veylqorix logo" fill="none">
      {/* shield body */}
      <path
        d="M24 4 L42 10 V24 C42 35 34 41.5 24 44 C14 41.5 6 35 6 24 V10 Z"
        fill="var(--color-screen)"
        stroke="var(--color-line)"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      {/* scan grid: a tidy 3x3 of pixel cells, one flagged gold */}
      <g>
        <rect x="16" y="15" width="5" height="5" rx="0.5" fill="var(--color-mint)" opacity="0.85" />
        <rect x="22" y="15" width="5" height="5" rx="0.5" fill="var(--color-mint)" opacity="0.85" />
        <rect x="16" y="21" width="5" height="5" rx="0.5" fill="var(--color-teal)" opacity="0.9" />
        <rect x="22" y="21" width="5" height="5" rx="0.5" fill="var(--color-gold)" />
        <rect x="16" y="27" width="5" height="5" rx="0.5" fill="var(--color-teal-deep)" opacity="0.9" />
        <rect x="22" y="27" width="5" height="5" rx="0.5" fill="var(--color-mint)" opacity="0.55" />
        {/* scan line sweeping the grid */}
        <rect x="14" y="23.25" width="14" height="1" fill="var(--color-gold)" opacity="0.65" />
      </g>
    </svg>
  );
}

/**
 * The full brand lockup: mark + "VEYLQORIX" wordmark. Use this anywhere the
 * full logo is needed (header, footer). It links to the site root.
 */
export function Wordmark({ withLink = true }: { withLink?: boolean }) {
  const lockup = (
    <>
      <Logo className="h-9 w-9" />
      <span className="pixel-label text-ink">VEYLQORIX</span>
    </>
  );

  if (withLink) {
    return (
      <Link
        href="/"
        className="press pixel-box-flat flex items-center gap-3 rounded px-3 py-2"
        aria-label="Veylqorix home"
      >
        {lockup}
      </Link>
    );
  }
  return <div className="flex items-center gap-3">{lockup}</div>;
}
