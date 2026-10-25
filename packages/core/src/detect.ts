import fs from 'node:fs';
import path from 'node:path';
import type { Ecosystem, ProjectDetection } from './types.js';

const MANIFEST_FILES: Record<Ecosystem, string[]> = {
  node: ['package.json', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json', 'bun.lockb'],
  python: ['requirements.txt', 'pyproject.toml', 'Pipfile', 'poetry.lock', 'uv.lock', 'setup.py'],
  go: ['go.mod', 'go.sum'],
  rust: ['Cargo.toml', 'Cargo.lock'],
  java: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'gradle.lockfile'],
  ruby: ['Gemfile', 'Gemfile.lock', 'Rakefile'],
  php: ['composer.json', 'composer.lock'],
  dotnet: ['*.csproj', '*.sln'],
  unknown: [],
};

const EXTENSION_LANGUAGES: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.rb': 'ruby',
  '.php': 'php',
  '.cs': 'csharp',
  '.sh': 'shell',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.json': 'json',
  '.toml': 'toml',
};

/** Walk a directory tree, respecting ignore patterns. */
export function walk(root: string, options: { ignore?: string[]; maxDepth?: number; includeHidden?: boolean } = {}): string[] {
  const ignore = new Set(options.ignore ?? []);
  const maxDepth = options.maxDepth ?? 8;
  const results: string[] = [];
  let queue: [string, number][] = [[root, 0]];
  while (queue.length > 0) {
    const [current, depth] = queue.shift() as [string, number];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const name = entry.name;
      const relative = path.relative(root, path.join(current, name));
      const segments = relative.split(path.sep);
      // Respect .gitignore-like ignores at any ancestor level.
      if (ignore.has(segments[0] ?? '') || ignore.has(relative)) continue;
      if (name === 'node_modules' || name === '.git' || name === '__pycache__' || name === 'venv' || name === '.venv') continue;
      if (!options.includeHidden && name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        if (depth < maxDepth) queue.push([path.join(current, name), depth + 1]);
      } else if (entry.isFile()) {
        results.push(segments.join('/'));
      }
    }
  }
  return results;
}

/**
 * Detect the primary ecosystem of a project by looking for manifest and
 * lockfile files, starting from well-known locations before falling back to a
 * bounded walk of the tree.
 */
export function detectProject(root: string): ProjectDetection {
  const files = new Set<string>(walk(root, { maxDepth: 6, includeHidden: true }));
  const has = (name: string) =>
    files.has(name) || fs.existsSync(path.join(root, name));

  let ecosystem: Ecosystem = 'unknown';
  const reasons: string[] = [];
  let manifests: string[] = [];
  let lockfiles: string[] = [];
  let packageManager: string | undefined;

  const candidate = (name: string) => (files.has(name) || has(name)) ? name : undefined;

  const nodeManifest = candidate('package.json');
  if (nodeManifest) {
    manifests.push('package.json');
    if (candidate('pnpm-lock.yaml')) {
      lockfiles.push('pnpm-lock.yaml');
      packageManager = 'pnpm';
    } else if (candidate('yarn.lock')) {
      lockfiles.push('yarn.lock');
      packageManager = 'yarn';
    } else if (candidate('bun.lockb') || candidate('bun.lock')) {
      lockfiles.push(candidate('bun.lockb') ?? 'bun.lock');
      packageManager = 'bun';
    } else if (candidate('package-lock.json')) {
      lockfiles.push('package-lock.json');
      packageManager = 'npm';
    }
    ecosystem = 'node';
    reasons.push('Found package.json');
    if (!packageManager) {
      packageManager = 'npm';
      reasons.push('No lockfile detected; assuming npm');
    }
  }

  const pythonManifest = candidate('pyproject.toml') ?? candidate('requirements.txt') ?? candidate('Pipfile');
  if (pythonManifest && ecosystem === 'unknown') {
    manifests.push(pythonManifest);
    if (candidate('uv.lock')) {
      lockfiles.push('uv.lock');
      packageManager = 'uv';
    } else if (candidate('poetry.lock')) {
      lockfiles.push('poetry.lock');
      packageManager = 'poetry';
    } else if (candidate('Pipfile.lock')) {
      lockfiles.push('Pipfile.lock');
      packageManager = 'pipenv';
    }
    ecosystem = 'python';
    reasons.push(`Found ${pythonManifest}`);
    if (!packageManager) {
      packageManager = 'pip';
      reasons.push('No Python lockfile detected; assuming pip');
    }
  }

  for (const [eco, names] of Object.entries(MANIFEST_FILES) as [Ecosystem, string[]][]) {
    if (eco === 'node' || eco === 'python' || ecosystem !== 'unknown') continue;
    const hit = names.find((n) => !n.startsWith('*') && (files.has(n) || has(n)));
    if (hit) {
      ecosystem = eco;
      manifests.push(hit);
      reasons.push(`Found ${hit}`);
      break;
    }
  }

  const languages = new Set<string>();
  for (const file of files) {
    const extension = path.extname(file).toLowerCase();
    const language = EXTENSION_LANGUAGES[extension];
    if (language) languages.add(language);
  }

  let gitRepository = false;
  try {
    gitRepository = fs.existsSync(path.join(root, '.git'));
  } catch {
    /* .git may not be readable; treat as not a git repository. */
  }

  return {
    ecosystem,
    packageManager,
    manifests,
    lockfiles,
    gitRepository,
    languages: [...languages].sort(),
    reasons,
  };
}
