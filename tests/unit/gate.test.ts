import { describe, expect, it } from 'vitest';
import { exitCodeFor, evaluateGate } from '@veylqorix/core';
import { resolvePolicy } from '@veylqorix/core';
import type { CheckResult, Finding, Policy, ScannerResult } from '@veylqorix/core';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'TEST-00000001',
    title: 'Test finding',
    scanner: 'dependencies',
    ruleId: 'test-rule',
    severity: 'MEDIUM',
    confidence: 'HIGH',
    ...overrides,
  };
}

function scanner(name: string, status: ScannerResult['status'], extra: Partial<ScannerResult> = {}): ScannerResult {
  return {
    scanner: name,
    status,
    findings: [],
    durationMs: 0,
    notes: [`${name} ${status.toLowerCase()}`],
    ...extra,
  };
}

function check(id: string, status: CheckResult['status']): CheckResult {
  return {
    id,
    command: 'echo test',
    status,
    durationMs: 0,
  };
}

function evaluate(args: {
  findings?: Finding[];
  checks?: CheckResult[];
  scanners?: ScannerResult[];
  policy?: Partial<Policy>;
}) {
  const policy = resolvePolicy(args.policy);
  const gate = evaluateGate({
    findings: args.findings ?? [],
    checks: args.checks ?? [],
    scanners: args.scanners ?? [],
    policy,
  });
  return { gate, policy, exitCode: exitCodeFor(gate, gate.coverage) };
}

