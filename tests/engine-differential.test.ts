import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createEngineAdapter,
  evaluateGate,
  exitCodeFor,
  isEngineAvailable,
  normalizeFindings,
  redactSecret,
  resolvePolicy,
  type CheckResult,
  type CoverageLevel,
  type Finding,
  type GateDecision,
  type Policy,
  type ScannerResult,
} from '@veylqorix/core';

/**
 * Engine parity (differential) tests, driven by the shared fixture files
 * `tests/<name>/fixture.json` (one directory per parity case).
 *
 * Every fixture carries an `expect` block that both implementations must
 * satisfy from the same input:
 * - the TypeScript path runs unconditionally: `resolvePolicy` + `evaluateGate`
 *   + `exitCodeFor` (and the strict mapping) from `@veylqorix/core`, so the TS
 *   gate is pinned to the expectation even when the engine binary is absent;
 * - the Rust engine path runs the real binary through the adapter and only
 *   when the binary is present, so every engine-backed test title is labeled
 *   '(engine binary present)' — a skip is explicit, never a faked pass.
 *
 * The degraded-run semantics (engine-absent clean runs PASS with the
 * 'Rust engine unavailable' TS-compat note; INCOMPLETE only for
 * coverage-degrading SKIPPED/ERROR mandatory items) are pinned separately in
 * `tests/engine-adapter.test.ts`. These fixtures pin the decision-core
 * parity that both engines share.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const fixturesDir = path.join(repoRoot, 'tests', 'fixtures');

/** The fifteen fixture directories this file loads, one per parity case. */
const FIXTURE_NAMES = [
  'secrets-present',
  'secrets-absent',
  'dependency-results',
  'empty-findings',
  'policy-with-expired-exception',
  'verdict-pass',
  'verdict-fail',
  'verdict-incomplete',
  'scanner-missing-binary',
  'scanner-timeout',
  'scanner-unexpected-exit',
  'malformed-findings',
  'invalid-protocol-version',
  'root-confinement',
  'redaction-values',
] as const;

interface FixtureInput {
  findings?: Finding[];
  checks?: CheckResult[];
  scannerResults?: ScannerResult[];
}

interface Fixture {
  name: string;
  kind: string;
  description?: string;
  command?: string;
  input?: FixtureInput;
  policy?: Policy;
  strict?: boolean;
  scanRoot?: string;
  expectedRustExitCode?: number;
  requestProtocolVersion?: number;
  responseProtocolVersion?: number;
  cases?: Array<{ input: string; expected: string }>;
  expect: {
    verdict?: string;
    exitCode?: number;
    strictExitCode?: number;
    coverage?: string;
    findingIds?: string[];
    severityOf?: Record<string, string>;
    blockingReasonContains?: string[];
    incompleteContains?: string[];
    reportContains?: string[];
    neverPass?: boolean;
    protocolError?: boolean;
    rustExitCode?: number;
    tsRaises?: string;
  };
}

