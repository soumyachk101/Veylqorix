import { describe, expect, it } from 'vitest';
import { findingId, makeFinding, normalizeFindings } from '@veylqorix/core';

describe('findingId', () => {
  it('is deterministic across identical inputs', () => {
    const a = findingId('dependencies', 'npm-audit', 'pnpm-lock.yaml', 'lodash', '4.17.20');
    const b = findingId('dependencies', 'npm-audit', 'pnpm-lock.yaml', 'lodash', '4.17.20');
    expect(a).toBe(b);
    expect(a).toMatch(/^DEP-[0-9A-F]{8}$/);
  });

  it('changes when any stable input changes', () => {
    const base = findingId('dependencies', 'npm-audit', 'lock', 'lodash', '4.17.20');
    expect(findingId('dependencies', 'pip-audit', 'lock', 'lodash', '4.17.20')).not.toBe(base);
    expect(findingId('dependencies', 'npm-audit', 'lock', 'lodash', '4.17.21')).not.toBe(base);
  });
});

describe('makeFinding', () => {
  it('fills required fields and omits undefined locations', () => {
    const f = makeFinding({
      scanner: 'secrets',
      ruleId: 'leak',
      title: 'A secret was detected',
      severity: 'HIGH',
      confidence: 'CONFIRMED',
      secret: true,
    });
    expect(f.id).toMatch(/^SECRETS-[0-9A-F]{8}$/);
    expect(f.location).toBeUndefined();
    expect(f.secret).toBe(true);
  });

  it('includes location only when a file is given', () => {
    const f = makeFinding({
      scanner: 'secrets',
      ruleId: 'leak',
      title: 'A secret was detected',
      severity: 'HIGH',
      confidence: 'HIGH',
      file: 'config.js',
      line: 2,
    });
    expect(f.location).toEqual({ file: 'config.js', line: 2 });
  });
});

describe('normalizeFindings', () => {
  it('accepts well-formed findings and rejects malformed ones', () => {
    const { findings, rejected } = normalizeFindings('mock', [
      { ruleId: 'ok', title: 'fine', severity: 'LOW', confidence: 'LOW' },
      { ruleId: 'bad-title', severity: 'LOW' }, // missing title
      null,
      { title: 'no rule', severity: 'LOW' },
    ]);
    expect(findings).toHaveLength(1);
    expect(rejected).toBe(3);
    expect(findings[0]).toMatchObject({ scanner: 'mock', ruleId: 'ok', severity: 'LOW' });
  });

  it('coerces unknown severities to MEDIUM instead of dropping the finding', () => {
    const { findings } = normalizeFindings('mock', [
      { ruleId: 'x', title: 'weird', severity: 'BOGUS', confidence: 'ALSO_BOGUS' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('MEDIUM');
    expect(findings[0].confidence).toBe('MEDIUM');
  });
});
