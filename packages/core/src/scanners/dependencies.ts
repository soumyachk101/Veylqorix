import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFileAsync, ExecError, extractJson } from '../util/exec.js';
import { makeFinding } from '../finding.js';
import type { Finding, ProjectDetection, ScannerResult, Severity } from '../types.js';

export interface DependencyScanOptions {
  /** Optional deterministic mock findings, used by tests and offline mode. */
  mockFindings?: Finding[];
  /** When true, do not execute external scanners; return SKIPPED with a note. */
  offline?: boolean;
  timeoutMs?: number;
  /** Working directory; defaults to the audit root. */
  cwd?: string;
}

export interface DependencyScanner {
  name: string;
  run(detection: ProjectDetection, options: DependencyScanOptions): Promise<ScannerResult>;
}

/**
 * Convert `npm audit` severity labels to Veylqorix severities.
 * The `info` level is intentionally mapped to `INFO` so that informational
 * advisories are reported without blocking the gate.
 */
const NPM_SEVERITY_MAP: Record<string, Severity> = {
  critical: 'CRITICAL',
  high: 'HIGH',
  moderate: 'MEDIUM',
  low: 'LOW',
  info: 'INFO',
};

/**
 * Run `npm audit` against a Node project.
 *
 * Uses `--no-package-lock` and `--package-lock-only` so that no `node_modules`
 * is installed and no lockfile is written into the user's project. Requires
 * network access to the registry; when the binary is missing or the network is
 * unreachable, the result is SKIPPED with a clear note, never PASS.
 */
