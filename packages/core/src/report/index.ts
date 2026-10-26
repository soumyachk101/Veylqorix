import fs from 'node:fs';
import { sortBySeverity } from '../policy.js';
import type { AuditResult, Finding, ScannerResult } from '../types.js';
import { toSarif } from './sarif.js';

export { toSarif };

/**
 * Serialize an audit result as a deterministic JSON document. The document
 * includes the gate decision and scanner status so that CI consumers can
 * branch on structure, not on string output.
 */
export function toJson(audit: AuditResult): string {
  const doc = {
    schemaVersion: 1,
    tool: 'veylqorix',
    root: audit.root,
    startedAt: audit.startedAt,
    durationMs: audit.durationMs,
    detection: audit.detection,
    scanners: audit.scanners.map((s: ScannerResult) => ({
      scanner: s.scanner,
      status: s.status,
      durationMs: s.durationMs,
      notes: s.notes,
      summary: s.summary,
      error: s.error,
      findingCount: s.findings.length,
    })),
    checks: audit.checks,
    gate: audit.gate,
    coverage: audit.coverage,
    policy: {
      blockOnSeverity: audit.policy.policy.blockOnSeverity,
      blockOnSecrets: audit.policy.policy.blockOnSecrets,
      blockOnTestFailure: audit.policy.policy.blockOnTestFailure,
      blockOnScannerError: audit.policy.policy.blockOnScannerError,
      blockOnSkippedCheck: audit.policy.policy.blockOnSkippedCheck,
      exceptions: audit.policy.policy.exceptions,
    },
    findings: sortBySeverity(audit.findings),
  };
  return JSON.stringify(doc, null, 2);
}

const SEVERITY_BADGES: Record<string, string> = {
  CRITICAL: '🔴 CRITICAL',
  HIGH: '🟠 HIGH',
  MEDIUM: '🟡 MEDIUM',
  LOW: '🔵 LOW',
  INFO: '⚪ INFO',
};

function findingLine(f: Finding): string {
  const loc = f.location ? ` @ \`${f.location.file}${f.location.line ? `:${f.location.line}` : ''}\`` : '';
  const dep = f.dependency ? ` (${f.dependency.name}${f.dependency.installedVersion ? `@${f.dependency.installedVersion}` : ''})` : '';
  const conf = f.confidence !== 'CONFIRMED' ? ` [${f.confidence.toLowerCase()} confidence]` : '';
  return `- ${SEVERITY_BADGES[f.severity] ?? f.severity} \`${f.id}\` ${f.title}${dep}${loc}${conf}\n  - Rule: \`${f.scanner}/${f.ruleId}\`` +
    (f.advisory ? `\n  - Advisory: ${f.advisory}` : '') +
    (f.remediation ? `\n  - Remediation: ${f.remediation}` : '');
}

/**
 * Generate a human-readable Markdown report. Secret values in findings are
 * already redacted by the scanners, so this function does not reintroduce
 * them.
 */
