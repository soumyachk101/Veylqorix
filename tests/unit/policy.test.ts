import { describe, expect, it } from 'vitest';
import {
  resolvePolicy,
  validatePolicyObject,
  globMatch,
} from '@veylqorix/core';

describe('resolvePolicy', () => {
  it('applies documented defaults', () => {
    const { policy } = resolvePolicy();
    expect(policy.blockOnSeverity).toEqual(['CRITICAL', 'HIGH']);
    expect(policy.blockOnSecrets).toBe(true);
    expect(policy.blockOnScannerError).toBe(true);
  });

  it('merges user overrides on top of defaults', () => {
    const { policy } = resolvePolicy({ blockOnSeverity: ['CRITICAL'] });
    expect(policy.blockOnSeverity).toEqual(['CRITICAL']);
    expect(policy.blockOnSecrets).toBe(true); // untouched default
  });

  it('drops expired exceptions', () => {
    const { policy } = resolvePolicy({
      exceptions: [
        { ruleId: 'old', reason: 'stale', expires: new Date(Date.now() - 3600_000).toISOString() },
        { ruleId: 'live', reason: 'current' },
      ],
    });
    expect(policy.exceptions.map((e) => e.ruleId)).toEqual(['live']);
  });

  it('caps exceptions at maxExceptions', () => {
    const { policy, notes } = resolvePolicy({
      maxExceptions: 2,
      exceptions: Array.from({ length: 5 }, (_, i) => ({ ruleId: `r${i}`, reason: `why ${i}` })),
    });
    expect(policy.exceptions).toHaveLength(2);
    expect(notes.join(' ')).toContain('maxExceptions');
  });
});

describe('globMatch', () => {
  it('matches simple and ** globs', () => {
    expect(globMatch('src/**/*.ts', 'src/a/b/c.ts')).toBe(true);
    expect(globMatch('*.js', 'a/b.js')).toBe(false);
    expect(globMatch('tests/fix*.ts', 'tests/fixture.ts')).toBe(true);
  });
});

describe('validatePolicyObject', () => {
  it('accepts a minimal valid policy', () => {
    const r = validatePolicyObject({ blockOnSeverity: ['CRITICAL'], maxExceptions: 3 });
    expect(r.valid).toBe(true);
    expect(r.resolved?.policy.blockOnSeverity).toEqual(['CRITICAL']);
  });

  it('rejects an invalid severity list', () => {
    const r = validatePolicyObject({ blockOnSeverity: ['BOGUS'] });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.field === 'blockOnSeverity' && i.level === 'ERROR')).toBe(true);
  });

  it('requires a documented reason on exceptions', () => {
    const r = validatePolicyObject({ exceptions: [{ ruleId: 'x' }] });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.field === 'exceptions[0].reason')).toBe(true);
  });

  it('rejects a non-object root', () => {
    expect(validatePolicyObject('nope').valid).toBe(false);
    expect(validatePolicyObject(null).valid).toBe(false);
  });

  it('warns on unknown fields but does not fail', () => {
    const r = validatePolicyObject({ notAField: 1 });
    expect(r.valid).toBe(true);
    expect(r.issues.some((i) => i.level === 'WARNING' && i.field === 'notAField')).toBe(true);
  });
});
