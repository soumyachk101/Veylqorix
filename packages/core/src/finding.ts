import {
  createHash,
} from 'node:crypto';
import type { Finding } from './types.js';

/**
 * Produce a deterministic, collision-resistant finding id from stable inputs.
 * Never include timestamps here: two identical findings across two runs must
 * produce the same id so that reports diff cleanly.
 */
export function findingId(scanner: string, ruleId: string, location: string | undefined, dependencyName: string | undefined, version: string | undefined): string {
  const basis = [scanner, ruleId, location ?? '', dependencyName ?? '', version ?? ''].join('|');
  const digest = createHash('sha1').update(basis).digest('hex').slice(0, 8);
  const prefix = scanner.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 12) || 'FIND';
  return `${prefix}-${digest.toUpperCase()}`;
}

/**
 * Build a Finding from partial inputs, filling in a deterministic id.
 * Findings are produced by scanners and normalized here so that no scanner
 * can emit a finding without the required fields.
 */
export function makeFinding(input: {
  scanner: string;
  ruleId: string;
  title: string;
  severity: Finding['severity'];
  confidence: Finding['confidence'];
  file?: string;
  line?: number;
  column?: number;
  dependency?: Finding['dependency'];
  evidence?: Finding['evidence'];
  remediation?: string;
  advisory?: string;
  secret?: boolean;
}): Finding {
  const id = findingId(
    input.scanner,
    input.ruleId,
    input.file,
    input.dependency?.name,
    input.dependency?.installedVersion ?? input.dependency?.fixedVersion,
  );
  return {
    id,
    title: input.title,
    scanner: input.scanner,
    ruleId: input.ruleId,
    severity: input.severity,
    confidence: input.confidence,
    location: input.file ? { file: input.file, ...(input.line ? { line: input.line } : {}), ...(input.column ? { column: input.column } : {}) } : undefined,
    dependency: input.dependency,
    evidence: input.evidence,
    remediation: input.remediation,
    advisory: input.advisory,
    secret: input.secret,
  };
}
