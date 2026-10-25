import {
  Boxes,
  EyeOff,
  ScanSearch,
  ShieldCheck,
  SlidersHorizontal,
  FileText,
  type LucideIcon,
} from 'lucide-react';
import { SectionTitle } from '../header';

const CAPABILITIES: Array<{
  icon: LucideIcon;
  accent: string;
  title: string;
  body: string;
}> = [
  {
    icon: Boxes,
    accent: 'text-teal-deep',
    title: 'Dependency auditing',
    body: 'Lockfile-aware advisory checks for node, python, and more: which packages are vulnerable, at which version, and what fixes them.',
  },
  {
    icon: EyeOff,
    accent: 'text-coral-faint',
    title: 'Secret detection (redacted)',
    body: 'Built-in rules for common key and token formats. Evidence is redacted in reports, and exposed secrets block the gate by default.',
  },
  {
    icon: ScanSearch,
    accent: 'text-teal-deep',
    title: 'Static analysis',
    body: 'Scanner adapters plug into the same normalized finding model, so SAST results are compared and reported alongside dependency and secret findings.',
  },
  {
    icon: ShieldCheck,
    accent: 'text-ink',
    title: 'Quality gate',
    body: 'PASS / FAIL / INCOMPLETE verdicts with a deterministic exit code. Incomplete coverage is never treated as clean — by design.',
  },
  {
    icon: SlidersHorizontal,
    accent: 'text-gold-faint',
    title: 'Policy engine',
    body: 'One JSON policy decides which severities block, which are reported, and which documented exceptions apply. Every exception is auditable.',
  },
  {
    icon: FileText,
    accent: 'text-teal-deep',
    title: 'SARIF / JSON reports',
    body: 'Machine-readable JSON and SARIF (GitHub code scanning) plus human-readable Markdown reports — from the CLI, MCP tools, and the API.',
  },
];

export function Capabilities() {
  return (
    <section id="product" aria-labelledby="capabilities-title" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <SectionTitle index="03 / Product" title="Capabilities">
        Six jobs, one engine: every scanner outputs the same normalized findings, so one policy
        and one gate cover the whole picture.
      </SectionTitle>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {CAPABILITIES.map(({ icon: Icon, accent, title, body }) => (
          <article key={title} className="pixel-box press rounded p-5">
            <div className="pixel-box-flat flex h-12 w-12 items-center justify-center rounded">
              <Icon className={`h-6 w-6 ${accent}`} aria-hidden="true" />
            </div>
            <h3 className="mt-4 text-lg font-extrabold text-ink">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-dim">{body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
