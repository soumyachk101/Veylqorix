/**
 * Git hook installer for Veylqorix.
 *
 * Writes `.git/hooks/pre-commit` (and optionally `pre-push`) as plain shell
 * scripts that invoke the Veylqorix CLI. Design rules:
 * - Never touches `git config` / `core.hooksPath`; only writes files under
 *   the repository's own `.git/hooks/`.
 * - Never overwrites an existing hook that Veylqorix did not install, unless
 *   explicitly forced; even then a `.veylqorix-backup` copy is kept.
 * - Never pushes code. Hooks are a local convenience, not a security
 *   boundary: GitHub-side enforcement is independent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isGitRepository, listStagedFiles } from './git.js';
import { execFileAsync } from './exec.js';

const HOOK_MARKER = '# VeylqORIX-HOOK:v1';

export interface HookInstallOptions {
  /** Absolute path to the CLI entrypoint (dist/index.js or an installed binary). */
  cliPath: string;
  /** Repository root (must be a git repository). */
  repoRoot: string;
  /** Also install the pre-push hook. */
  prePush?: boolean;
  /** Overwrite a non-Veylqorix hook (backs it up first). */
  force?: boolean;
  /** Extra flags appended to the scan command (e.g. `--offline`). */
  extraFlags?: string[];
}

function hookScript(kind: 'pre-commit' | 'pre-push', cliPath: string, extraFlags: string[]): string {
  const quotedCli = JSON.stringify(cliPath);
  const scanArgs = kind === 'pre-commit' ? ['scan', '--staged', ...extraFlags] : ['scan', '--no-tests', ...extraFlags];
  const argsQuoted = scanArgs.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ');
  return `#!/bin/sh
${HOOK_MARKER}
# Installed by 'veylqorix hooks install'. Local hooks are a convenience and
# NOT a security boundary: GitHub-side enforcement (veylqorix-gate + branch
# protection) is the authoritative gate.

# Emergency override (documented, audited in shell history):
#   VeylqORIX_OVERRIDE=1 <command>   -> the hook logs it and does not block.
if [ "$VEYLQORIX_OVERRIDE" = "1" ]; then
  echo "veylqorix: VeylqORIX_OVERRIDE=1 detected; skipping the ${kind} scan (emergency override)." >&2
  exit 0
fi

DIR=$(git rev-parse --show-toplevel) || exit 0
exec node ${quotedCli} ${argsQuoted} --root "$DIR"
exit $?
`;
}

function hookRoot(repoRoot: string): string | undefined {
  const gitDir = fs.existsSync(path.join(repoRoot, '.git')) ? path.join(repoRoot, '.git') : undefined;
  return gitDir;
}

export interface HookInstallResult {
  installed: string[];
  backedUp: string[];
  skipped: string[];
  errors: string[];
  manualInstructions: string[];
}

export async function installHooks(options: HookInstallOptions): Promise<HookInstallResult> {
  const result: HookInstallResult = { installed: [], backedUp: [], skipped: [], errors: [], manualInstructions: [] };
  if (!(await isGitRepository(options.repoRoot))) {
    result.errors.push(`${options.repoRoot} is not a Git repository; hooks require one.`);
    return result;
  }
  const gitDir = hookRoot(options.repoRoot);
  if (!gitDir) {
    result.errors.push('Cannot determine .git directory (worktree/submodule layouts are not supported by the installer).');
    return result;
  }
  const hooksDir = path.join(gitDir, 'hooks');
  const kinds: ('pre-commit' | 'pre-push')[] = options.prePush ? ['pre-commit', 'pre-push'] : ['pre-commit'];
  const existingHooks = new Set(fs.existsSync(hooksDir) ? fs.readdirSync(hooksDir) : []);

  for (const kind of kinds) {
    const target = path.join(hooksDir, kind);
    const script = hookScript(kind, options.cliPath, options.extraFlags ?? []);
    const existing = existingHooks.has(kind) ? fs.readFileSync(target, 'utf8') : undefined;
    if (existing !== undefined && !existing.includes(HOOK_MARKER) && !options.force) {
      result.skipped.push(
        `${kind} already exists and was not installed by Veylqorix; re-run with --force to back it up and replace it.`,
      );
      continue;
    }
    if (existing !== undefined && !existing.includes(HOOK_MARKER)) {
      fs.writeFileSync(`${target}.veylqorix-backup`, existing, 'utf8');
      result.backedUp.push(`${kind} (backup: ${target}.veylqorix-backup)`);
    }
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(target, script, { mode: 0o755 });
    result.installed.push(kind);
  }

  result.manualInstructions = [
    `1. cd into the repository and run: node ${options.cliPath} hooks install --yes${options.prePush ? ' --pre-push' : ''}`,
    '   (without --yes the installer prints the exact commands instead of writing files).',
    '2. Manual alternative: create .git/hooks/pre-commit with the script printed by the installer and `chmod +x` it.',
    '3. Test: `git add` a change, then run `git commit` and observe the Veylqorix gate.',
    '4. Emergency override: `VEYLQORIX_OVERRIDE=1 git commit` skips the hook once.',
    '5. Uninstall: `node ' + options.cliPath + ' hooks uninstall --yes` removes only Veylqorix-installed hooks.',
  ];
  return result;
}

export async function uninstallHooks(repoRoot: string, prePush?: boolean): Promise<HookInstallResult> {
  const result: HookInstallResult = { installed: [], backedUp: [], skipped: [], errors: [], manualInstructions: [] };
  const gitDir = hookRoot(repoRoot);
  if (!gitDir) {
    result.errors.push('Cannot determine .git directory; nothing was removed.');
    return result;
  }
  const kinds: string[] = prePush ? ['pre-commit', 'pre-push'] : ['pre-commit'];
  for (const kind of kinds) {
    const target = path.join(gitDir, 'hooks', kind);
    if (!fs.existsSync(target)) continue;
    const content = fs.readFileSync(target, 'utf8');
    if (content.includes(HOOK_MARKER)) {
      fs.rmSync(target);
      fs.rmSync(`${target}.veylqorix-backup`, { force: true });
      result.installed.push(`removed ${kind}`);
    } else {
      result.skipped.push(`${kind} is not a Veylqorix hook; left untouched.`);
    }
  }
  return result;
}

/** Run the staged scan that a pre-commit hook performs. */
export async function runStagedScan(repoRoot: string, cliPath: string): Promise<number> {
  const staged = await listStagedFiles(repoRoot);
  if (staged.length === 0) return 0;
  const args = [cliPath, 'scan', '--staged', '--no-tests', '--root', repoRoot, '--scanners', 'secrets'];
  const result = await execFileAsync('node', args, { cwd: repoRoot, timeoutMs: 120_000 });
  return result.code ?? 1;
}
