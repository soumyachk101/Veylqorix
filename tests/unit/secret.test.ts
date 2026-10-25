import { describe, expect, it } from 'vitest';
import { redactSecret, scanSecrets } from '@veylqorix/core';

describe('redactSecret', () => {
  it('never returns the full value', () => {
    const value = 'AKIA0123456789ABCDEF';
    const redacted = redactSecret(value);
    expect(redacted).not.toContain(value);
    expect(redacted).toContain('redacted');
  });

  it('masks short values entirely', () => {
    expect(redactSecret('short1')).toBe('****');
  });
});

describe('scanSecrets on fixture', () => {
  it('detects the fake test secret and redacts it', async () => {
    const result = await scanSecrets('tests/fixtures/secret-repo');
    expect(result.status).toBe('FAIL');
    const rules = result.findings.map((f) => f.ruleId).sort();
    expect(rules).toContain('aws-access-key-id');
    expect(rules).toContain('github-github-pat-classic');
    for (const f of result.findings) {
      const snippet = f.evidence?.snippet ?? '';
      // The raw fake values must never appear in the finding.
      expect(snippet).not.toContain('AKIA0123456789ABCDEF');
      expect(snippet).not.toContain('ghp_0123456789abcdefghijklmnopqrstuvwxyz0123456789');
      expect(f.secret).toBe(true);
      expect(f.location?.file).toBe('config.js');
    }
  });

  it('finds nothing in a clean fixture', async () => {
    const result = await scanSecrets('tests/fixtures/clean-repo');
    expect(result.status).toBe('PASS');
    expect(result.findings).toHaveLength(0);
  });

  it('supports a mock findings mode for deterministic tests', async () => {
    const { makeFinding } = await import('@veylqorix/core');
    const mock = [
      makeFinding({
        scanner: 'secrets',
        ruleId: 'mock-rule',
        title: 'mock secret',
        severity: 'CRITICAL',
        confidence: 'CONFIRMED',
        secret: true,
      }),
    ];
    const result = await scanSecrets('tests/fixtures/clean-repo', { mockFindings: mock });
    expect(result.status).toBe('FAIL');
    expect(result.findings).toHaveLength(1);
  });
});
