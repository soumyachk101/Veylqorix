import { resolve as resolvePath } from 'node:path';
import { detectProject } from './detect.js';
import { RustEngineAdapter, type EngineResponse } from './engine/index.js';
import { evaluateGate, exitCodeFor, strictExitCode } from './gate/index.js';
import { resolvePolicy } from './policy.js';
import {
  dependencyScanner,
  type DependencyScanOptions,
} from './scanners/dependencies.js';
import { scanLicenses } from './scanners/licenses.js';
import { detectChecks, runCheck } from './scanners/quality.js';
import { scanSecrets } from './scanners/secrets.js';
import {
  runScannerSafely,
  withTimeout,
  type ScannerDefinition,
  type ScannerContext,
} from './scanners/registry.js';
import type {
  AuditResult,
  CheckResult,
  Finding,
  GateDecision,
  Policy,
  ProjectDetection,
  ScannerResult,
} from './types.js';

/**
 * A caller-supplied quality-check runner, executed by the audit in place of
 * the built-in command mapping. It is what lets an extension (e.g. a plugin
 * package) add project-specific checks without re-implementing the gate.
 */
export interface ExternalCheck {
  /** Stable identifier for the check, e.g. `custom-coverage`. */
  id: string;
  /** Informational description of what the check runs. */
  command?: string;
  /** Run the check and return a normalized result. Errors/timeouts become
   *  `ERROR` results (degraded coverage), never a silent pass. */
  run(ctx: ExternalCheckContext): Promise<CheckResult>;
}

export interface ExternalCheckContext {
  /** Absolute path of the audited root. */
  root: string;
  /** The project detection for the audited root. */
  detection: ProjectDetection;
  /** Per-check timeout in milliseconds. */
  timeoutMs: number;
  /** True when the audit is running in offline mode. */
  offline: boolean;
}

export interface AuditOptions {
  /** Root directory of the project to audit. */
  root: string;
  /**
   * Extra scanners to run alongside the built-in ones. Each is a standard
   * `ScannerDefinition` and is executed with the same safe wrapper (timeout +
   * error classification), so a plugin scanner that errors degrades coverage
   * exactly like a built-in one — it can never become a silent pass. Its
   * findings and result are merged into the gate evidence.
   */
  externalScanners?: ScannerDefinition[];
  /**
   * Extra quality-check runners, executed after the built-in checks and merged
   * into the gate evidence. A runner that throws or overruns its timeout is
   * recorded as an `ERROR` check (degraded coverage), never a pass.
   */
  externalChecks?: ExternalCheck[];
  /** Partial policy overrides on top of the defaults. */
  policy?: Partial<Policy>;
  /** Run external scanners (npm audit, pip-audit); false forces offline mode. */
  online?: boolean;
  /** Per-scanner timeout in milliseconds. */
  scannerTimeoutMs?: number;
  /** Skip test/build quality checks. */
  includeTests?: boolean;
  /** Mock findings keyed by scanner name, for deterministic tests. */
  mocks?: Record<string, Finding[]>;
  /** Run only the listed scanners; default runs all. */
  onlyScanners?: string[];
  /** Scanners to skip entirely (but keep registered). */
  skipScanners?: string[];
  /** Skip the quality check runner. */
  skipQualityChecks?: boolean;
  /** Restrict the secret scanner to exactly these root-relative files (e.g. staged Git changes). */
  stagedFiles?: string[];
  /**
   * When true, a degraded audit (any side-recorded blocking reason or LIMITED
   * coverage) exits non-zero instead of looking like a clean pass. The gate
   * decision is unchanged; only the exit code mapping is stricter.
   */
  strict?: boolean;
  /**
   * Opt-in delegation of the secret scan to `gitleaks` when it is installed.
   * The built-in offline rule-set remains the authoritative, reproducible
   * default; enabling this only adds gitleaks findings on top of it, so a
   * machine without gitleaks still gets the full offline coverage and the gap
   * is recorded, never silenced.
   */
  preferGitleaks?: boolean;
  /** Stable scan identifier recorded on engine-produced findings. */
  scanId?: string;
}

export interface AuditResultWithExit extends AuditResult {
  exitCode: number;
  /** The exit code under the default (non-strict) mapping, for comparison. */
  softExitCode?: number;
}

