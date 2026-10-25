import { detectProject } from './detect.js';
import { exitCodeFor } from './gate/index.js';
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
  type ScannerDefinition,
  type ScannerContext,
} from './scanners/registry.js';
import type {
  AuditResult,
  CheckResult,
  Finding,
  Policy,
  ScannerResult,
} from './types.js';

export interface AuditOptions {
  /** Root directory of the project to audit. */
  root: string;
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
}

export interface AuditResultWithExit extends AuditResult {
  exitCode: number;
}

/**
 * Run the full audit: detect the project type, execute all configured scanners
 * with per-scanner timeouts, run the applicable quality checks, normalize
 * findings, evaluate the quality gate, and return a complete result.
 */
export async function runAudit(options: AuditOptions): Promise<AuditResultWithExit> {
  const startedAt = new Date();
  const root = options.root;
  const timeoutMs = options.scannerTimeoutMs ?? 120_000;

  const detection = detectProject(root);
  const policy = resolvePolicy(options.policy);

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

  scanners.push({
    name: 'secrets',
    mandatory: true,
    run: async (ctx) => scanSecrets(ctx.root, { mockFindings: ctx.mocks?.['secrets'] }),
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

  const scannerResults: ScannerResult[] = [];
  for (const scanner of selected) {
    scannerResults.push(await runScannerSafely(scanner, context));
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

  const allFindings = scannerResults.flatMap((s) => s.findings);
  const gate = evaluateGate({
    findings: allFindings,
    checks,
    scanners: scannerResults,
    policy,
  });

  const exitCode = exitCodeFor(gate, gate.coverage);

  return {
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
}

export { exitCodeFor };
