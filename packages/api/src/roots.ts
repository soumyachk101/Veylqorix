/**
 * Root confinement for the Veylqorix API.
 *
 * A candidate path may only be registered or scanned when its *resolved*
 * identity (after following every symlink, `..`, and trailing-slash
 * normalization) is one of the configured roots, or inside one. Checking the
 * raw string is not enough: a sibling prefix (`/root-x` against root `/root`)
 * and a symlink that points outside the tree both pass a naive
 * `startsWith` check. So the containment test compares real, canonical paths
 * segment by segment, never by string prefix.
 *
 * This module fails closed: a root that cannot be verified at startup or a
 * candidate whose identity cannot be established is rejected, and no
 * error message here reports what exists outside the tree.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface RootConfinement {
  /**
   * Accept a candidate path into a root. Returns the canonical path to
   * persist, or undefined when the path must be rejected. Never throws.
   */
  confine(candidate: string): string | undefined;
  /** Canonical roots, for logging. Empty means no confinement is active. */
  readonly roots: string[];
}

/** Canonical roots at startup. Throws (with a safe message) when any root is invalid. */
export function initializeRoots(configured: string[]): RootConfinement {
  const roots = configured.map((raw, i) => {
    const abs = path.resolve(raw);
    let real: string;
    try {
      real = fs.realpathSync(abs);
    } catch {
      throw new Error(`allowed root #${i + 1} does not exist or is not accessible; refusing to start. Verify VEYLQORIX_ALLOWED_ROOTS points at existing directories.`);
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(real);
    } catch {
      throw new Error(`allowed root #${i + 1} cannot be inspected; refusing to start. Verify VEYLQORIX_ALLOWED_ROOTS points at existing directories.`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`allowed root #${i + 1} is not a directory; refusing to start. Verify VEYLQORIX_ALLOWED_ROOTS.`);
    }
    return real;
  });
  return createConfinement(roots);
}

export function createConfinement(roots: string[]): RootConfinement {
  const active = roots.length > 0;

  function confine(candidate: string): string | undefined {
    // Absolutize against process.cwd() so relative values (a CLI habit) are
    // handled identically to absolute ones.
    let real: string;
    try {
      real = fs.realpathSync(path.resolve(candidate));
    } catch {
      return undefined; // missing or inaccessible: reject, report nothing
    }
    if (!active) return real;

    for (const root of roots) {
      if (real === root) return real;
      const rel = path.relative(root, real);
      if (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        // Segment check: every path element is strictly inside the root.
        // `..`, absolute, and empty are the only escapes.
        return real;
      }
    }
    return undefined;
  }

  return { confine, roots };
}
