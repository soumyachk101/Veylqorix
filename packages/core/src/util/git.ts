/**
 * Minimal, dependency-free Git helpers for Veylqorix.
 *
 * These are read-only queries. Veylqorix never mutates Git state: it reads
 * the index to scope scans to staged changes, and nothing more.
 */
import { execFileAsync } from './exec.js';

/**
 * List files currently staged in the Git index, relative to the repo root,
 * using POSIX separators. Returns an empty list (not an error) when the
 * directory is not a Git repository or nothing is staged.
 */
export async function listStagedFiles(root: string): Promise<string[]> {
  try {
    const result = await execFileAsync('git', ['diff', '--name-only', '--cached', '--'], {
      cwd: root,
      timeoutMs: 30_000,
    });
    if (result.code !== 0) return [];
    return result.stdout
      .split('\n')
      .map((line) => line.trim().replace(/\\/g, '/'))
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

/** True when `root` is inside a Git repository. */
export async function isGitRepository(root: string): Promise<boolean> {
  try {
    const result = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: root,
      timeoutMs: 15_000,
    });
    return result.code === 0 && result.stdout.trim() === 'true';
  } catch {
    return false;
  }
}
