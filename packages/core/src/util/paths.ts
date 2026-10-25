/**
 * Filesystem path safety for the MCP server and any other surface that
 * accepts a caller-supplied path.
 *
 * Guarantees:
 * - The resolved path stays inside one of the configured workspace roots.
 * - Symlinks that point outside the roots are rejected, not followed.
 * - `..` traversal is rejected before any filesystem access.
 * - Paths that are not absolute are resolved against the root.
 */
import fs from 'node:fs';
import path from 'node:path';

export class PathValidationError extends Error {
  constructor(
    message: string,
    public readonly code: 'PATH_TRAVERSAL' | 'OUTSIDE_ROOT' | 'NOT_FOUND' | 'INVALID',
  ) {
    super(message);
    this.name = 'PathValidationError';
  }
}

export interface WorkspaceRoots {
  /** Absolute, canonicalized roots that callers may access. */
  roots: string[];
}

function canonicalize(target: string): string {
  // realpathSync resolves symlinks; fall back to the resolved lexical path when
  // the target does not exist yet.
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

/**
 * Validate a caller-supplied path against the allowed workspace roots.
 *
 * @param requestedPath the path to validate
 * @param roots absolute workspace roots
 * @param options.allowMissing when true, the path need not exist (used for
 *        output paths such as report files)
 */
export function validatePath(
  requestedPath: string,
  roots: string[],
  options: { allowMissing?: boolean } = {},
): string {
  if (typeof requestedPath !== 'string' || requestedPath.trim() === '') {
    throw new PathValidationError('Path must be a non-empty string.', 'INVALID');
  }
  if (requestedPath.includes('\u0000')) {
    throw new PathValidationError('Path contains a null byte.', 'INVALID');
  }

  const canonicalRoots = roots.map((r) => canonicalize(path.resolve(r)));
  if (canonicalRoots.length === 0) {
    throw new PathValidationError('No workspace roots are configured.', 'OUTSIDE_ROOT');
  }

  // Determine the base root: an absolute path must live under one of the
  // roots; a relative path is resolved against the first root.
  const isAbsolute = path.isAbsolute(requestedPath);
  const candidate = isAbsolute
    ? path.resolve(requestedPath)
    : path.resolve(canonicalRoots[0] as string, requestedPath);

  // Lexical containment check first: this catches `..` traversal cheaply.
  const lexicallyInside = canonicalRoots.some(
    (root) => candidate === root || candidate.startsWith(root + path.sep),
  );
  if (!lexicallyInside) {
    throw new PathValidationError(
      `Path resolves outside the configured workspace roots: ${requestedPath}`,
      isAbsolute ? 'OUTSIDE_ROOT' : 'PATH_TRAVERSAL',
    );
  }

  // Then resolve symlinks and re-check, so a symlink inside the root that
  // points outside it is rejected.
  const real = canonicalize(candidate);
  const reallyInside = canonicalRoots.some(
    (root) => real === root || real.startsWith(root + path.sep),
  );
  if (!reallyInside) {
    throw new PathValidationError(
      `Path resolves outside the configured workspace roots via a symlink: ${requestedPath}`,
      'OUTSIDE_ROOT',
    );
  }

  if (!options.allowMissing) {
    if (!fs.existsSync(real)) {
      throw new PathValidationError(`Path does not exist: ${requestedPath}`, 'NOT_FOUND');
    }
  }

  return real;
}

/**
 * Resolve a path and return it relative to the root it belongs to, using POSIX
 * separators. Used so that reports never leak absolute filesystem paths.
 */
export function relativeToRoot(target: string, roots: string[]): string {
  const canonicalRoots = roots.map((r) => canonicalize(path.resolve(r)));
  const real = canonicalize(target);
  for (const root of canonicalRoots) {
    if (real === root) return '.';
    if (real.startsWith(root + path.sep)) {
      return path.relative(root, real).split(path.sep).join('/');
    }
  }
  return path.basename(real);
}
