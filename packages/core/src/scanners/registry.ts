import { makeFinding } from '../finding.js';
import type {
  CheckResult,
  Finding,
  ProjectDetection,
  ScannerResult,
  Severity,
} from '../types.js';

export interface ScannerContext {
  root: string;
  detection: ProjectDetection;
  timeoutMs: number;
  offline: boolean;
  /** Deterministic mock findings keyed by scanner name, for tests. */
  mocks?: Record<string, Finding[]>;
}

export interface ScannerDefinition {
  name: string;
  /** True when the scanner must run for the result to be considered complete. */
  mandatory: boolean;
  run(context: ScannerContext): Promise<ScannerResult>;
}

/**
 * Wrap a scanner so that it can never take down the audit. A thrown error or
 * an overrunning timeout becomes an ERROR result, which the gate treats as
 * incomplete coverage rather than a pass.
 */
export async function runScannerSafely(
  scanner: ScannerDefinition,
  context: ScannerContext,
): Promise<ScannerResult> {
  const startedAt = Date.now();
  try {
    const result = await withTimeout(
      scanner.run(context),
      context.timeoutMs,
      scanner.name,
    );
    if (result.durationMs === 0) {
      result.durationMs = Date.now() - startedAt;
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as NodeJS.ErrnoException).code;
    const isTimeout = code === 'ETIMEDOUT' || message.includes('timed out');
    return {
      scanner: scanner.name,
      status: 'ERROR',
      findings: [],
      durationMs: Date.now() - startedAt,
      error: {
        message: isTimeout
          ? `Scanner '${scanner.name}' timed out after ${context.timeoutMs / 1000}s`
          : `Scanner '${scanner.name}' failed: ${message}`,
        code: isTimeout ? 'ETIMEDOUT' : code,
      },
      notes: ['The scanner did not complete; coverage for this check is unknown.'],
    };
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
    this.code = 'ETIMEDOUT';
  }
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(`Operation '${label}' timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Normalize findings coming out of a scanner: fill in required fields,
 * enforce a valid severity/confidence, and drop anything malformed so that a
 * bad scanner response cannot corrupt the report.
 */
export function normalizeFindings(
  scannerName: string,
  raw: unknown,
): { findings: Finding[]; rejected: number } {
  if (!Array.isArray(raw)) return { findings: [], rejected: 1 };
  const findings: Finding[] = [];
  let rejected = 0;
  const validSeverities: Severity[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  const validConfidences = ['LOW', 'MEDIUM', 'HIGH', 'CONFIRMED'];

  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      rejected++;
      continue;
    }
    const candidate = item as Partial<Finding>;
    if (typeof candidate.title !== 'string' || candidate.title.length === 0) {
      rejected++;
      continue;
    }
    if (typeof candidate.ruleId !== 'string' || candidate.ruleId.length === 0) {
      rejected++;
      continue;
    }
    const severity = validSeverities.includes(candidate.severity as Severity)
      ? (candidate.severity as Severity)
      : 'MEDIUM';
    const confidence = validConfidences.includes(candidate.confidence as 'LOW')
      ? (candidate.confidence as 'LOW')
      : 'MEDIUM';

    findings.push(
      makeFinding({
        scanner: candidate.scanner ?? scannerName,
        ruleId: candidate.ruleId,
        title: candidate.title,
        severity,
        confidence,
        file: candidate.location?.file,
        line: candidate.location?.line,
        column: candidate.location?.column,
        dependency: candidate.dependency,
        evidence: candidate.evidence,
        remediation: candidate.remediation,
        advisory: candidate.advisory,
        secret: candidate.secret,
      }),
    );
  }
  return { findings, rejected };
}