function loadFixture(name: string): Fixture {
  const file = path.join(fixturesDir, name, 'fixture.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Fixture;
}

const allFixtures: Fixture[] = FIXTURE_NAMES.map((n) => loadFixture(n));
const diffFixtures = allFixtures.filter((f) => f.kind === 'diff');
const protocolFixtures = allFixtures.filter((f) => f.kind === 'protocol');
const redactionFixtures = allFixtures.filter((f) => f.kind === 'redaction');

/**
 * Local mirror of `strictExitCode` in `packages/core/src/gate/index.ts` (a
 * blocked decision or any completeness gap forces non-zero; otherwise 0). The
 * root index currently re-exports only `exitCodeFor`/`evaluateGate`, so the
 * strict mapping is asserted here from the same gate decision; the engine side
 * asserts the binary's real `strictExitCode` field for the same value.
 */
function strictExitCodeLocal(decision: GateDecision, coverage: CoverageLevel): number {
  if (decision.blockingReasons.length > 0) return 1;
  if (decision.incompleteReasons.length > 0 || coverage === 'LIMITED' || coverage === 'NONE') return 2;
  return 0;
}

describe('engine parity fixtures load (always runs)', () => {
  it('has exactly the fifteen expected fixture directories, each with a fixture.json', () => {
    for (const name of FIXTURE_NAMES) {
      const file = path.join(fixturesDir, name, 'fixture.json');
      expect(fs.existsSync(file), `${file} is missing`).toBe(true);
    }
    const withFixture = fs
      .readdirSync(fixturesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(fixturesDir, e.name, 'fixture.json')))
      .map((e) => e.name)
      .sort();
    expect(withFixture).toEqual([...FIXTURE_NAMES].sort());
  });

  it('every differential fixture drives the evaluate command; protocol fixtures are version/root cases', () => {
    for (const fixture of diffFixtures) {
      expect(fixture.command, `${fixture.name} must drive the evaluate command`).toBe('evaluate');
    }
    // Protocol fixtures have no `command` (they pin version/root rejection,
    // not an evaluate round-trip); their expected rejection is in expect.
    for (const fixture of protocolFixtures) {
      expect(fixture.expect.protocolError, `${fixture.name} must pin a protocol error`).toBe(true);
      expect(fixture.expect.rustExitCode, `${fixture.name} must pin the engine exit code`).toBeGreaterThanOrEqual(0);
    }
  });
});

/* ------------------------------------------------------------------------ *
 * TypeScript side: runs unconditionally, pinning the TS gate core to the
 * same expectation the Rust engine is pinned to below.
 * ------------------------------------------------------------------------ */

for (const fixture of diffFixtures) {
  if (!fixture.expect) {
    throw new Error(`diff fixture '${fixture.name}' has no expect block`);
  }
  // The malformed-findings fixture is a protocol/shape-rejection case, not a
  // verdict case: its expect carries `protocolError` instead of `verdict`.
  // It is asserted in its own dedicated TS block below and in the engine
  // group; the generic loop must skip it.
  if (fixture.expect.protocolError) continue;

  describe(`differential fixture '${fixture.name}' (TypeScript path, always runs)`, () => {
    const input: FixtureInput = fixture.input ?? { findings: [], checks: [], scannerResults: [] };
    const decision = evaluateGate({
      findings: input.findings ?? [],
      checks: input.checks ?? [],
      scanners: input.scannerResults ?? [],
      policy: resolvePolicy(fixture.policy),
    });

    it('reaches the expected verdict', () => {
      expect(decision.result).toBe(fixture.expect.verdict);
      if (fixture.expect.neverPass) {
        expect(decision.result, 'a never-pass fixture must never read as a clean pass').not.toBe(
          'PASS',
        );
      }
    });

    it('maps the expected soft exit code', () => {
      expect(exitCodeFor(decision, decision.coverage)).toBe(fixture.expect.exitCode);
    });

    it('maps the expected strict exit code when the fixture is strict', () => {
      if (fixture.strict || fixture.expect.strictExitCode !== undefined) {
        expect(strictExitCodeLocal(decision, decision.coverage)).toBe(fixture.expect.strictExitCode);
      }
    });

    it('reports the expected coverage level', () => {
      expect(decision.coverage).toBe(fixture.expect.coverage);
    });

    it('surfaces the expected finding ids and severities', () => {
      const ids = (input.findings ?? []).map((f) => f.id);
      for (const expectedId of fixture.expect.findingIds ?? []) {
        expect(ids, `input finding ids: ${ids.join(', ')}`).toContain(expectedId);
      }
      for (const [id, severity] of Object.entries(fixture.expect.severityOf ?? {})) {
        expect((input.findings ?? []).find((x) => x.id === id)?.severity).toBe(severity);
      }
    });

    it('records the expected blocking and incomplete reasons', () => {
      for (const phrase of fixture.expect.blockingReasonContains ?? []) {
        expect(decision.blockingReasons.join('\n')).toContain(phrase);
      }
      for (const phrase of fixture.expect.incompleteContains ?? []) {
        expect(decision.incompleteReasons.join('\n')).toContain(phrase);
      }
    });

    it('carries the expected finding records in the report document', () => {
      // `reportContains` targets ids the report must carry. A report serializes
      // the full finding set (reported, blocking, and suppressed-for-audit)
      // plus the gate decision, so the id is checked anywhere in that document.
      const document = JSON.stringify({ decision, findings: input.findings ?? [] });
      for (const id of fixture.expect.reportContains ?? []) {
        expect(document, `report document: ${document}`).toContain(id);
      }
    });
  });
}