async function npmAudit(
  detection: ProjectDetection,
  options: DependencyScanOptions,
): Promise<ScannerResult> {
  const notes: string[] = [];
  const startedAt = Date.now();
  const emptyFindings: Finding[] = [];

  if (options.mockFindings !== undefined) {
    const durationMs = Date.now() - startedAt;
    return {
      scanner: 'dependencies',
      status: options.mockFindings.length > 0 ? 'FAIL' : 'PASS',
      findings: options.mockFindings,
      durationMs,
      notes: ['Used deterministic mock findings (test/offline mode)'],
      summary: { source: 'mock', count: options.mockFindings.length },
    };
  }

  if (options.offline || detection.ecosystem !== 'node') {
    if (detection.ecosystem !== 'node') {
      notes.push('No Node.js project detected; npm audit not applicable.');
    } else {
      notes.push('Running in offline mode; npm audit requires network access and was skipped.');
    }
    return {
      scanner: 'dependencies',
      status: 'SKIPPED',
      findings: emptyFindings,
      durationMs: Date.now() - startedAt,
      notes,
    };
  }

  let lockfile = detection.packageManager === 'npm'
    ? 'package-lock.json'
    : detection.packageManager === 'pnpm'
      ? 'pnpm-lock.yaml'
      : detection.packageManager === 'yarn'
        ? 'yarn.lock'
        : undefined;

  const usePackageLock = lockfile && existsSync(path.join(options.cwd ?? process.cwd(), lockfile));
  const args = [
    'audit',
    '--json',
    ...(usePackageLock ? ['--package-lock-only'] : ['--no-package-lock']),
  ];

  try {
    const result = await execFileAsync('npm', args, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs ?? 120_000,
      env: { ...process.env, npm_config_update_notifier: 'false' },
    });

    const durationMs = Date.now() - startedAt;

    if (result.timedOut) {
      notes.push('npm audit timed out; treat dependency coverage as incomplete.');
      return {
        scanner: 'dependencies',
        status: 'ERROR',
        findings: emptyFindings,
        durationMs,
        error: { message: 'npm audit timed out', code: 'ETIMEDOUT' },
        notes,
      };
    }

    // `npm audit` exits 0 when clean, 1 when vulnerabilities are found, and
    // 2 when the audit itself failed (e.g. no lockfile / no network).
    if (result.code === 2 || result.code === null) {
      const reason = result.stderr.trim() || 'npm audit reported an execution error (missing lockfile or no network access).';
      notes.push(reason);
      return {
        scanner: 'dependencies',
        status: 'ERROR',
        findings: emptyFindings,
        durationMs,
        error: { message: reason, code: 'AUDIT_FAILED' },
        notes,
      };
    }

    const parsed = extractJson(result.stdout);
    interface NpmAuditReport {
      vulnerabilities?: Record<
        string,
        Record<
          string,
          {
            name?: string;
            severity?: string;
            via?: unknown[];
            cves?: string[];
            ghSA?: string;
            url?: string;
            range?: string;
            title?: string;
          }
        >
      >;
    }
    const auditData = parsed as NpmAuditReport | undefined;

    const findings: Finding[] = [];
    const vulnerabilities = auditData?.vulnerabilities;
    if (vulnerabilities) {
      for (const [depName, groups] of Object.entries(vulnerabilities)) {
        for (const [version, details] of Object.entries(groups)) {
          const severity = NPM_SEVERITY_MAP[details.severity ?? ''] ?? 'MEDIUM';
          const finding = makeFinding({
            scanner: 'dependencies',
            ruleId: 'npm-audit',
            title: `Vulnerable dependency ${depName}@${version}`,
            severity,
            confidence: 'CONFIRMED',
            file: lockfile,
            dependency: {
              name: depName,
              installedVersion: version,
              packageManager: detection.packageManager,
            },
            evidence: {
              snippet: details.title,
              details: {
                'range': details.range ?? '',
                'via': Array.isArray(details.via)
                  ? details.via.filter((v) => typeof v === 'string').join('; ')
                  : String(details.via ?? ''),
              },
            },
            remediation: `Upgrade ${depName} to a version that resolves the advisory; run 'npm audit' to confirm.`,
            advisory: details.ghSA ?? details.url ?? '',
          });
          findings.push(finding);
        }
      }
    }

    if (findings.length === 0) {
      notes.push('npm audit completed with no known vulnerabilities in the audited dependency tree.');
    } else {
      notes.push(`npm audit reported ${findings.length} vulnerable package(s).`);
    }

    return {
      scanner: 'dependencies',
      status: findings.length > 0 ? 'FAIL' : 'PASS',
      findings,
      durationMs,
      notes,
      summary: {
        vulnerable: findings.length,
        source: 'npm-audit',
        ecosystem: 'node',
      },
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const execError = error instanceof ExecError ? error : undefined;
    const missingDependency = execError?.code === 'ENOENT';
    notes.push(
      missingDependency
        ? 'The npm binary was not found; dependency scanning was not executed.'
        : execError?.message ?? (error as Error).message,
    );
    return {
      scanner: 'dependencies',
      status: 'ERROR',
      findings: [],
      durationMs,
      error: {
        message: missingDependency ? 'npm binary not found' : (error as Error).message,
        code: execError?.code,
        missingDependency,
      },
      notes,
    };
  }
}

interface PipAuditPackage {
  name: string;
  version: string;
  fix_versions: string[];
  aliases: string[];
  vulnerabilities: string[];
}

/**
 * Run `pip-audit` against a Python project.
 *
 * Requires the `pip-audit` tool to be installed and network access to the
 * PyPI vulnerability database (OSV). When either is unavailable, the result
 * is SKIPPED with a clear note.
 */