/**
 * Honest degradation note used when the audit falls back to the TypeScript
 * policy engine because the Rust engine is unavailable. It is attached to the
 * secret scanner result so a degraded run is never mistaken for a full one.
 */
const TS_COMPAT_NOTE =
  'Rust engine unavailable: TypeScript policy engine evaluated the gate (degraded compatibility mode).';

/**
 * Defensively normalize caller-supplied scanner definitions into the exact
 * shape `runScannerSafely` expects. Extension scanners are optional add-ons,
 * so they default to `mandatory: false` — their being *absent* does not create
 * a completeness gap the way a missing built-in scanner would. A malformed
 * entry (missing name / run) is dropped with a console-free note so a bad
 * plugin cannot corrupt the report or crash the audit.
 */
function normalizeExternalScanners(
  external: ScannerDefinition[] | undefined,
): ScannerDefinition[] {
  if (!Array.isArray(external)) return [];
  const out: ScannerDefinition[] = [];
  for (const def of external) {
    if (def && typeof def === 'object' && typeof def.name === 'string' && def.name.length > 0 && typeof def.run === 'function') {
      out.push({
        name: def.name,
        mandatory: def.mandatory === true,
        run: def.run,
      });
    }
  }
  return out;
}

/**
 * Run one caller-supplied (extension) check under the same safe wrapper the
 * built-in checks use: a wall-clock timeout, and classification of a thrown
 * error or a timeout as an `ERROR` result. This guarantees a plugin check that
 * fails or hangs degrades coverage (INCOMPLETE, exit 2) rather than blocking
 * the audit or being silently treated as a pass.
 */