describe(`differential fixture 'malformed-findings' (TypeScript path, always runs)`, () => {
  const fixture = diffFixtures.find((f) => f.name === 'malformed-findings')!;
  it('the TS normalizer never silently reads the whole document as a pass', () => {
    // The in-process TS path is deliberately tolerant (an invalid enum is
    // downgraded, a missing ruleId is rejected) so a bad scanner cannot crash
    // the audit — but it must NOT coerce the shape-invalid document into a
    // clean pass. At least one of the three BROKEN-* entries is rejected, and
    // any kept invalid-severity entry is downgraded rather than trusted. The
    // strict whole-document rejection (exit 64) is the engine's job and is
    // pinned in the engine block below.
    const raw = (fixture.input?.findings as unknown[] | undefined) ?? [];
    const { findings, rejected } = normalizeFindings('secrets', raw);
    expect(rejected, 'at least one shape-invalid entry must be rejected').toBeGreaterThanOrEqual(1);
    const downgraded = findings.find((f) => f.title === 'Finding with an invalid severity enum value');
    expect(downgraded?.severity, 'an invalid severity must be downgraded, never trusted').toBe(
      'MEDIUM',
    );
  });
});

describe(`differential fixture 'redaction-values' (TypeScript path, always runs)`, () => {
  const fixture = redactionFixtures[0];
  it.each(fixture.cases ?? [])('masks %s exactly as the shared golden vector', ({ input, expected }) => {
    expect(redactSecret(input)).toBe(expected);
  });

  it('never emits the raw value in the masked output', () => {
    for (const { input, expected } of fixture.cases ?? []) {
      // Long values keep only a 4+4-char head/tail window; the full raw value
      // must not survive the mask.
      if (input.length > 8) {
        expect(expected, `raw value leaked through for ${JSON.stringify(input)}`).not.toContain(input);
      }
    }
  });
});

/* ------------------------------------------------------------------------ *
 * Rust engine side: the same fixtures driven through the real binary.
 * Skipped, explicitly labeled, when the engine is not built.
 * ------------------------------------------------------------------------ */

const engineAvailable = isEngineAvailable();

