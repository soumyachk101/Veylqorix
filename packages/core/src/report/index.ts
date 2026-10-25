import { sortBySeverity } from '../policy.js';
import type { AuditResult, Finding, ScannerResult } from '../types.js';

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
