import { describe, expect, it } from 'vitest';
import { countBySeverity, locLabel, totalFindings } from './findings';
import type { Finding } from './types';

function f(partial: Partial<Finding>): Finding {
  return {
    id: 'X',
    title: 't',
    scanner: 's',
    ruleId: 'r',
    severity: 'INFO',
    confidence: 'LOW',
    ...partial,
  };
}

describe('countBySeverity', () => {
  it('counts each severity bucket', () => {
    const out = countBySeverity([
      f({ severity: 'CRITICAL' }),
      f({ severity: 'CRITICAL' }),
      f({ severity: 'HIGH' }),
      f({ severity: 'MEDIUM' }),
      f({ severity: 'LOW' }),
      f({ severity: 'INFO' }),
    ]);
    expect(out.CRITICAL).toBe(2);
    expect(out.HIGH).toBe(1);
    expect(out.MEDIUM).toBe(1);
    expect(out.LOW).toBe(1);
    expect(out.INFO).toBe(1);
  });

  it('returns all zeros for an empty list', () => {
    const out = countBySeverity([]);
    expect(out).toEqual({ CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 });
  });
});

describe('totalFindings', () => {
  it('returns the array length', () => {
    expect(totalFindings([f({}), f({})])).toBe(2);
  });
});

describe('locLabel', () => {
  it('renders file:line:column when all present', () => {
    expect(locLabel(f({ location: { file: 'a.ts', line: 10, column: 2 } }))).toBe('a.ts:10:2');
  });

  it('omits column when absent', () => {
    expect(locLabel(f({ location: { file: 'a.ts', line: 10 } }))).toBe('a.ts:10');
  });

  it('returns empty string when there is no location', () => {
    expect(locLabel(f({}))).toBe('');
  });
});