export function toMarkdown(audit: AuditResult): string {
  const gate = audit.gate;
  const lines: string[] = [];
  const resultIcon = gate.result === 'PASS' ? '✅' : gate.result === 'FAIL' ? '❌' : '⚠️';

  lines.push('# Veylqorix Security Audit Report');
  lines.push('');
  lines.push(`**Project:** \`${audit.root}\`  `);
  lines.push(`**Started:** ${audit.startedAt}  `);
  lines.push(`**Duration:** ${audit.durationMs} ms`);
  lines.push('');
  lines.push(`**Ecosystem:** ${audit.detection.ecosystem}${audit.detection.packageManager ? ` (${audit.detection.packageManager})` : ''}`);
  lines.push('');
  lines.push(`## Gate Result: ${resultIcon} ${gate.result}`);
  lines.push('');
  lines.push(`Coverage: **${audit.coverage}**`);
  lines.push('');

  if (gate.blockingReasons.length > 0) {
    lines.push('### Blocking reasons');
    lines.push('');
    for (const reason of gate.blockingReasons) lines.push(`- ${reason}`);
    lines.push('');
  }

  if (gate.incompleteReasons.length > 0) {
    lines.push('### Incomplete coverage');
    lines.push('');
    for (const reason of gate.incompleteReasons) lines.push(`- ${reason}`);
    lines.push('');
  }

  if (gate.appliedExceptions.length > 0) {
    lines.push('### Applied exceptions');
    lines.push('');
    for (const exc of gate.appliedExceptions) {
      lines.push(`- \`${exc.ruleId}\`: ${exc.reason} (suppressed ${exc.suppressed} finding(s))`);
    }
    lines.push('');
  }

  lines.push('## Scanners');
  lines.push('');
  lines.push('| Scanner | Status | Findings | Notes |');
  lines.push('|---|---|---|---|');
  for (const s of audit.scanners) {
    const status = s.status === 'PASS' ? '✅' : s.status === 'FAIL' ? '❌' : s.status === 'SKIPPED' ? '⏭️' : '⚠️';
    lines.push(`| ${s.scanner} | ${status} ${s.status} | ${s.findings.length} | ${s.notes[0] ?? (s.error ? s.error.message : '—')} |`);
  }
  lines.push('');

  if (audit.checks.length > 0) {
    lines.push('## Quality checks');
    lines.push('');
    lines.push('| Check | Status | Command | Duration |');
    lines.push('|---|---|---|---|');
    for (const c of audit.checks) {
      const status = c.status === 'PASS' ? '✅' : c.status === 'FAIL' ? '❌' : c.status === 'SKIPPED' ? '⏭️' : '⚠️';
      lines.push(`| ${c.id} | ${status} ${c.status} | \`${c.command}\` | ${c.durationMs} ms |`);
    }
    lines.push('');
  }

  const findings = sortBySeverity(audit.findings);
  lines.push('## Findings');
  lines.push('');
  if (findings.length === 0) {
    lines.push('No findings reported by the scanners that ran.');
    lines.push('');
    lines.push('> This does not mean the project is free of vulnerabilities; it means the scanners that ran did not report any. Check the coverage section above.');
  } else {
    lines.push(`${findings.length} finding(s), sorted by severity:`);
    lines.push('');
    for (const f of findings) {
      lines.push(findingLine(f));
    }
    lines.push('');
  }

  const blockedFindings = findings.filter((f) =>
    audit.policy.policy.blockOnSeverity.includes(f.severity) || (audit.policy.policy.blockOnSecrets && f.secret),
  );
  if (blockedFindings.length > 0) {
    lines.push('### Findings that block the gate');
    lines.push('');
    for (const f of blockedFindings) lines.push(`- ${f.title} (\`${f.id}\`)`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('> Veylqorix reports what its scanners found; it does not certify the absence of vulnerabilities or secrets. Coverage reflects which scanners actually completed.');

  return lines.join('\n');
}

/**
 * Write every report format (JSON, Markdown, SARIF) from one audit result.
 * This is the shared result→report path for the gate workflow: one scan feeds
 * all three artifacts, so the gate never runs a second scan to "keep the
 * JSON clean".
 */
export interface ReportOutputs {
  jsonPath?: string;
  markdownPath?: string;
  sarifPath?: string;
}

export interface RenderedReports {
  jsonPath?: string;
  markdownPath?: string;
  sarifPath?: string;
}

export function renderAllReports(audit: AuditResult, outputs: ReportOutputs): RenderedReports {
  const written: RenderedReports = {};
  // Each format is rendered from the SAME audit result; a write failure
  // propagates to the caller so a promised artifact is never silently missing
  // (e.g. a workflow claiming a SARIF upload of a file that was not written).
  if (outputs.jsonPath) {
    fs.writeFileSync(outputs.jsonPath, toJson(audit), 'utf8');
    written.jsonPath = outputs.jsonPath;
  }
  if (outputs.markdownPath) {
    fs.writeFileSync(outputs.markdownPath, toMarkdown(audit), 'utf8');
    written.markdownPath = outputs.markdownPath;
  }
  if (outputs.sarifPath) {
    fs.writeFileSync(outputs.sarifPath, toSarif(audit), 'utf8');
    written.sarifPath = outputs.sarifPath;
  }
  return written;
}

export interface SarifValidation {
  valid: boolean;
  /** Empty when valid; a human-readable explanation when not. */
  error?: string;
}

/**
 * Verify a SARIF file is suitable for upload to a code-scanning service
 * (GitHub Actions `upload-sarif` requires a valid SARIF 2.1.0 document with at
 * least one run). A workflow should run this before claiming the SARIF upload
 * path is healthy: an empty file, truncated JSON, or a missing run means the
 * upload would either fail or silently post nothing — both must surface as an
 * explicit failure, never be treated as a successful upload.
 */
export function validateSarifFile(filePath: string): SarifValidation {
  if (!fs.existsSync(filePath)) {
    return { valid: false, error: `SARIF file not found: ${filePath}` };
  }
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return { valid: false, error: `SARIF file unreadable: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (text.trim().length === 0) {
    return { valid: false, error: `SARIF file is empty: ${filePath}` };
  }
  let doc: { version?: string; runs?: unknown[] };
  try {
    doc = JSON.parse(text) as typeof doc;
  } catch (error) {
    return { valid: false, error: `SARIF file is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (doc.version !== '2.1.0') {
    return { valid: false, error: `SARIF file has version '${doc.version ?? '(none)'}'; expected '2.1.0'.` };
  }
  if (!Array.isArray(doc.runs) || doc.runs.length === 0) {
    return { valid: false, error: 'SARIF file has no runs; a code-scanning upload would post nothing.' };
  }
  return { valid: true };
}
