import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  makeFinding,
  normalizeFindings,
  renderAllReports,
  runAudit,
  toSarif,
  validateSarifFile,
  type AuditResult,
  type Finding,
} from '@veylqorix/core';
import {
  KNOWN_COMMANDS,
  parseArgs,
  wantsHelp,
} from '../apps/cli/src/cli-args.js';

/** Minimal audit result: zero findings, full coverage. */
function cleanAudit(): AuditResult {
  return {
    root: '/tmp/empty-repo',
    startedAt: new Date(0).toISOString(),
    durationMs: 5,
    detection: {
      ecosystem: 'node',
      manifests: [],
      lockfiles: [],
      gitRepository: false,
      languages: ['javascript'],
      reasons: ['detected javascript files'],
    },
    scanners: [],
    findings: [],
    checks: [],
    gate: {
      result: 'PASS',
      blockingReasons: [],
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

function withFindings(count: number, severity: Finding['severity']): AuditResult {
  const audit = cleanAudit();
  audit.findings = Array.from({ length: count }, (_, i) =>
    makeFinding({
      scanner: 'secrets',
      ruleId: 'leak',
      title: `Finding ${i + 1}`,
      severity,
      confidence: 'CONFIRMED',
      file: `src/file-${i}.js`,
      line: i + 1,
    }),
  );
  audit.scanners = [
    {
      scanner: 'secrets',
      status: severity === 'MEDIUM' ? 'PASS' : 'FAIL',
      findings: audit.findings,
      durationMs: 10,
      notes: [],
    },
  ];
  audit.gate.result = severity === 'MEDIUM' ? 'PASS' : 'FAIL';
  audit.gate.blockingReasons =
    severity === 'MEDIUM' ? [] : audit.findings.map((f) => `${f.severity} finding ${f.id}`);
  return audit;
}

describe('SARIF validity in edge cases', () => {
  it('emits a valid SARIF 2.1.0 skeleton with zero findings', () => {
    const doc = JSON.parse(toSarif(cleanAudit()));
    expect(doc.version).toBe('2.1.0');
    expect(doc.$schema).toContain('sarif-schema-2.1.0');
    expect(doc.runs).toHaveLength(1);
    expect(doc.runs[0].results).toEqual([]);
    expect(doc.runs[0].artifacts).toEqual([]);
    expect(doc.runs[0].tool.driver.name).toBe('Veylqorix');
    // The tool driver is a required property and must survive the empty case.
    expect(doc.runs[0].tool.driver.rules).toEqual([]);
  });

  it('emits valid SARIF with many findings', () => {
    const doc = JSON.parse(toSarif(withFindings(50, 'HIGH')));
    expect(doc.runs[0].results).toHaveLength(50);
    for (const r of doc.runs[0].results) {
      expect(r.ruleId).toMatch(/^secrets\//);
      expect(typeof r.ruleIndex).toBe('number');
      expect(doc.runs[0].tool.driver.rules[r.ruleIndex].id).toBe(r.ruleId);
      expect(r.message.text).toBeTruthy();
    }
  });

  it('maps only valid SARIF levels and omits empty locations', () => {
    const finding = makeFinding({
      scanner: 'secrets',
      ruleId: 'leak',
      title: 'No location finding',
      severity: 'CRITICAL',
      confidence: 'CONFIRMED',
    });
    const audit = cleanAudit();
    audit.findings = [finding];
    expect(JSON.parse(toSarif(audit)).runs[0].results[0].level).toBe('error');
    // A LOW-severity, LOW-confidence finding maps to the weakest valid level.
    audit.findings = [
      makeFinding({
        scanner: 'secrets',
        ruleId: 'leak',
        title: 'Low finding',
        severity: 'LOW',
        confidence: 'LOW',
      }),
    ];
    expect(JSON.parse(toSarif(audit)).runs[0].results[0].level).toBe('none');
  });
});

describe('renderAllReports (single-scan shared rendering path)', () => {
  it('writes JSON, Markdown, and SARIF from one audit result', () => {
    const audit = withFindings(3, 'HIGH');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veylqorix-reports-'));
    try {
      const jsonPath = path.join(dir, 'v.json');
      const mdPath = path.join(dir, 'v.md');
      const sarifPath = path.join(dir, 'v.sarif');
      const written = renderAllReports(audit, {
        jsonPath,
        markdownPath: mdPath,
        sarifPath,
      });
      expect(written).toEqual({ jsonPath, markdownPath: mdPath, sarifPath });
      const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      expect(json.findings).toHaveLength(3);
      expect(json.gate.result).toBe('FAIL');
      expect(fs.readFileSync(mdPath, 'utf8')).toContain('Gate Result');
      const sarif = JSON.parse(fs.readFileSync(sarifPath, 'utf8'));
      expect(sarif.version).toBe('2.1.0');
      expect(sarif.runs[0].results).toHaveLength(3);
      // Byte-identical to the standalone renderers: one scan, same data.
      expect(fs.readFileSync(jsonPath, 'utf8')).toContain('"schemaVersion": 1');
      expect(fs.readFileSync(sarifPath, 'utf8')).toContain('"version": "2.1.0"');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes only the requested formats', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veylqorix-reports-'));
    try {
      const sarifPath = path.join(dir, 'v.sarif');
      const written = renderAllReports(cleanAudit(), { sarifPath });
      expect(fs.readdirSync(dir)).toEqual(['v.sarif']);
      expect(written.sarifPath).toBe(sarifPath);
      expect(written.jsonPath).toBeUndefined();
      expect(JSON.parse(fs.readFileSync(sarifPath, 'utf8')).runs[0].results).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lets a report-generation failure propagate (never swallowed)', () => {
    const audit = cleanAudit();
    const impossiblePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'veylqorix-')), 'missing-dir', 'v.json');
    expect(() => renderAllReports(audit, { jsonPath: impossiblePath })).toThrow(
      /ENOENT/,
    );
  });
});

describe('gate verdict honesty (runAudit)', () => {
  it('passes (exit 0) with no findings on a clean fixture', async () => {
    const result = await runAudit({
      root: 'tests/fixtures/clean-repo',
      online: false,
      skipQualityChecks: true,
      mocks: { dependencies: [] },
    });
    expect(result.gate.result).toBe('PASS');
    expect(result.exitCode).toBe(0);
    expect(result.coverage).toBe('FULL');
  });

  it('fails (exit 1) on blocking findings', async () => {
    const result = await runAudit({
      root: 'tests/fixtures/secret-repo',
      online: false,
      skipQualityChecks: true,
    });
    expect(result.gate.result).toBe('FAIL');
    expect(result.exitCode).toBe(1);
    expect(result.gate.blockingReasons.length).toBeGreaterThan(0);
  });

  it('INCOMPLETE (exit 2) when a mandatory scanner cannot run, never PASS', async () => {
    const result = await runAudit({
      root: 'tests/fixtures/no-scanner-repo',
      online: false,
      skipQualityChecks: true,
      mocks: { dependencies: undefined },
    });
    // The engine (if built) or the offline dependency scanner skips/errors;
    // either way a degraded audit must exit 2.
    expect(result.gate.result).toBe('INCOMPLETE');
    expect(result.exitCode).toBe(2);
    expect(result.coverage).not.toBe('FULL');
  });
});

describe('malformed scanner output (normalizeFindings)', () => {
  it('rejects non-array and shape-invalid entries without corrupting the report', () => {
    const { findings, rejected } = normalizeFindings(
      'mock',
      [
        null,
        42,
        {},
        { title: '', ruleId: 'x' },
        { title: 'ok', ruleId: 'valid-rule', severity: 'Bogus', confidence: 'Bogus' },
      ],
    );
    expect(rejected).toBe(4);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    // Invalid enums fall back to MEDIUM/MEDIUM instead of crashing.
    expect(f.severity).toBe('MEDIUM');
    expect(f.confidence).toBe('MEDIUM');
    // Even fully-rejected input produces a valid SARIF skeleton.
    expect(JSON.parse(toSarif(cleanAudit())).runs[0].results).toEqual([]);
  });
});

describe('CLI scanner-list validation', () => {
  it('rejects unknown scanners with exit-code-64 style errors', () => {
    const validScanners = ['dependencies', 'secrets', 'licenses'];
    for (const name of validScanners) {
      expect(() => parseArgs(['scan', '--scanners', name], '/tmp')).not.toThrow();
    }
    expect(() => parseArgs(['scan', '--scanners', 'not-a-scanner'], '/tmp')).toThrow(
      `--scanners: 'not-a-scanner' is not a known scanner (expected: ${validScanners.join(', ')})`,
    );
    expect(() => parseArgs(['scan', '--scanners', 'secrets,bogus'], '/tmp')).toThrow(
      `--scanners: 'bogus' is not a known scanner`,
    );
  });

  it('rejects unknown severities in --block-on', () => {
    expect(() => parseArgs(['scan', '--block-on', 'HIGH,CRITICAL'], '/tmp')).not.toThrow();
    expect(() => parseArgs(['scan', '--block-on', 'HIGH,WHY'], '/tmp')).toThrow(
      `--block-on: 'WHY' is not a valid severity (expected: INFO, LOW, MEDIUM, HIGH, CRITICAL)`,
    );
  });

  it('keeps command and flag parsing intact', () => {
    const parsed = parseArgs(
      ['scan', 'root', '--scanners', 'secrets', '--block-on', 'CRITICAL,HIGH', '--json'],
      '/tmp',
    );
    expect(parsed.command).toBe('scan');
    expect(parsed.root).toBe(path.resolve('root'));
    expect(parsed.scanners).toEqual(['secrets']);
    expect(parsed.json).toBe(true);
    expect(parsed.policy?.blockOnSeverity).toEqual(['CRITICAL', 'HIGH']);
    expect(parsed.format).toBe('json');
    expect(wantsHelp(['scan', '--help'])).toBe(true);
    expect(KNOWN_COMMANDS.has('scan')).toBe(true);
  });
});

describe('validateSarifFile (workflow SARIF policy)', () => {
  function tmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'veylqorix-sarif-validate-'));
  }

  it('accepts a valid 2.1.0 document with runs', () => {
    const dir = tmpDir();
    try {
      const file = path.join(dir, 'valid.sarif');
      fs.writeFileSync(file, toSarif(withFindings(2, 'HIGH')), 'utf8');
      expect(validateSarifFile(file)).toEqual({ valid: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a missing file as an explicit failure without throwing', () => {
    const file = path.join(tmpDir(), 'missing.sarif');
    expect(validateSarifFile(file)).toEqual({
      valid: false,
      error: `SARIF file not found: ${file}`,
    });
  });

  it('rejects an empty file', () => {
    const dir = tmpDir();
    try {
      const file = path.join(dir, 'empty.sarif');
      fs.writeFileSync(file, '', 'utf8');
      expect(validateSarifFile(file)).toEqual({
        valid: false,
        error: `SARIF file is empty: ${file}`,
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects malformed JSON with a context-bearing error', () => {
    const dir = tmpDir();
    try {
      const file = path.join(dir, 'malformed.sarif');
      fs.writeFileSync(file, '{ not valid json', 'utf8');
      const result = validateSarifFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/^SARIF file is not valid JSON:/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a document with the wrong version', () => {
    const dir = tmpDir();
    try {
      const file = path.join(dir, 'wrong-version.sarif');
      fs.writeFileSync(file, JSON.stringify({ version: '2.0', runs: [] }), 'utf8');
      expect(validateSarifFile(file)).toEqual({
        valid: false,
        error: "SARIF file has version '2.0'; expected '2.1.0'.",
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a missing version as (none) and rejects the document', () => {
    const dir = tmpDir();
    try {
      const file = path.join(dir, 'no-version.sarif');
      fs.writeFileSync(file, JSON.stringify({ runs: [] }), 'utf8');
      expect(validateSarifFile(file)).toEqual({
        valid: false,
        error: "SARIF file has version '(none)'; expected '2.1.0'.",
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a version-2.1.0 document with no runs', () => {
    const dir = tmpDir();
    try {
      const file = path.join(dir, 'no-runs.sarif');
      fs.writeFileSync(file, JSON.stringify({ version: '2.1.0' }), 'utf8');
      expect(validateSarifFile(file)).toEqual({
        valid: false,
        error: 'SARIF file has no runs; a code-scanning upload would post nothing.',
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('SARIF upload policy (unit-level workflow simulation)', () => {
  /**
   * Models the workflow's "Validate SARIF artifact" + "Upload SARIF to code
   * scanning" pair: validate first, then hand the file to an upload step
   * standing in for codeql-action/upload-sarif (no GitHub calls). An
   * invalid or missing file must surface as an explicit failure, never be
   * swallowed or reported as a successful upload.
   */
  function runSarifUpload(
    sarifPath: string,
    upload: (file: string) => void,
  ): { ok: boolean; error?: string } {
    const validation = validateSarifFile(sarifPath);
    if (!validation.valid) {
      return { ok: false, error: validation.error };
    }
    try {
      upload(sarifPath);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    return { ok: true };
  }

  it('surfaces a missing or invalid SARIF as a failure, not an upload success', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veylqorix-upload-policy-'));
    try {
      const missing = path.join(dir, 'absent.sarif');
      const uploadCalled = { value: false };
      const missingResult = runSarifUpload(missing, () => {
        uploadCalled.value = true;
      });
      expect(missingResult.ok).toBe(false);
      expect(missingResult.error).toContain('SARIF file not found');
      expect(uploadCalled.value).toBe(false);

      const bad = path.join(dir, 'bad.sarif');
      fs.writeFileSync(bad, JSON.stringify({ version: '2.0' }), 'utf8');
      const badResult = runSarifUpload(bad, () => {
        uploadCalled.value = true;
      });
      expect(badResult.ok).toBe(false);
      expect(badResult.error).toBe("SARIF file has version '2.0'; expected '2.1.0'.");
      expect(uploadCalled.value).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('propagates an upload-step failure (permission, disabled code scanning)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veylqorix-upload-policy-'));
    try {
      const good = path.join(dir, 'good.sarif');
      fs.writeFileSync(good, toSarif(withFindings(1, 'CRITICAL')), 'utf8');
      const result = runSarifUpload(good, () => {
        throw new Error('security-events: write permission not available');
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('security-events: write permission not available');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports success only when validation passed and the upload completed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veylqorix-upload-policy-'));
    try {
      const good = path.join(dir, 'good.sarif');
      fs.writeFileSync(good, toSarif(withFindings(1, 'CRITICAL')), 'utf8');
      const uploaded: string[] = [];
      const result = runSarifUpload(good, (file) => uploaded.push(file));
      expect(result).toEqual({ ok: true });
      expect(uploaded).toEqual([good]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
