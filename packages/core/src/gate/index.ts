import {
  SEVERITY_ORDER,
  type CheckResult,
  type Finding,
  type GateDecision,
  type Policy,
  type PolicyException,
  type ScannerResult,
  type CoverageLevel,
  type ResolvedPolicy,
} from '../types.js';
import { globMatch } from '../policy.js';

/**
 * Evaluate the quality gate over a completed audit.
 *
 * Rules:
 * - A confirmed finding at a blocking severity blocks the gate.
 * - An exposed secret blocks when `blockOnSecrets` is true.
 * - A failing required test blocks when `blockOnTestFailure` is true.
 * - A scanner execution error blocks when `blockOnScannerError` is true.
 * - An unexpectedly skipped mandatory check blocks when `blockOnSkippedCheck` is true.
 * - Reported findings that are below the blocking severity are included in the
 *   decision but do not cause a FAIL on their own.
 * - Any active exception suppresses findings it matches, but the exception is
 *   recorded in the decision so it can be audited.
 * - When a scanner errored or a mandatory check was skipped, the gate cannot
 *   be INCOMPLETE-AND-PASS: an error in a mandatory scanner forces INCOMPLETE,
 *   and a blocking error forces FAIL.
 */
export function evaluateGate(options: {
  findings: Finding[];
  checks: CheckResult[];
  scanners: ScannerResult[];
  policy: ResolvedPolicy;
}): GateDecision {
  const { policy, checks, scanners, findings } = options;
  const p = policy.policy;
  const blockingSeverities = new Set(p.blockOnSeverity);

  const appliedExceptions: GateDecision['appliedExceptions'] = [];
  const suppressedIds = new Set<string>();

  for (const exc of p.exceptions) {
    const matched = findings.filter((f) => findingMatchesException(exc, f));
    if (matched.length > 0) {
      for (const f of matched) suppressedIds.add(f.id);
      appliedExceptions.push({
        ruleId: exc.ruleId,
        reason: exc.reason,
        suppressed: matched.length,
      });
    }
  }

  const effectiveFindings = findings.filter((f) => !suppressedIds.has(f.id));

  const blockingFindings = effectiveFindings.filter(
    (f) => blockingSeverities.has(f.severity) || (p.blockOnSecrets && f.secret),
  );

  const reportedFindings = effectiveFindings.filter(
    (f) => !blockingFindings.includes(f),
  );

  const scannerErrors = scanners.filter((s) => s.status === 'ERROR');
  const skippedMandatory = scanners.filter((s) => s.status === 'SKIPPED');
  const failedChecks = checks.filter((c) => c.status === 'FAIL');
  const erroredChecks = checks.filter((c) => c.status === 'ERROR');

  const blockingReasons: string[] = [];
  for (const f of blockingFindings) {
    blockingReasons.push(
      `${f.secret ? 'Exposed secret' : `${f.severity} finding`} ${f.id} (${f.scanner}/${f.ruleId}): ${f.title}`,
    );
  }
  if (p.blockOnTestFailure) {
    for (const c of failedChecks) {
      blockingReasons.push(`Required check '${c.id}' failed: ${c.command}`);
    }
  }
  if (p.blockOnScannerError) {
    for (const s of scannerErrors) {
      blockingReasons.push(`Required scanner '${s.scanner}' errored: ${s.error?.message}`);
    }
  }
  if (p.blockOnSkippedCheck) {
    for (const s of skippedMandatory) {
      blockingReasons.push(`Mandatory scanner '${s.scanner}' was skipped: ${s.notes[0]}`);
    }
  }

  // Coverage: degrade based on what actually ran.
  const ranCleanly =
    scannerErrors.length === 0 &&
    skippedMandatory.length === 0 &&
    erroredChecks.length === 0;

  let coverage: CoverageLevel;
  if (scannerErrors.length === 0 && skippedMandatory.length === 0) {
    coverage = 'FULL';
  } else if (scannerErrors.length > 0 || skippedMandatory.length > 0) {
    coverage = skippedMandatory.length > 0 && scannerErrors.length > 0 ? 'PARTIAL' : 'LIMITED';
  } else {
    coverage = 'NONE';
  }

  if (ranCleanly && blockingReasons.length === 0) {
    return {
      result: 'PASS',
      blockingReasons,
      reportedFindings,
      incompleteReasons: [],
      coverage,
      appliedExceptions,
    };
  }

  // A mandatory scanner that errored or was skipped prevents a clean PASS even
  // without blocking findings, because the audit is incomplete.
  const incompleteReasons: string[] = [];
  for (const s of scannerErrors) {
    incompleteReasons.push(`Scanner '${s.scanner}' errored: ${s.error?.message}`);
  }
  for (const s of skippedMandatory) {
    incompleteReasons.push(`Scanner '${s.scanner}' was skipped: ${s.notes[0] ?? 'no note'}`);
  }
  for (const c of erroredChecks) {
    incompleteReasons.push(`Check '${c.id}' errored: ${c.error?.message}`);
  }

  let result: GateDecision['result'];
  if (blockingReasons.length > 0) {
    result = 'FAIL';
  } else if (incompleteReasons.length > 0) {
    result = 'INCOMPLETE';
  } else {
    result = 'PASS';
  }

  return {
    result,
    blockingReasons,
    reportedFindings,
    incompleteReasons,
    coverage,
    appliedExceptions,
  };
}

function findingMatchesException(exc: PolicyException, finding: Finding): boolean {
  if (exc.ruleId !== finding.ruleId) return false;
  if (exc.pathGlob && !globMatch(exc.pathGlob, finding.location?.file ?? '')) return false;
  return true;
}

/**
 * Compute a deterministic exit code for a completed audit.
 * 0 = PASS, 1 = FAIL (blocking reasons present), 2 = INCOMPLETE (no blocking
 * reasons but coverage was degraded). The code is stable regardless of how
 * many findings were reported.
 */
export function exitCodeFor(decision: GateDecision, coverage: CoverageLevel): number {
  if (decision.result === 'FAIL') return 1;
  if (decision.result === 'INCOMPLETE') return 2;
  if (coverage === 'LIMITED') return 2;
  return 0;
}
