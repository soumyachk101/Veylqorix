import { describe, expect, it } from 'vitest';
import { runAudit, makeFinding } from '@veylqorix/core';

describe('runAudit', () => {
  it('passes on the clean fixture with no blocking findings', async () => {
    const result = await runAudit({
      root: 'tests/fixtures/clean-repo',
      online: false,
      skipQualityChecks: true,
    });
    expect(result.gate.result).toBe('PASS');
    expect(result.exitCode).toBe(0);
  });

  it('fails on the secret fixture with a blocking exposed secret', async () => {
    const result = await runAudit({
      root: 'tests/fixtures/secret-repo',
      online: false,
      skipQualityChecks: true,
    });
    expect(result.gate.result).toBe('FAIL');
    expect(result.exitCode).toBe(1);
    expect(result.findings.some((f) => f.secret)).toBe(true);
    // Redaction: no raw fake value leaks into the findings.
    for (const f of result.findings) {
      const snippet = JSON.stringify(f.evidence?.snippet ?? '');
      expect(snippet).not.toContain('AKIA0123456789ABCDEF');
    }
  });

  it('reports INCOMPLETE (exit 2), never PASS, when a mandatory scanner cannot run', async () => {
    // The "unavailable scanner" scenario: a Python project with no pip-audit
    // and offline mode. The dependency scanner errors out, so the gate is
    // INCOMPLETE with exit code 2 — a scanner error is never mistaken for a
    // clean pass.
    const result = await runAudit({
      root: 'tests/fixtures/no-scanner-repo',
      online: false,
      skipQualityChecks: true,
      // Force the dependency scanner down the offline path so it SKIPPEDs.
    });
    const dep = result.scanners.find((s) => s.scanner.startsWith('dependencies'));
    expect(dep?.status).toBe('SKIPPED');
    expect(result.gate.result).not.toBe('PASS');
    expect(result.gate.result).toBe('INCOMPLETE');
    expect(result.exitCode).toBe(2);
  });

  it('uses mock findings for deterministic dependency vulnerabilities', async () => {
    const vuln = makeFinding({
      scanner: 'dependencies',
      ruleId: 'npm-audit',
      title: 'Vulnerable dependency lodash@4.17.20',
      severity: 'HIGH',
      confidence: 'CONFIRMED',
      dependency: { name: 'lodash', installedVersion: '4.17.20', fixedVersion: '4.17.21' },
    });
    const result = await runAudit({
      root: 'tests/fixtures/vulnerable-repo',
      online: false,
      skipQualityChecks: true,
      mocks: { dependencies: [vuln] },
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ ruleId: 'npm-audit', severity: 'HIGH' });
    expect(result.gate.result).toBe('FAIL');
  });

  it('lets a documented exception suppress a finding and record it', async () => {
    const vuln = makeFinding({
      scanner: 'dependencies',
      ruleId: 'npm-audit',
      title: 'Vulnerable dependency lodash@4.17.20',
      severity: 'CRITICAL',
      confidence: 'CONFIRMED',
    });
    const result = await runAudit({
      root: 'tests/fixtures/vulnerable-repo',
      online: false,
      skipQualityChecks: true,
      mocks: { dependencies: [vuln] },
      policy: { exceptions: [{ ruleId: 'npm-audit', reason: 'accepted risk until rewrite' }] },
    });
    expect(result.gate.appliedExceptions).toHaveLength(1);
    expect(result.gate.result).toBe('PASS');
    expect(result.exitCode).toBe(0);
  });

  it('detects the project ecosystem', async () => {
    const node = await runAudit({ root: 'tests/fixtures/clean-repo', online: false, skipQualityChecks: true });
    expect(node.detection.ecosystem).toBe('node');
    const py = await runAudit({ root: 'tests/fixtures/no-scanner-repo', online: false, skipQualityChecks: true });
    expect(py.detection.ecosystem).toBe('python');
  });
});