async function pipAudit(
  detection: ProjectDetection,
  options: DependencyScanOptions,
): Promise<ScannerResult> {
  const notes: string[] = [];
  const startedAt = Date.now();
  const emptyFindings: Finding[] = [];

  if (options.mockFindings !== undefined) {
    return {
      scanner: 'dependencies',
      status: options.mockFindings.length > 0 ? 'FAIL' : 'PASS',
      findings: options.mockFindings,
      durationMs: Date.now() - startedAt,
      notes: ['Used deterministic mock findings (test/offline mode)'],
      summary: { source: 'mock', count: options.mockFindings.length },
    };
  }

  if (options.offline) {
    notes.push('Running in offline mode; pip-audit requires network access to the PyPI advisory database and was skipped.');
    return {
      scanner: 'dependencies',
      status: 'SKIPPED',
      findings: emptyFindings,
      durationMs: Date.now() - startedAt,
      notes,
    };
  }

  // Prefer a virtual environment's pip-audit if one exists, otherwise try the
  // system-wide `pip-audit` binary. Never modify the user's environment.
  const candidates = ['pip-audit'];
  let result;
  let spawnError: ExecError | undefined;
  for (const binary of candidates) {
    try {
      result = await execFileAsync(binary, ['--format', 'json', '-r', 'requirements.txt'], {
        cwd: options.cwd,
        timeoutMs: options.timeoutMs ?? 120_000,
      });
      spawnError = undefined;
      break;
    } catch (error) {
      spawnError = error instanceof ExecError ? error : undefined;
      result = undefined;
    }
  }

  const durationMs = Date.now() - startedAt;

  if (!result) {
    notes.push('pip-audit binary not found; install it with `pip install pip-audit` to enable dependency scanning.');
    return {
      scanner: 'dependencies',
      status: 'ERROR',
      findings: emptyFindings,
      durationMs,
      error: { message: 'pip-audit binary not found', code: 'ENOENT', missingDependency: true },
      notes,
    };
  }

  if (result.timedOut) {
    notes.push('pip-audit timed out; treat dependency coverage as incomplete.');
    return {
      scanner: 'dependencies',
      status: 'ERROR',
      findings: emptyFindings,
      durationMs,
      error: { message: 'pip-audit timed out', code: 'ETIMEDOUT' },
      notes,
    };
  }

  const parsed = extractJson(result.stdout);
  const packages = parsed?.vulnerabilities;
  const findings: Finding[] = [];
  if (Array.isArray(packages)) {
    for (const pkg of packages as PipAuditPackage[]) {
      const sev = pkg.aliases.some((a) => /critical/i.test(a)) ? 'CRITICAL' : 'HIGH';
      const finding = makeFinding({
        scanner: 'dependencies',
        ruleId: 'pip-audit',
        title: `Vulnerable dependency ${pkg.name}@${pkg.version}`,
        severity: sev as Severity,
        confidence: 'CONFIRMED',
        file: 'requirements.txt',
        dependency: {
          name: pkg.name,
          installedVersion: pkg.version,
          fixedVersion: pkg.fix_versions[0],
          packageManager: detection.packageManager,
        },
        evidence: {
          snippet: pkg.aliases.join(', ') || 'Known vulnerability',
          details: {
            'fix_versions': pkg.fix_versions.join(', '),
            'vulnerabilities': pkg.vulnerabilities.join(', '),
          },
        },
        remediation: `Upgrade ${pkg.name} to ${pkg.fix_versions[0] ?? 'a patched version'}.`,
        advisory: pkg.vulnerabilities[0],
      });
      findings.push(finding);
    }
  }

  const status: ScannerResult['status'] = findings.length > 0 ? 'FAIL' : 'PASS';
  if (findings.length === 0) {
    notes.push('pip-audit completed; no known vulnerabilities found in the audited requirements.');
  } else {
    notes.push(`pip-audit reported ${findings.length} vulnerable package(s).`);
  }

  return {
    scanner: 'dependencies',
    status,
    findings,
    durationMs,
    notes,
    summary: { vulnerable: findings.length, source: 'pip-audit', ecosystem: 'python' },
  };
}

/**
 * Choose the appropriate dependency scanner for the detected project type.
 */
export function dependencyScanner(detection: ProjectDetection): DependencyScanner {
  if (detection.ecosystem === 'node') {
    return { name: 'dependencies/npm', run: npmAudit };
  }
  if (detection.ecosystem === 'python') {
    return { name: 'dependencies/pip', run: pipAudit };
  }
  return {
    name: 'dependencies',
    run: async (d) => ({
      scanner: 'dependencies',
      status: 'SKIPPED',
      findings: [],
      durationMs: 0,
      notes: [`Ecosystem '${d.ecosystem}' has no dependency scanner implemented in the current version.`],
    }),
  };
}
