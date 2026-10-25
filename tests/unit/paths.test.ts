import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validatePath, PathValidationError, relativeToRoot } from '@veylqorix/core';

const tmpRaw = fs.mkdtempSync(path.join(os.tmpdir(), 'veylqorix-paths-'));
// macOS tmpdir is /var (a symlink to /private/var); validatePath canonicalizes
// roots, so we must hand it a canonical path too.
const tmp = fs.realpathSync(tmpRaw);
const inner = path.join(tmp, 'nested');
fs.mkdirSync(inner);
fs.writeFileSync(path.join(inner, 'file.txt'), 'data');

describe('validatePath', () => {
  it('accepts paths inside a configured root', () => {
    const real = validatePath('nested/file.txt', [tmp]);
    expect(fs.readFileSync(real, 'utf8')).toBe('data');
  });

  it('rejects .. traversal that escapes the root', () => {
    expect(() => validatePath('../../etc/passwd', [tmp])).toThrow(PathValidationError);
  });

  it('rejects absolute paths outside all roots', () => {
    expect(() => validatePath('/etc/hosts', [tmp])).toThrow(PathValidationError);
  });

  it('rejects null bytes', () => {
    expect(() => validatePath('foo\x00bar', [tmp])).toThrow(PathValidationError);
  });

  it('rejects an empty root list', () => {
    expect(() => validatePath('nested/file.txt', [])).toThrow(PathValidationError);
  });

  it('allows missing paths only when allowMissing is set', () => {
    expect(() => validatePath('does-not-exist.txt', [tmp])).toThrow();
    const p = validatePath('new-report.json', [tmp], { allowMissing: true });
    expect(p).toBe(path.resolve(tmp, 'new-report.json'));
  });

  it('rejects a symlink that points outside the root', () => {
    const linkPath = path.join(inner, 'escape');
    try {
      fs.symlinkSync('/etc', linkPath);
    } catch {
      return; // environments without symlink permission
    }
    expect(() => validatePath('nested/escape/hosts', [tmp])).toThrow(PathValidationError);
  });
});

describe('relativeToRoot', () => {
  it('returns POSIX paths relative to the owning root', () => {
    const rel = relativeToRoot(path.join(inner, 'file.txt'), [tmp]);
    expect(rel).toBe(path.join('nested', 'file.txt').split(path.sep).join('/'));
  });

  it('returns the basename for paths outside all roots', () => {
    const rel = relativeToRoot('/some/other/place.txt', [tmp]);
    expect(rel).toBe('place.txt');
  });
});
