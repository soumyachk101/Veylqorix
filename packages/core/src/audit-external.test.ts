/**
 * Core regression tests for the extension slots: `externalScanners` and
 * `externalChecks` in `runAudit` options.
 *
 * These pin the security invariant that the plugin SDK relies on:
 * caller-supplied scanners/checks are executed under the same safe wrapper as
 * the built-ins — a thrown error or overrun becomes an ERROR result that
 * degrades coverage (never a pass) — while a healthy add-on contributes its
 * evidence to the gate additively and leaves the rest of the audit untouched.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  runAudit,
  type CheckResult,
  type ExternalCheck,
  type ScannerDefinition,
} from '@veylqorix/core';

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veylqorix-ext-'));
  // No lockfile / no test script: the built-in dependency and quality
  // surfaces stay quiet so the outcome is decided by the extension slots.
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'ext-fixture', version: '1.0.0' }));
  return dir;
}

describe('runAudit external extension slots', () => {
  it('defaults are empty: no external evidence reaches the gate', async () => {
    const root = makeRepo();
    try {
      const result = await runAudit({ root, online: false });
      const extScannerResults = result.scanners.filter((s) => s.scanner.startsWith('ext-'));
      expect(extScannerResults).toHaveLength(0);
      expect(result.checks.map((c) => c.id).filter((id) => id.startsWith('ext-'))).toHaveLength(0);
      // The mandatory dependency scanner is SKIPPED in offline mode, so the
      // gate is INCOMPLETE — honest degradation, never a silent pass.
      expect(result.gate.result).toBe('INCOMPLETE');
      expect(result.exitCode).toBe(2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('an external scanner that errors degrades coverage, never passes', async () => {
    const root = makeRepo();
    try {
      const externalScanners: ScannerDefinition[] = [
        {
          name: 'ext-boom',
          mandatory: false,
          run: async () => {
            throw new Error('extension scanner crashed');
          },
        },
      ];
      const result = await runAudit({ root, online: false, externalScanners });
      const scanner = result.scanners.find((s) => s.scanner === 'ext-boom');
      expect(scanner?.status).toBe('ERROR');
      expect(scanner?.error?.message).toContain('extension scanner crashed');
      // Default policy: blockOnScannerError=true, so an errored scanner blocks.
      expect(result.gate.result).toBe('FAIL');
      expect(result.exitCode).toBe(1);
      expect(result.gate.incompleteReasons.join('\n')).toContain('ext-boom');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('an external scanner with findings feeds the gate additively', async () => {
    const root = makeRepo();
    try {
      const externalScanners: ScannerDefinition[] = [
        {
          name: 'ext-sast',
          mandatory: false,
          run: async () => ({
            scanner: 'ext-sast',
            status: 'FAIL',
            findings: [
              {
                id: 'EXT-SAST-1',
                title: 'Insecure random for CSRF token',
                scanner: 'ext-sast',
                ruleId: 'insecure-csrf',
                severity: 'HIGH',
                confidence: 'CONFIRMED',
                location: { file: 'src/csrf.ts', line: 12 },
              },
            ],
            durationMs: 0,
            notes: [],
          }),
        },
      ];
      const result = await runAudit({ root, online: false, externalScanners });
      const ids = result.findings.map((f) => f.ruleId);
      expect(ids).toContain('insecure-csrf');
      expect(result.gate.result).toBe('FAIL');
      expect(result.exitCode).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('an external check that errors is classified as an ERROR check', async () => {
    const root = makeRepo();
    try {
      const externalChecks: ExternalCheck[] = [
        {
          id: 'ext-boom-check',
          command: 'ext-check --fail',
          run: async () => {
            throw new Error('extension check missing binary');
          },
        },
      ];
      const result = await runAudit({ root, online: false, externalChecks });
      const check = result.checks.find((c) => c.id === 'ext-boom-check');
      expect(check?.status).toBe('ERROR');
      expect(check?.error?.message).toContain('extension check missing binary');
      // Default policy blocks on errored required checks.
      expect(result.gate.result).toBe('FAIL');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('external checks honor skipQualityChecks', async () => {
    const root = makeRepo();
    try {
      const externalChecks: ExternalCheck[] = [
        {
          id: 'ext-should-not-run',
          run: async () => {
            throw new Error('should never run');
          },
        },
      ];
      const result = await runAudit({
        root,
        online: false,
        skipQualityChecks: true,
        externalChecks,
      });
      expect(result.checks.map((c) => c.id)).not.toContain('ext-should-not-run');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('an external check that passes does not add any blocking reason', async () => {
    const root = makeRepo();
    try {
      const externalChecks: ExternalCheck[] = [
        {
          id: 'ext-coverage',
          command: 'custom coverage check',
          run: async () =>
            ({
              id: 'ext-coverage',
              command: 'custom coverage check',
              status: 'PASS',
              durationMs: 0,
            } as CheckResult),
        },
      ];
      const result = await runAudit({ root, online: false, externalChecks });
      const check = result.checks.find((c) => c.id === 'ext-coverage');
      expect(check?.status).toBe('PASS');
      // Offline mode leaves the mandatory dependency scanner SKIPPED, so the
      // gate is INCOMPLETE (exit 2) — but the passing external check must not
      // contribute a blocking reason of its own.
      expect(result.gate.result).toBe('INCOMPLETE');
      expect(result.exitCode).toBe(2);
      expect(result.gate.blockingReasons.join('\n')).not.toContain('ext-coverage');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('external check results without a duration get one measured for them', async () => {
    const root = makeRepo();
    try {
      const externalChecks: ExternalCheck[] = [
        {
          id: 'ext-timing',
          run: async () =>
            ({
              id: 'ext-timing',
              command: 'ext-timing',
              status: 'PASS',
              durationMs: 0,
            } as CheckResult),
        },
      ];
      const result = await runAudit({ root, online: false, externalChecks });
      const check = result.checks.find((c) => c.id === 'ext-timing');
      // A real (possibly 0 ms if very fast) non-negative duration, and no
      // stale "registered but not run" reason left on the entry.
      expect(check?.status).toBe('PASS');
      expect(check?.durationMs).toBeTypeOf('number');
      expect(check?.reason).toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
