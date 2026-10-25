import {
  CONFIDENCE_ORDER,
  SEVERITY_ORDER,
  type Confidence,
  type Policy,
  type PolicyException,
  type ResolvedPolicy,
  type Severity,
} from './types.js';

/** The default policy: critical/high and secrets block, medium/low report. */
export const DEFAULT_POLICY: Policy = {
  blockOnSeverity: ['CRITICAL', 'HIGH'],
  blockOnSecrets: true,
  blockOnTestFailure: true,
  blockOnScannerError: true,
  blockOnSkippedCheck: true,
  reportOnSeverity: ['MEDIUM', 'LOW'],
  maxExceptions: 5,
  exceptions: [],
};

function isExceptionActive(exc: PolicyException, now: Date = new Date()): boolean {
  if (exc.expires && exc.expires < now.toISOString()) return false;
  if (typeof exc.reason !== 'string' || exc.reason.trim().length === 0) return false;
  return true;
}

/** Minimal `*`, `?`, and `**` glob used to scope exceptions to paths. `*` stays within a path segment; `**` crosses segments. */
export function globMatch(pattern: string, value: string): boolean {
  const regex =
    '^' +
    pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '§§')
      .replace(/\*/g, '[^/]*')
      .replace(/§§/g, '.*')
      .replace(/\?/g, '.') +
    '$';
  return new RegExp(regex).test(value);
}

/**
 * Resolve a policy: merge user overrides on top of defaults, validate that
 * exceptions are documented and not expired, and cap the number of active
 * exceptions at `maxExceptions` so that a policy cannot silently suppress an
 * unbounded set of findings.
 */
export function resolvePolicy(input?: Partial<Policy>): ResolvedPolicy {
  const policy: Policy = {
    ...DEFAULT_POLICY,
    ...input,
    exceptions: (input?.exceptions ?? []).filter((e) => isExceptionActive(e)),
  };

  const notes: string[] = [];
  if (policy.blockOnSeverity.length === 0 && policy.reportOnSeverity.length === 0) {
    notes.push('No severities are configured to block or report; the gate will pass unless a scanner errors.');
  }
  const activeExceptions = policy.exceptions.length;
  if (activeExceptions > policy.maxExceptions) {
    notes.push(
      `Policy exceeded maxExceptions (${activeExceptions} active of ${policy.maxExceptions}); keeping the first ${policy.maxExceptions} in document order.`,
    );
    policy.exceptions = policy.exceptions.slice(0, policy.maxExceptions);
  }
  if (activeExceptions > 0) {
    notes.push(`${activeExceptions} documented exception(s) are active and will be recorded in the gate decision.`);
  }

  return { policy, notes };
}

/** Minimal finding shape required for deterministic ordering. */
export interface FindingLike {
  severity: Severity;
  confidence: Confidence;
  ruleId: string;
  location?: { file?: string };
}

/**
 * Compare two findings using a deterministic ordering used when sorting
 * reports and when exceptions are applied to specific findings.
 */
export function compareFindings(a: FindingLike, b: FindingLike): number {
  const sev = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
  if (sev !== 0) return sev;
  const conf = CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence];
  if (conf !== 0) return conf;
  if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
  return (a.location?.file ?? '').localeCompare(b.location?.file ?? '');
}

export function sortBySeverity<T extends FindingLike>(items: T[]): T[] {
  return [...items].sort((a, b) => compareFindings(a, b));
}