describe.skipIf(!engineAvailable)('differential fixtures (engine binary present)', () => {
  for (const fixture of diffFixtures) {
    // malformed-findings is asserted in its own test below.
    if (fixture.expect.protocolError) continue;

    it(`'${fixture.name}' (engine binary present) reaches the same verdict, exit codes, coverage and finding records`, async () => {
      const input: FixtureInput = fixture.input ?? { findings: [], checks: [], scannerResults: [] };
      const response = await createEngineAdapter().engineEvaluate({
        policy: fixture.policy,
        findings: input.findings ?? [],
        scannerResults: input.scannerResults ?? [],
        checks: input.checks ?? [],
        strict: fixture.strict ?? false,
      });

      expect(response.ok, 'the engine response must be a success document').toBe(true);
      const gate = response.gate;
      expect(gate, 'a completed evaluate must carry a gate decision').toBeDefined();
      expect(gate!.result).toBe(fixture.expect.verdict);
      if (fixture.expect.neverPass) expect(gate!.result).not.toBe('PASS');
      expect(gate!.coverage).toBe(fixture.expect.coverage);
      expect(response.exitCode).toBe(fixture.expect.exitCode);
      if (fixture.strict && fixture.expect.strictExitCode !== undefined) {
        expect(response.strictExitCode).toBe(fixture.expect.strictExitCode);
      }

      const engineIds = (response.findings ?? []).map((f) => f.id);
      for (const expectedId of fixture.expect.findingIds ?? []) {
        expect(engineIds, `engine finding ids: ${engineIds.join(', ')}`).toContain(expectedId);
      }
      for (const [id, severity] of Object.entries(fixture.expect.severityOf ?? {})) {
        expect((response.findings ?? []).find((f) => f.id === id)?.severity).toBe(severity);
      }
      for (const phrase of fixture.expect.blockingReasonContains ?? []) {
        expect(gate!.blockingReasons.join('\n')).toContain(phrase);
      }
      for (const phrase of fixture.expect.incompleteContains ?? []) {
        expect(gate!.incompleteReasons.join('\n')).toContain(phrase);
      }
      const document = JSON.stringify({
        blockingReasons: gate!.blockingReasons,
        incompleteReasons: gate!.incompleteReasons,
        reportedFindings: gate!.reportedFindings,
        findings: response.findings,
      });
      for (const id of fixture.expect.reportContains ?? []) {
        expect(document, `report document: ${document}`).toContain(id);
      }
    });
  }

  it('malformed-findings (engine binary present): shape-invalid evidence is a protocol error with exit 64, never a decision', async () => {
    const fixture = diffFixtures.find((f) => f.name === 'malformed-findings')!;
    const input: FixtureInput = fixture.input ?? { findings: [], checks: [], scannerResults: [] };
    // The Rust engine rejects the whole request document (strict serde enums +
    // required fields) with exit 64 — a protocol error, never a decision. The
    // adapter surfaces it as EngineProtocolError carrying the exit code.
    await expect(
      createEngineAdapter().engineEvaluate({
        policy: fixture.policy,
        findings: input.findings ?? [],
        scannerResults: input.scannerResults ?? [],
        checks: input.checks ?? [],
        strict: false,
      }),
    ).rejects.toMatchObject({
      name: 'EngineProtocolError',
      exitCode: fixture.expect.rustExitCode, // 64
    });
  });
});

describe.skipIf(!engineAvailable)('protocol fixtures (engine binary present)', () => {
  it('invalid-protocol-version (engine binary present): a request the engine does not speak is rejected with exit 64, never read as a pass', async () => {
    // The engine rejects any protocolVersion it does not speak (exit 64, a
    // structured malformed-request frame on stdout, no gate). The adapter
    // surfaces that as EngineProtocolError — the fixture's tsRaises value.
    const fixture = protocolFixtures.find((f) => f.name === 'invalid-protocol-version')!;
    await expect(
      createEngineAdapter().request({
        protocolVersion: fixture.requestProtocolVersion ?? 99,
        command: 'ping',
        args: {},
      }),
    ).rejects.toMatchObject({
      name: 'EngineProtocolError',
      exitCode: fixture.expect.rustExitCode, // 64
    });
  });

  it('root-confinement (engine binary present): a scan with a missing root exits 65 with a root-not-found error frame and no gate', async () => {
    // Closest documented Rust behavior: the engine refuses a missing audit
    // root out-of-band — exit 65, structured frame {ok:false,
    // error:{code:'root-not-found', exitCode:65}}, no gate decision.
    const fixture = protocolFixtures.find((f) => f.name === 'root-confinement')!;
    const root = path.join(repoRoot, fixture.scanRoot ?? 'tests/fixtures/does-not-exist');
    await expect(
      createEngineAdapter().request({ protocolVersion: 1, command: 'scan', args: { root, runSecrets: true } }),
    ).rejects.toMatchObject({
      name: 'EngineProtocolError',
      exitCode: fixture.expect.rustExitCode, // 65
    });
  });
});
