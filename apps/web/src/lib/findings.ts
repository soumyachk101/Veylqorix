import type { Finding, Severity } from './types';
import { SEVERITIES } from './types';

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const out: Record<Severity, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    INFO: 0,
  };
  for (const f of findings) {
    out[f.severity] = (out[f.severity] ?? 0) + 1;
  }
  return out;
}

export function totalFindings(findings: Finding[]): number {
  return findings.length;
}

/** `file:line` label for a finding location, or empty. */
export function locLabel(f: Finding): string {
  if (!f.location) return '';
  const line = f.location.line != null ? `:${f.location.line}` : '';
  const col = f.location.column != null ? `:${f.location.column}` : '';
  return `${f.location.file}${line}${col}`;
}

export { SEVERITIES };
