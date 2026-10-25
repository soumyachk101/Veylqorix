import { describe, expect, it } from 'vitest';
import { toJson, toMarkdown, toSarif, makeFinding, type AuditResult } from '@veylqorix/core';

function sampleAudit(): AuditResult {
  const finding = makeFinding({
    scanner: 'secrets',
    ruleId: 'leak',
    title: 'A token was committed',
    severity: 'HIGH',
    confidence: 'CONFIRMED',
    file: 'config.js',
    line: 2,
    evidence: { snippet: 'ghp_…789 (redacted)' },
    remediation: 'Revoke and rotate the token.',
    advisory: 'https://docs.github.com/tokens',
    secret: true,
  });
  return {
    root: '/srv/project',
    startedAt: new Date(0).toISOString(),
    durationMs: 1234,
    detection: {
      ecosystem: 'node',
      packageManager: 'pnpm',
      manifests: ['package.json'],
      lockfiles: ['pnpm-lock.yaml'],
      gitRepository: true,
      languages: ['typescript'],
      reasons: ['Found package.json'],
    },
    scanners: [
      {
        scanner: 'secrets',
        status: 'FAIL',
        findings: [finding],
        durationMs: 50,
        notes: ['1 potential secret(s) detected and redacted.'],
      },
      {
        scanner: 'dependencies',
        status: 'PASS',
        findings: [],
        durationMs: 80,
        notes: ['clean'],
      },
    ],
    findings: [finding],
    checks: [
      { id: 'typescript', command: 'npx tsc --noEmit', status: 'PASS', durationMs: 100 },
      { id: 'eslint', command: 'npx eslint .', status: 'SKIPPED', durationMs: 0, reason: 'no config' },
    ],
    gate: {
      result: 'FAIL',
      blockingReasons: ['HIGH finding ' + finding.id + ' (secrets/leak): ' + finding.title],
      reportedFindings: [],
      incompleteReasons: [],
      coverage: 'FULL',
      appliedExceptions: [],
    },
    coverage: 'FULL',
    policy: {
      policy: {
        blockOnSeverity: ['CRITICAL', 'HIGH'],
        blockOnSecrets: true,
        blockOnTestFailure: true,
        blockOnScannerError: true,
        blockOnSkippedCheck: true,
        reportOnSeverity: ['MEDIUM', 'LOW'],
        maxExceptions: 5,
        exceptions: [],
      },
      notes: [],
    },
  };
}

describe('toJson', () => {
  it('is deterministic across calls', () => {
    const a = toJson(sampleAudit());
    const b = toJson(sampleAudit());
    expect(a).toBe(b);
  });

  it('exposes the gate decision for CI branching', () => {
    const doc = JSON.parse(toJson(sampleAudit()));
    expect(doc.gate.result).toBe('FAIL');
    expect(doc.coverage).toBe('FULL');
    expect(doc.findings).toHaveLength(1);
    expect(doc.findings[0].secret).toBe(true);
  });
});

describe('toSarif', () => {
  it('produces a valid SARIF 2.1.0 document', () => {
    const doc = JSON.parse(toSarif(sampleAudit()));
    expect(doc.version).toBe('2.1.0');
    expect(doc.runs).toHaveLength(1);
    const run = doc.runs[0];
    expect(run.results).toHaveLength(1);
    expect(run.results[0].ruleId).toBe('secrets/leak');
    expect(run.tool.driver.name).toBe('Veylqorix');
  });

  it('never includes raw secret values, only redacted or safe content', () => {
    const text = toSarif(sampleAudit());
    // SARIF carries titles, remediation, and advisory references — it must
    // never leak a raw secret value.
    expect(text).not.toContain('AKIA0123456789ABCDEF');
    expect(text).not.toContain('ghp_0123456789abcdefghijklmnopqrstuvwxyz0123456789');
    // The safe content is present.
    expect(text).toContain('A token was committed');
    expect(text).toContain('Revoke and rotate the token.');
  });

  it('is deterministic', () => {
    expect(toSarif(sampleAudit())).toBe(toSarif(sampleAudit()));
  });
});

describe('toMarkdown', () => {
  it('renders the gate result and the scanners table', () => {
    const md = toMarkdown(sampleAudit());
    expect(md).toContain('FAIL');
    expect(md).toContain('| Scanner | Status |');
    expect(md).toContain('secrets/leak');
  });

  it('states that zero findings is not a certification', () => {
    const audit = sampleAudit();
    audit.findings = [];
    audit.scanners[0].findings = [];
    audit.gate.blockingReasons = [];
    audit.gate.result = 'PASS';
    const md = toMarkdown(audit);
    expect(md).toContain('does not mean the project is free of vulnerabilities');
  });
});