async function runExternalCheck(
  external: ExternalCheck,
  context: ScannerContext,
): Promise<CheckResult> {
  const startedAt = Date.now();
  const base: CheckResult = {
    id: external.id,
    command: external.command ?? `${external.id} (extension check)`,
    status: 'SKIPPED',
    durationMs: 0,
  };
  try {
    const result = await withTimeout(
      Promise.resolve(
        external.run({
          root: context.root,
          detection: context.detection,
          timeoutMs: context.timeoutMs,
          offline: context.offline,
        }),
      ),
      context.timeoutMs,
      `check ${external.id}`,
    );
    // Normalize: ensure required fields and a real duration even if the runner
    // returned a partial result.
    const status = result.status ?? 'PASS';
    return {
      ...base,
      ...result,
      id: external.id,
      status,
      durationMs: result.durationMs > 0 ? result.durationMs : Date.now() - startedAt,
      command: result.command ?? base.command,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = (error as NodeJS.ErrnoException).code === 'ETIMEDOUT' || message.includes('timed out');
    return {
      ...base,
      status: 'ERROR',
      error: {
        message: isTimeout
          ? `Extension check '${external.id}' timed out after ${context.timeoutMs / 1000}s`
          : `Extension check '${external.id}' failed: ${message}`,
        code: isTimeout ? 'ETIMEDOUT' : (error as NodeJS.ErrnoException).code,
      },
      durationMs: Date.now() - startedAt,
    };
  }
}

/**
 * Run the full audit: detect the project type, execute all configured scanners
 * with per-scanner timeouts, run the applicable quality checks, normalize
 * findings, evaluate the quality gate, and return a complete result.
 *
 * The Rust security engine is the authority for the secret scanner and the
 * gate decision when it is available: the dependency and license scanners run
 * in TypeScript first, their evidence (plus the quality checks and resolved
 * policy) is handed to the engine, and the engine's Rust secret scanner and
 * gate produce the final result. When the engine binary is missing or fails to
 * resolve, the audit degrades to the byte-compatible TypeScript secret scanner
 * and policy engine and labels that honestly on the secret scanner result.
 */
export async function runAudit(options: AuditOptions): Promise<AuditResultWithExit> {
  const startedAt = new Date();
  const root = options.root;
  const timeoutMs = options.scannerTimeoutMs ?? 120_000;

  const detection = detectProject(root);
  const policy = resolvePolicy(options.policy);

  const secretsMocked = options.mocks?.['secrets'] !== undefined;

  const scanners: ScannerDefinition[] = [];
  const skip = new Set(options.skipScanners ?? []);

  const depScanner = dependencyScanner(detection);
  scanners.push({
    name: 'dependencies',
    mandatory: true,
    run: (ctx) =>
      depScanner.run(ctx.detection, {
        cwd: ctx.root,
        offline: ctx.offline,
        timeoutMs: ctx.timeoutMs,
        mockFindings: ctx.mocks?.['dependencies'],
      } as DependencyScanOptions),
  });

  // The secret scanner is run by the Rust engine when it is available and the
  // caller has not asked for a deterministic mock. Otherwise it runs in
  // TypeScript. The definition is registered in either case so that
  // `onlyScanners` / `skipScanners` filtering has a stable entry point.
  scanners.push({
    name: 'secrets',
    mandatory: true,
    run: async (ctx) =>
      scanSecrets(ctx.root, {
        mockFindings: ctx.mocks?.['secrets'],
        files: options.stagedFiles,
      }),
  });

  scanners.push({
    name: 'licenses',
    mandatory: false,
    run: async (ctx) => scanLicenses({ root: ctx.root, mockFindings: ctx.mocks?.['licenses'] }),
  });

  const selected = options.onlyScanners
    ? scanners.filter((s) => options.onlyScanners?.includes(s.name))
    : scanners.filter((s) => !skip.has(s.name));

  const context: ScannerContext = {
    root,
    detection,
    timeoutMs,
    offline: !(options.online ?? true),
    mocks: options.mocks,
  };

  // Run every selected scanner except the secret scanner. The secret scanner is
  // performed by the engine (or in the compatibility path below) so it is not
  // double-executed when the engine is the authority.
  const nonSecret = selected.filter((s) => s.name !== 'secrets');
  const scannerResults: ScannerResult[] = [];
  for (const scanner of nonSecret) {
    scannerResults.push(await runScannerSafely(scanner, context));
  }

  // Caller-supplied (extension) scanners run alongside the built-ins, under the
  // same safe wrapper, so an error or timeout becomes an ERROR result — degraded
  // coverage, never a pass. They are additive: their evidence is merged into the
  // gate below whether or not `onlyScanners`/`skipScanners` filtered the built-ins.
  for (const external of normalizeExternalScanners(options.externalScanners)) {
    scannerResults.push(await runScannerSafely(external, context));
  }

  // When a caller restricts the audit with `onlyScanners` or `skipScanners`,
  // every mandatory scanner that was not selected is recorded as SKIPPED with
  // an explicit note. This is the gate input the unselected-mandatory path
  // relies on: without it the gate would see zero scanners and could return
  // PASS, which is the F-05 bug (see docs/engineering/BASELINE_AUDIT.md).
  const selectedNames = new Set(selected.map((s) => s.name));
  for (const scanner of scanners) {
    if (scanner.mandatory && !selectedNames.has(scanner.name)) {
      scannerResults.push({
        scanner: scanner.name,
        status: 'SKIPPED',
        findings: [],
        durationMs: 0,
        notes: [`${scanner.name} scanner was not selected for this audit.`],
      });
    }
  }

  let checks: CheckResult[] = [];
  if (!options.skipQualityChecks) {
    checks = detectChecks(detection, {
      root,
      timeoutMs,
      includeTests: options.includeTests,
    });
    const toRun = checks.filter(
      (c) => c.status === 'SKIPPED' && c.reason?.includes('fills in the actual result'),
    );
    for (const check of toRun) {
      const result = await runCheck(check, {
        root,
        timeoutMs,
        includeTests: options.includeTests,
      });
      checks = checks.map((c) => (c.id === check.id ? result : c));
    }
  }

  // Caller-supplied (extension) checks run after the built-ins and are merged
  // into the gate evidence. A runner that throws or overruns its timeout is
  // recorded as an ERROR check (degraded coverage) — never a silent pass — so
  // a plugin check can never make a bad scan look clean. They honor
  // `skipQualityChecks`: when quality checks are skipped globally, extension
  // checks are skipped too, keeping "no check evidence reaches the gate" true.
  if (!options.skipQualityChecks) {
    for (const external of options.externalChecks ?? []) {
      checks.push(await runExternalCheck(external, context));
    }
  }

  const secretsSelected = selected.some((s) => s.name === 'secrets');

  // --- Rust engine path ----------------------------------------------------
  // A fresh adapter per audit so VEYLQORIX_ENGINE changes take effect without
  // any cross-call caching; the engine is authoritative for the secret scanner
  // and the gate when it is available.
  const adapter = new RustEngineAdapter();
  if (adapter.available && !secretsMocked) {
    const orchestratorFindings = scannerResults.flatMap((s) => s.findings);

    // Run the engine's secret scanner when it was selected, otherwise evaluate
    // the gate over the supplied evidence only (no engine scanners run).
    let engineResponse: EngineResponse;
    let engineScannerResults: ScannerResult[] = [];
    // The engine is spawned with the process cwd, so hand it an absolute root
    // to keep its filesystem scope unambiguous regardless of caller cwd.
    const engineRoot = resolvePath(root);
    if (secretsSelected) {
      engineResponse = await adapter.engineScan({
        root: engineRoot,
        detection,
        policy: policy.policy,
        stagedFiles: options.stagedFiles,
        checks,
        findings: orchestratorFindings,
        scannerResults,
        strict: options.strict ?? false,
        preferGitleaks: options.preferGitleaks ?? false,
        timeoutMs,
        scanId: options.scanId,
      });
      engineScannerResults = engineResponse.engineScannerResults ?? [];
    } else {
      engineResponse = await adapter.engineEvaluate({
        policy: policy.policy,
        findings: orchestratorFindings,
        scannerResults,
        checks,
        strict: options.strict ?? false,
        timeoutMs,
      });
    }

    const findings = engineResponse.findings ?? [];
    const gate = (engineResponse.gate ??
      ({
        result: 'INCOMPLETE',
        blockingReasons: [],
        reportedFindings: [],
        incompleteReasons: ['No gate was returned by the engine'],
        coverage: 'NONE',
        appliedExceptions: [],
      } as unknown)) as GateDecision;

    let finalScanners = [...scannerResults, ...engineScannerResults];
    // The engine's `exitCode` is always the default (soft) mapping; when
    // `strict` was requested it also returns `strictExitCode`. Mirror the
    // compatibility path exactly: strict -> exitCode=strict, softExitCode=soft.
    const softCode = engineResponse.exitCode ?? exitCodeFor(gate, gate.coverage);
    const strictCode = engineResponse.strictExitCode ?? strictExitCode(gate, gate.coverage);
    const useStrict = options.strict ?? false;

    const result: AuditResultWithExit = {
      root,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      detection,
      scanners: finalScanners,
      findings,
      checks,
      gate,
      coverage: gate.coverage,
      policy,
      exitCode: useStrict ? strictCode : softCode,
    };
    if (useStrict) result.softExitCode = softCode;
    return result;
  }

  // --- TypeScript compatibility path ---------------------------------------
  // Reached when the Rust engine is unavailable (binary missing / not
  // resolved) or when the caller requested deterministic secret mocks. The
  // TypeScript secret scanner and policy engine are byte-compatible with the
  // engine, and the degradation is recorded on the secret scanner result so
  // a full run is never impersonated.
  const engineUnavailable = !adapter.available;
  if (secretsSelected) {
    // The secrets scanner is registered whenever it is selected, so the
    // definition exists at this point.
    const def = selected.find((s) => s.name === 'secrets');
    if (def) {
      const secretsResult = await runScannerSafely(def, context);
      // Label the degraded run only when the TS scanner actually executed and
      // the engine (which would have been authoritative) was unavailable.
      if (engineUnavailable) {
        secretsResult.notes = [...secretsResult.notes, TS_COMPAT_NOTE];
      }
      scannerResults.push(secretsResult);
    }
  }

  const allFindings = scannerResults.flatMap((s) => s.findings);
  const gate = evaluateGate({
    findings: allFindings,
    checks,
    scanners: scannerResults,
    policy,
  });

  const exitCode = options.strict ? strictExitCode(gate, gate.coverage) : exitCodeFor(gate, gate.coverage);

  const result: AuditResultWithExit = {
    root,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    detection,
    scanners: scannerResults,
    findings: allFindings,
    checks,
    gate,
    coverage: gate.coverage,
    policy,
    exitCode,
  };
  if (options.strict) result.softExitCode = exitCodeFor(gate, gate.coverage);
  return result;
}

export { exitCodeFor, strictExitCode };
