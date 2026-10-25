import type { ReactNode } from "react";

/**
 * Shared building blocks for showcase content. All are plain server-safe
 * components (no hooks, no "use client") so content pages stay static.
 *
 * Design-system notes:
 * - Card chrome uses the `.pixel-box` / `.pixel-box--screen` signature
 *   classes from globals.css; interactive cards may add `.press`.
 * - Colors come from the CSS-variable tokens (Tailwind classes: bg-navy,
 *   text-screen-ink, border-line, ...). Never hardcode hex values.
 * - No emoji anywhere in copy.
 */

/**
 * A content section with a pixel kicker label, an h2 heading, and body.
 *
 * @param id      Anchor id for in-page links (footer deep links).
 * @param kicker  Short uppercase label rendered in `.pixel-label`.
 * @param title   Section heading, rendered as <h2>.
 * @param children Section body.
 */
export function Section({
  id,
  kicker,
  title,
  children,
}: {
  id?: string;
  kicker?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {kicker ? (
          <span className="pixel-label text-teal-deep">{kicker}</span>
        ) : null}
        <h2 className="text-2xl font-extrabold tracking-tight text-navy sm:text-3xl">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

/**
 * A pixel-box card.
 *
 * @param press  Adds the `.press` hover/active translation (interactive cards).
 * @param screen Dark variant (`.pixel-box--screen`, screen-ink text).
 * @param title  Optional `.pixel-label` heading inside the card.
 * @param children Card body.
 */
export function Card({
  press = false,
  screen = false,
  title,
  className = "",
  children,
}: {
  press?: boolean;
  screen?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  const boxClass = screen ? "pixel-box--screen" : "pixel-box";
  return (
    <div className={`${boxClass} ${press ? "press" : ""} p-4 sm:p-5 ${className}`}>
      {title ? <p className={`pixel-label mb-2 ${screen ? "text-mint" : "text-navy"}`}>{title}</p> : null}
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}

/**
 * A `.pixel-blocks` square-block meter.
 *
 * @param total   Number of blocks in the meter.
 * @param filled  Number of leading blocks that are filled.
 * @param color   CSS color for filled blocks (via the --block-color var).
 * @param label   Optional small caption under the meter.
 */
export function Meter({
  total,
  filled,
  color,
  label,
}: {
  total: number;
  filled: number;
  color?: string;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(filled, total));
  return (
    <div className="min-w-0">
      <div
        className="pixel-blocks max-w-xs"
        style={color ? ({ "--block-color": color } as React.CSSProperties) : undefined}
      >
        {Array.from({ length: total }, (_, i) => (
          <span key={i} data-filled={i < clamped ? "" : undefined} />
        ))}
      </div>
      {label ? <p className="pixel-label-sm mt-2 text-ink-dim">{label}</p> : null}
    </div>
  );
}

/**
 * A terminal-style panel: `.pixel-box--screen` with a title row and mono content.
 *
 * @param title Title shown on the panel's header strip.
 * @param children Typically <pre> (scrolls internally; pre never forces page
 *                 scroll thanks to globals.css) or mono <div> content.
 */
export function Terminal({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pixel-box--screen overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b-4 border-line bg-screen-2 px-4 py-2">
        <span className="pixel-label-sm text-mint">{title}</span>
        <span className="pixel-label-sm text-screen-dim">veylqorix</span>
      </div>
      <div className="overflow-x-auto p-4 font-mono text-sm text-screen-ink">{children}</div>
    </div>
  );
}

/**
 * A styled table wrapped in an overflow-x-auto container (360px safe).
 *
 * @param head   Column headers (th cells).
 * @param rows   Array of row cell arrays (each string or ReactNode).
 */
export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-separate border-spacing-0 text-left text-sm">
        <thead>
          <tr>
            {head.map((h) => (
              <th
                key={h}
                scope="col"
                className="pixel-label border-b-4 border-line bg-surface-2 px-3 py-2 text-navy"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="align-top">
              {cells.map((cell, j) => (
                <td
                  key={j}
                  className={`px-3 py-2.5 leading-relaxed text-ink ${j < cells.length - 1 ? "pr-4" : ""}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A pull-quote panel (`.pixel-box--screen` variant).
 *
 * @param children Quote text.
 * @param cite     Optional attribution line.
 */
export function Quote({ children, cite }: { children: ReactNode; cite?: string }) {
  return (
    <figure className="pixel-box--screen p-5 sm:p-6">
      <blockquote className="text-base font-medium leading-relaxed text-screen-ink sm:text-lg">
        {children}
      </blockquote>
      {cite ? (
        <figcaption className="pixel-label-sm mt-3 text-screen-dim">{cite}</figcaption>
      ) : null}
    </figure>
  );
}