describe('evaluateGate', () => {
  it('clean audit passes with exit code 0', () => {
    const { gate, exitCode } = evaluate({ scanners: [scanner('dependencies', 'PASS'), scanner('secrets', 'PASS')] });
    expect(gate.result).toBe('PASS');
    expect(gate.blockingReasons).toEqual([]);
    expect(gate.incompleteReasons).toEqual([]);
    expect(gate.coverage).toBe('FULL');
    expect(exitCode).toBe(0);
  });

  it('a HIGH finding at a blocking severity fails the gate with exit code 1', () => {
    const { gate, exitCode } = evaluate({
      findings: [finding({ id: 'TEST-HIGH', severity: 'HIGH' })],
      scanners: [scanner('dependencies', 'FAIL')],
    });
    expect(gate.result).toBe('FAIL');
    expect(gate.blockingReasons.length).toBe(1);
    expect(gate.blockingReasons[0]).toContain('HIGH finding');
    expect(exitCode).toBe(1);
  });

  it('a suppressed CRITICAL finding does not block and is recorded in appliedExceptions', () => {
    const critical = finding({ id: 'TEST-CRIT', severity: 'CRITICAL', ruleId: 'vuln-x', file: 'src/app.js' });
    const { gate, exitCode } = evaluate({
      findings: [critical],
      scanners: [scanner('dependencies', 'FAIL')],
      policy: {
        exceptions: [{ ruleId: 'vuln-x', reason: 'accepted risk until rewrite' }],
      },
    });
    expect(gate.result).toBe('PASS');
    expect(exitCode).toBe(0);
    expect(gate.appliedExceptions).toHaveLength(1);
    expect(gate.appliedExceptions[0]).toMatchObject({ ruleId: 'vuln-x', reason: 'accepted risk until rewrite', suppressed: 1 });
    expect(gate.reportedFindings).toEqual([]);
  });

  it('a secret finding blocks when blockOnSecrets is true (default)', () => {
    const { gate, exitCode } = evaluate({
      findings: [finding({ id: 'TEST-SEC', secret: true, severity: 'LOW', ruleId: 'leak' })],
      scanners: [scanner('secrets', 'FAIL')],
    });
    expect(gate.result).toBe('FAIL');
    expect(exitCode).toBe(1);
    expect(gate.blockingReasons[0]).toContain('Exposed secret');
  });

  it('a secret finding does not block when blockOnSecrets is false', () => {
    const { gate, exitCode } = evaluate({
      findings: [finding({ id: 'TEST-SEC', secret: true, severity: 'LOW', ruleId: 'leak' })],
      scanners: [scanner('secrets', 'FAIL')],
      policy: { blockOnSecrets: false },
    });
    expect(gate.result).toBe('PASS');
    expect(exitCode).toBe(0);
    // The secret is still reported, just not blocking.
    expect(gate.reportedFindings.map((f) => f.id)).toContain('TEST-SEC');
  });

  it('a scanner ERROR forces INCOMPLETE and exit code 2 when blockOnScannerError is off', () => {
    const { gate, exitCode } = evaluate({
      scanners: [scanner('dependencies', 'ERROR', { error: { message: 'npm audit blew up' } })],
      policy: { blockOnScannerError: false },
    });
    // A failed mandatory scanner can never yield PASS: coverage is degraded.
    expect(gate.result).toBe('INCOMPLETE');
    expect(gate.coverage).not.toBe('FULL');
    expect(exitCode).toBe(2);
    expect(gate.incompleteReasons.length).toBe(1);
    expect(gate.incompleteReasons[0]).toContain("errored");
  });

  it('a scanner ERROR blocks to FAIL when blockOnScannerError is true (default)', () => {
    const { gate, exitCode } = evaluate({
      scanners: [scanner('dependencies', 'ERROR', { error: { message: 'npm audit blew up' } })],
    });
    expect(gate.result).toBe('FAIL');
    expect(gate.blockingReasons[0]).toContain('errored');
    // Exit code semantics: blocking reasons win over degraded coverage.
    expect(exitCode).toBe(1);
  });

  it('a SKIPPED mandatory scanner forces INCOMPLETE, never PASS', () => {
    const { gate, exitCode } = evaluate({
      scanners: [
        scanner('secrets', 'PASS'),
        scanner('dependencies', 'SKIPPED', { notes: ['offline; npm audit requires network'] }),
      ],
    });
    expect(gate.result).toBe('INCOMPLETE');
    expect(gate.result).not.toBe('PASS');
    expect(gate.incompleteReasons[0]).toContain('was skipped');
    expect(gate.blockingReasons.length).toBe(1);
    expect(gate.blockingReasons[0]).toContain('skipped');
    expect(exitCode).toBe(2);
  });

  it('INCOMPLETE is never equal to PASS, even with zero findings and zero blocking reasons', () => {
    // The honesty property: a degraded-coverage audit must not print the same
    // verdict as a clean one. INCOMPLETE != PASS and exit code 2 != 0.
    const { gate, exitCode } = evaluate({
      scanners: [scanner('dependencies', 'SKIPPED', { notes: ['offline'] })],
    });
    expect(gate.result).toBe('INCOMPLETE');
    expect(gate.result).not.toEqual('PASS');
    expect(exitCode).not.toBe(0);
    expect(exitCode).toBe(2);
  });

  it('INCOMPLETE also arises from a coverage downgrade without blocking reasons when blockOnSkippedCheck is off', () => {
    const { gate, exitCode } = evaluate({
      scanners: [scanner('dependencies', 'SKIPPED', { notes: ['offline'] })],
      policy: { blockOnSkippedCheck: false },
    });
    // No blocking reason left behind, but coverage is still not FULL.
    expect(gate.blockingReasons).toEqual([]);
    expect(gate.result).not.toBe('PASS');
    expect(gate.coverage).not.toBe('FULL');
    // exitCodeFor maps PASS+LIMITED to 2, so the exit code must still be 2, not 0.
    expect(exitCode).toBe(2);
  });

  it('failing required checks block when blockOnTestFailure is true (default)', () => {
    const { gate, exitCode } = evaluate({
      checks: [check('tests', 'FAIL')],
      scanners: [scanner('dependencies', 'PASS'), scanner('secrets', 'PASS')],
    });
    expect(gate.result).toBe('FAIL');
    expect(gate.blockingReasons[0]).toContain("check 'tests' failed");
    expect(exitCode).toBe(1);
  });

  it('an errored check degrades coverage and blocks when blockOnSkippedCheck is on', () => {
    const { gate, exitCode } = evaluate({
      checks: [check('ruff', 'ERROR')],
      scanners: [scanner('dependencies', 'PASS'), scanner('secrets', 'PASS')],
      policy: { blockOnSkippedCheck: true },
    });
    expect(gate.incompleteReasons.length).toBe(1);
    expect(gate.incompleteReasons[0]).toContain('errored');
    expect(gate.blockingReasons.length).toBe(1);
    expect(gate.result).toBe('FAIL');
    expect(exitCode).toBe(1);
  });

  it('report-only policy (no blocking severities) keeps reported findings and passes when clean', () => {
    const { gate, exitCode } = evaluate({
      findings: [finding({ id: 'TEST-MED', severity: 'MEDIUM' }), finding({ id: 'TEST-LOW', severity: 'LOW' })],
      scanners: [scanner('dependencies', 'PASS'), scanner('secrets', 'PASS')],
      policy: { blockOnSeverity: [], reportOnSeverity: ['MEDIUM', 'LOW'] },
    });
    expect(gate.result).toBe('PASS');
    expect(exitCode).toBe(0);
    expect(gate.reportedFindings.map((f) => f.id)).toEqual(['TEST-MED', 'TEST-LOW']);
    expect(gate.blockingReasons).toEqual([]);
  });

  it('an expired exception is dropped by resolvePolicy and cannot suppress a finding', () => {
    const critical = finding({ id: 'TEST-CRIT', severity: 'CRITICAL', ruleId: 'vuln-x' });
    const { gate, policy } = evaluate({
      findings: [critical],
      scanners: [scanner('dependencies', 'FAIL')],
      policy: {
        exceptions: [{ ruleId: 'vuln-x', reason: 'stale waiver', expires: new Date(Date.now() - 86_400_000).toISOString() }],
      },
    });
    expect(policy.policy.exceptions).toEqual([]);
    expect(gate.result).toBe('FAIL');
    expect(gate.appliedExceptions).toEqual([]);
  });
});

describe('exitCodeFor', () => {
  it('maps gate results to the documented exit codes', () => {
    const pass = evaluate({ scanners: [scanner('secrets', 'PASS')] });
    expect(pass.exitCode).toBe(0);

    const fail = evaluate({
      findings: [finding({ id: 'TEST-HI', severity: 'HIGH' })],
      scanners: [scanner('dependencies', 'FAIL')],
    });
    expect(fail.exitCode).toBe(1);

    const incomplete = evaluate({
      scanners: [scanner('dependencies', 'SKIPPED', { notes: ['offline'] })],
    });
    expect(incomplete.exitCode).toBe(2);
  });
});
