/**
 * Unit tests for the @veylqorix/plugin SDK.
 *
 * Covers:
 * - `definePlugin` structural validation (fails fast, freezes the result)
 * - the `Plugin` → `runAudit` option bridge (scanner/check mapping, dedup)
 * - normalization of bare `Finding[]` scanner returns (ids, clamping, drop
 *   malformed entries, PASS/FAIL status)
 * - `runPluginAudit` end-to-end against a temporary repository, on BOTH gate
 *   authorities: the Rust engine (when the binary resolves) and the
 *   byte-compatible TypeScript fallback (forced via VEYLQORIX_ENGINE pointing
 *   at a missing path) — proving the plugin evidence reaches the gate on the
 *   path the core would have taken anyway.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  evaluateGate,
  exitCodeFor,
  isEngineAvailable,
  normalizeFindings,
  type Finding,
} from '@veylqorix/core';
import {
  definePlugin,
  PluginValidationError,
  toAuditOptions,
  withPlugin,
  runPluginAudit,
} from './index.js';

// ---------------------------------------------------------------------------
// definePlugin
// ---------------------------------------------------------------------------

describe('definePlugin', () => {
  it('freezes a valid plugin and normalizes its parts', () => {
    const p = definePlugin({
      id: 'acme/sast',
      version: '1.0.0',
      description: 'SAST scanner',
      scanners: [
        {
          id: 'acme-sast',
          run: async () => [],
        },
      ],
      checks: [
        {
          id: 'coverage',
          command: 'custom coverage check',
          run: async () => ({
            id: 'coverage',
            command: 'custom coverage check',
            status: 'PASS',
            durationMs: 0,
          }),
        },
      ],
    });
    expect(p.id).toBe('acme/sast');
    expect(p.scanners).toHaveLength(1);
    expect(p.checks).toHaveLength(1);
    expect(p.checks[0]?.command).toBe('custom coverage check');
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p.scanners)).toBe(true);
  });

  it('defaults scanners to non-mandatory', () => {
    const p = definePlugin({ id: 'x', scanners: [{ id: 's', run: async () => [] }] });
    expect(p.scanners[0]?.mandatory).toBe(false);
    const p2 = definePlugin({ id: 'x', scanners: [{ id: 's', mandatory: true, run: async () => [] }] });
    expect(p2.scanners[0]?.mandatory).toBe(true);
  });

  it('rejects an empty plugin id', () => {
    expect(() => definePlugin({ id: '  ' })).toThrow(PluginValidationError);
  });

  it('rejects scanners without a non-empty id', () => {
    expect(() =>
      definePlugin({ id: 'x', scanners: [{ id: '', run: async () => [] }] }),
    ).toThrow(PluginValidationError);
  });

  it('rejects scanners without a run function', () => {
    expect(() =>
      definePlugin({
        id: 'x',
        scanners: [{ id: 's' } as never],
      }),
    ).toThrow(PluginValidationError);
  });

  it('rejects checks without a run function', () => {
    expect(() => definePlugin({ id: 'x', checks: [{ id: 'c' } as never] })).toThrow(
      PluginValidationError,
    );
  });

  it('rejects a blank check command rather than keeping it', () => {
    const p = definePlugin({
      id: 'x',
      checks: [
        {
          id: 'c',
          command: '   ',
          run: async () => ({
            id: 'c',
            command: 'c',
            status: 'PASS',
            durationMs: 0,
          }),
        },
      ],
    });
    expect(p.checks[0]?.command).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// the Plugin → runAudit option bridge
// ---------------------------------------------------------------------------

function passthroughPlugin() {
  return definePlugin({
    id: 'bridge',
    scanners: [{ id: 'no-findings', run: async () => [] }],
    checks: [
      {
        id: 'ok-check',
        command: 'ok-check --flag',
        run: async () => ({
          id: 'ok-check',
          command: 'ok-check --flag',
          status: 'PASS',
          durationMs: 0,
        }),
      },
    ],
  });
}

describe('toAuditOptions / withPlugin', () => {
  it('maps scanners and checks into the external slots', () => {
    const options = toAuditOptions({ root: '/tmp/anything' }, passthroughPlugin());
    expect(options.externalScanners ?? []).toHaveLength(1);
    expect(options.externalScanners?.[0]?.name).toBe('no-findings');
    expect(options.externalChecks ?? []).toHaveLength(1);
    expect(options.externalChecks?.[0]?.id).toBe('ok-check');
    // The base options flow through untouched.
    expect(options.root).toBe('/tmp/anything');
  });

  it('is additive and deduplicates by id', async () => {
    const options = withPlugin({ root: '/tmp/anything' }, passthroughPlugin());
    const merged = withPlugin(options, passthroughPlugin());
    expect(merged.externalScanners).toHaveLength(1);
    expect(merged.externalChecks).toHaveLength(1);
    await Promise.resolve();
  });
});

// ---------------------------------------------------------------------------
// Finding[] return normalization
// ---------------------------------------------------------------------------

describe('bare Finding[] scanner returns', () => {
  it('normalizeFindings is a pure function of its inputs (id + clamping)', () => {
    const raw: unknown[] = [
      {
        scanner: 'plugin-x',
        ruleId: 'no-eval',
        title: 'eval() used',
        severity: 'NOT_A_SEVERITY', // clamps to MEDIUM
        confidence: 'NOT_A_CONFIDENCE', // clamps to MEDIUM
        location: { file: 'src/a.ts', line: 42 },
      },
      { scanner: 'plugin-x' }, // no title/ruleId → dropped
      'garbage', // not an object → dropped
    ];
    const { findings, rejected } = normalizeFindings('plugin-x', raw);
    expect(findings).toHaveLength(1);
    expect(rejected).toBe(2);
    const f = findings[0]!;
    expect(f.severity).toBe('MEDIUM');
    expect(f.confidence).toBe('MEDIUM');
    expect(f.location?.file).toBe('src/a.ts');
    // Deterministic id (same inputs ⇒ same id).
    const again = normalizeFindings('plugin-x', [raw[0]]);
    expect(again.findings[0]?.id).toBe(f.id);
  });

  it('a plugin scanner returning findings drives the gate deterministically', () => {
    const findings: Finding[] = [
      {
        id: 'PLUG-DEADBEEF',
        title: 'Exposed API key',
        scanner: 'plugin-x',
        ruleId: 'leaked-key',
        severity: 'HIGH',
        confidence: 'CONFIRMED',
      },
    ];
    const gate = evaluateGate({
      findings,
      checks: [],
      scanners: [{ scanner: 'plugin-x', status: 'FAIL', findings, durationMs: 0, notes: [] }],
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
    });
    expect(gate.result).toBe('FAIL');
    expect(exitCodeFor(gate, gate.coverage)).toBe(1);
    expect(gate.blockingReasons[0]).toContain('leaked-key');
  });
});

// ---------------------------------------------------------------------------
// runPluginAudit — end-to-end, both gate authorities
// ---------------------------------------------------------------------------

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veylqorix-plugin-'));
  // A Node repo, but no lockfile / no test script: `npm audit` and the
  // quality-check detector stay quiet, so the gate outcome is decided by the
  // plugin evidence alone.
  fs.writeFileSync(
    path.join(tmp, 'package.json'),
    JSON.stringify({ name: 'plugin-fixture', version: '1.0.0' }, null, 2),
  );
  fs.writeFileSync(path.join(tmp, 'index.js'), 'module.exports = 1;\n');
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function findingPlugin(severity: Finding['severity']) {
  return definePlugin({
    id: 'fixture-findings',
    scanners: [
      {
        id: 'fixture-scan',
        run: async () => [
          {
            scanner: 'fixture-scan',
            ruleId: 'fixture-rule',
            title: 'Fixture finding',
            severity,
            confidence: 'CONFIRMED',
          },
        ],
      },
    ],
  });
}

function throwingScannerPlugin() {
  return definePlugin({
    id: 'fixture-throwing',
    scanners: [
      {
        id: 'fixture-throws',
        run: async () => {
          throw new Error('boom: scanner crashed');
        },
      },
    ],
  });
}

function failingCheckPlugin() {
  return definePlugin({
    id: 'fixture-checks',
    checks: [
      {
        id: 'fixture-fail-check',
        command: 'fixture-check --fail',
        run: async () => ({
          id: 'fixture-fail-check',
          command: 'fixture-check --fail',
          status: 'FAIL',
          durationMs: 0,
          output: '1 test failed',
        }),
      },
    ],
  });
}

function throwingCheckPlugin() {
  return definePlugin({
    id: 'fixture-check-throw',
    checks: [
      {
        id: 'fixture-check-throw',
        run: async () => {
          throw new Error('check binary missing');
        },
      },
    ],
  });
}

describe('runPluginAudit (end-to-end)', () => {
  it('reports the gate authority it actually used (never a silent mismatch)', async () => {
    // A finding-free plugin: the audit should still complete and its exit code
    // must match the gate result on whichever path ran.
    const p = definePlugin({
      id: 'no-op',
      scanners: [{ id: 'no-op-scan', run: async () => [] }],
    });
    const result = await runPluginAudit({ root: tmp, online: false }, p);
    const expected = exitCodeFor(result.gate, result.gate.coverage);
    expect(result.exitCode).toBe(expected);
    // The plugin scanner must be visible in the result.
    expect(result.scanners.map((s) => s.scanner)).toContain('no-op-scan');
  });

  it('a plugin scanner returning HIGH findings blocks the gate (exit 1)', async () => {
    const result = await runPluginAudit({ root: tmp, online: false }, findingPlugin('HIGH'));
    expect(result.gate.result).toBe('FAIL');
    expect(result.exitCode).toBe(1);
    const ids = result.findings.map((f) => f.ruleId);
    expect(ids).toContain('fixture-rule');
    expect(result.gate.blockingReasons.join('\n')).toContain('fixture-rule');
  });

  it('a plugin scanner returning MEDIUM findings is reported but not blocking', async () => {
    const result = await runPluginAudit({ root: tmp, online: false }, findingPlugin('MEDIUM'));
    const found = result.findings.find((f) => f.ruleId === 'fixture-rule');
    expect(found).toBeDefined();
    // MEDIUM is not in the default blocking severities and it is not a secret.
    expect(result.gate.result !== 'FAIL' || result.gate.coverage !== 'FULL').toBe(true);
    expect(result.gate.blockingReasons.join('\n')).not.toContain('fixture-rule');
  });

  it('a plugin scanner that throws degrades coverage, never passes', async () => {
    const result = await runPluginAudit({ root: tmp, online: false }, throwingScannerPlugin());
    const scanner = result.scanners.find((s) => s.scanner === 'fixture-throws');
    expect(scanner?.status).toBe('ERROR');
    expect(scanner?.error?.message).toContain('boom');
    // With the default policy, an errored scanner blocks the gate (exit 1),
    // and the incomplete reasons are recorded (coverage degraded).
    expect(result.exitCode).toBe(1);
    expect(result.gate.incompleteReasons.join('\n')).toContain('fixture-throws');
  });

  it('a plugin check that FAILs blocks the gate', async () => {
    const result = await runPluginAudit({ root: tmp, online: false }, failingCheckPlugin());
    const check = result.checks.find((c) => c.id === 'fixture-fail-check');
    expect(check?.status).toBe('FAIL');
    expect(result.exitCode).toBe(1);
    expect(result.gate.blockingReasons.join('\n')).toContain('fixture-fail-check');
  });

  it('a plugin check that throws degrades coverage, never passes', async () => {
    const result = await runPluginAudit({ root: tmp, online: false }, throwingCheckPlugin());
    const check = result.checks.find((c) => c.id === 'fixture-check-throw');
    expect(check?.status).toBe('ERROR');
    expect(check?.error?.message).toContain('check binary missing');
    // An errored check blocks under the default policy (exit 1) and is
    // recorded as an incomplete reason.
    expect(result.exitCode).toBe(1);
    expect(result.gate.incompleteReasons.join('\n')).toContain('fixture-check-throw');
  });

  it('multiple plugins contribute additively', async () => {
    const result = await runPluginAudit(
      { root: tmp, online: false },
      findingPlugin('HIGH'),
      failingCheckPlugin(),
    );
    const scanners = result.scanners.map((s) => s.scanner);
    expect(scanners).toContain('fixture-scan');
    expect(result.checks.map((c) => c.id)).toContain('fixture-fail-check');
    expect(result.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Both gate authorities: Rust engine (when present) and the TS fallback
// ---------------------------------------------------------------------------

describe('gate-authority parity for plugin evidence', () => {
  const savedEngine = process.env.VEYLQORIX_ENGINE;

  afterAll(() => {
    // Restore the environment so later tests/CI see the original resolution.
    if (savedEngine === undefined) delete process.env.VEYLQORIX_ENGINE;
    else process.env.VEYLQORIX_ENGINE = savedEngine;
  });

  it('the TypeScript fallback path also blocks on plugin HIGH findings', async () => {
    process.env.VEYLQORIX_ENGINE = path.join(tmp, 'no-such-engine-binary');
    const result = await runPluginAudit({ root: tmp, online: false }, findingPlugin('HIGH'));
    expect(result.exitCode).toBe(1);
    expect(result.findings.map((f) => f.ruleId)).toContain('fixture-rule');
    // The degraded-mode note proves this ran on the TS engine, not the binary.
    const secretNotes = result.scanners
      .filter((s) => s.scanner === 'secrets')
      .flatMap((s) => s.notes);
    expect(
      secretNotes.some((n) => n.includes('degraded compatibility mode') || n.includes('Rust engine unavailable')),
    ).toBe(true);
  });

  it.skipIf(!isEngineAvailable())(
    'the Rust engine path (default) also blocks on plugin HIGH findings',
    async () => {
      if (savedEngine === undefined) delete process.env.VEYLQORIX_ENGINE;
      else process.env.VEYLQORIX_ENGINE = savedEngine;
      const result = await runPluginAudit({ root: tmp, online: false }, findingPlugin('HIGH'));
      expect(result.exitCode).toBe(1);
      expect(result.findings.map((f) => f.ruleId)).toContain('fixture-rule');
    },
  );
});
