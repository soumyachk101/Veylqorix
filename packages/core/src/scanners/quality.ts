import fs from 'node:fs';
import path from 'node:path';
import { execFileAsync, ExecError } from '../util/exec.js';
import type { CheckResult, ProjectDetection } from '../types.js';

export interface QualityCheckOptions {
  /** Working directory for checks. */
  root: string;
  timeoutMs?: number;
  maxOutputKb?: number;
  /** When set, run exactly these check ids only; otherwise auto-detect. */
  only?: string[];
  /** When false, do not run tests or builds (only linters). */
  includeTests?: boolean;
}

function fileExists(root: string, name: string): boolean {
  return fs.existsSync(path.join(root, name));
}

/**
 * Determine which quality checks apply to a project, reading its config files
 * before choosing commands. A missing config means the check is SKIPPED with a
 * reason, not PASS.
 */
export function detectChecks(detection: ProjectDetection, options: QualityCheckOptions): CheckResult[] {
  const root = options.root;
  const results: CheckResult[] = [];
  const includeTests = options.includeTests !== false;

  const add = (result: Omit<CheckResult, 'durationMs'>) => {
    results.push({ ...result, durationMs: 0 });
  };

  // TypeScript compilation
  if (fileExists(root, 'tsconfig.json')) {
    add({
      id: 'typescript',
      command: 'npx tsc --noEmit',
      status: 'SKIPPED',
      reason: 'Config detected but not yet run; the quality runner fills in the actual result.',
    });
  } else if (detection.languages.includes('typescript')) {
    add({
      id: 'typescript',
      command: 'npx tsc --noEmit',
      status: 'SKIPPED',
      reason: 'TypeScript files present but no tsconfig.json found; add a tsconfig.json to enable type checking.',
    });
  }

  // ESLint
  const hasEslint =
    fileExists(root, 'eslint.config.js') ||
    fileExists(root, 'eslint.config.mjs') ||
    fileExists(root, 'eslint.config.ts') ||
    fileExists(root, '.eslintrc.json') ||
    fileExists(root, '.eslintrc.js');
  if (hasEslint) {
    add({
      id: 'eslint',
      command: 'npx eslint .',
      status: 'SKIPPED',
      reason: 'ESLint config detected; the quality runner fills in the actual result.',
    });
  }

  // Python lint
  if (fileExists(root, 'ruff.toml') || fileExists(root, '.ruff.toml') || fileExists(root, 'pyproject.toml')) {
    add({
      id: 'ruff',
      command: 'python3 -m ruff check .',
      status: 'SKIPPED',
      reason: 'Python project detected; ruff will run if available, otherwise this check is skipped.',
    });
  }

  // Tests
  if (includeTests) {
    if (fileExists(root, 'package.json')) {
      let script: string | undefined;
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        script = pkg?.scripts?.test;
      } catch {
        /* ignore */
      }
      if (script) {
        add({
          id: 'tests',
          command: 'pnpm test',
          status: 'SKIPPED',
          reason: 'A test script is declared; the quality runner fills in the actual result.',
        });
      } else if (fileExists(root, 'vitest.config.ts') || fileExists(root, 'vitest.config.js') || fileExists(root, 'jest.config.js')) {
        add({
          id: 'tests',
          command: 'npx vitest run',
          status: 'SKIPPED',
          reason: 'Test runner config detected; the quality runner fills in the actual result.',
        });
      }
    }
    if (fileExists(root, 'pytest.ini') || fileExists(root, 'tox.ini') || fs.existsSync(path.join(root, 'tests'))) {
      add({
        id: 'pytest',
        command: 'python3 -m pytest',
        status: 'SKIPPED',
        reason: 'Python test layout detected; the quality runner fills in the actual result.',
      });
    }
  }

  return results;
}

/**
 * Execute a quality check by mapping its id to the appropriate command.
 * Commands are chosen based on detected configuration, not assumptions about
 * the project. Each invocation runs with a timeout and is classified as
 * PASS, FAIL, or ERROR — never SKIPPED once it has actually run.
 */
export async function runCheck(check: CheckResult, options: QualityCheckOptions): Promise<CheckResult> {
  const { root, timeoutMs = 300_000, maxOutputKb = 128 } = options;
  const startedAt = Date.now();

  let commandArgs: [string, string[]] | undefined;
  if (check.id === 'typescript') {
    commandArgs = ['npx', ['--no-install', 'tsc', '--noEmit']];
  } else if (check.id === 'eslint') {
    commandArgs = ['npx', ['--no-install', 'eslint', '.', '--max-warnings', '0']];
  } else if (check.id === 'ruff') {
    commandArgs = ['python3', ['-m', 'ruff', 'check', '.']];
  } else if (check.id === 'tests') {
    commandArgs = ['pnpm', ['test']];
  } else if (check.id === 'pytest') {
    commandArgs = ['python3', ['-m', 'pytest', '-q']];
  }

  if (!commandArgs) {
    return { ...check, status: 'SKIPPED', reason: 'No executable command was configured for this check.', durationMs: Date.now() - startedAt };
  }

  const [file, args] = commandArgs;
  try {
    const result = await execFileAsync(file, args, {
      cwd: root,
      timeoutMs,
      maxOutputKb,
    });
    const durationMs = Date.now() - startedAt;
    if (result.timedOut) {
      return {
        ...check,
        status: 'ERROR',
        error: { message: `${file} timed out after ${timeoutMs / 1000}s`, code: 'ETIMEDOUT' },
        durationMs,
      };
    }
    const code = result.code ?? 1;
    return {
      ...check,
      status: code === 0 ? 'PASS' : 'FAIL',
      output: (result.stdout + (code === 0 ? '' : result.stderr)).trim().slice(0, 8_000) || undefined,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const execError = error instanceof ExecError ? error : undefined;
    const missingBinary = execError?.code === 'ENOENT';
    return {
      ...check,
      status: 'ERROR',
      error: {
        message: missingBinary
          ? `${file} is not installed; install it to run this check.`
          : execError?.message ?? (error as Error).message,
        code: execError?.code,
        missingDependency: missingBinary,
      },
      durationMs,
    };
  }
}
