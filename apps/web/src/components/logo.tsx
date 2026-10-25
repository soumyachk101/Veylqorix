/**
 * Veylqorix mark: an original inline-SVG shield with a pixel accent.
 * The pixel step at the right edge of the shield echoes the platform's
 * pixel-block design language.
 */
export function Logo({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      role="img"
      aria-label="Veylqorix logo"
      fill="none"
    >
      {/* shield body */}
      <path
        d="M24 4 L42 10 V24 C42 35 34 41.5 24 44 C14 41.5 6 35 6 24 V10 Z"
        fill="var(--color-screen)"
        stroke="var(--color-line)"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      {/* pixel accent: stepped block inside the shield */}
      <g fill="var(--color-mint)">
        <rect x="18" y="17" width="6" height="6" />
        <rect x="24" y="14" width="6" height="6" />
        <rect x="24" y="20" width="6" height="6" fill="var(--color-gold)" />
        <rect x="18" y="23" width="6" height="6" />
        <rect x="24" y="26" width="6" height="6" fill="var(--color-teal)" />
        <rect x="18" y="29" width="6" height="6" fill="var(--color-teal-deep)" />
      </g>
    </svg>
  );
}
