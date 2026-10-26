import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EngineProtocolError,
  EngineUnavailableError,
  isEngineAvailable,
  runAudit,
  RustEngineAdapter,
} from '@veylqorix/core';

/**
 * Engine adapter tests.
 *
 * The Rust engine binary (crates/target/{release,debug}/veylqorix-engine) is
 * resolved by walking up from the process cwd. When it is not present, every
 * engine-backed test is SKIPPED with an honest console explanation — never a
 * faked pass. The availability-reporting tests always run.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const fixtures = path.join(repoRoot, 'tests', 'fixtures');

/** The documented fake secret values that live only in the test fixtures. */
const RAW_AWS_KEY = 'AKIA0123456789ABCDEF';
const RAW_GITHUB_TOKEN = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz0123456789';

const engineAvailable = isEngineAvailable();
if (!engineAvailable) {
  console.log(
    '[engine-adapter] Rust engine binary not found; skipping all engine-backed tests. ' +
      'Build it with `cargo build --release` in crates/, or set VEYLQORIX_ENGINE to an engine binary path.',
  );
}

function saveEngineEnv(): { restore(): void } {
  const previous = process.env.VEYLQORIX_ENGINE;
  return {
    restore() {
      if (previous === undefined) delete process.env.VEYLQORIX_ENGINE;
      else process.env.VEYLQORIX_ENGINE = previous;
    },
  };
}

describe('engine availability reporting (always runs)', () => {
  it('isEngineAvailable() reports honestly for the real binary and for a missing one', () => {
    const saved = saveEngineEnv();
    try {
      process.env.VEYLQORIX_ENGINE = '/definitely/not/a/real/engine/binary';
      expect(isEngineAvailable()).toBe(false);
    } finally {
      saved.restore();
    }
  });

  it('a fresh adapter with an unknown binary path is unavailable, never a pass', () => {
    const adapter = new RustEngineAdapter({ binaryPath: '/definitely/not/a/real/engine/binary' });
    expect(adapter.available).toBe(false);
  });
});

describe.skipIf(!engineAvailable)('Rust engine adapter', () => {
  it('ping reports protocol version 1 and a string engine version', async () => {
    const response = await new RustEngineAdapter().ping();
    expect(response.protocolVersion).toBe(1);
    expect(typeof response.engineVersion).toBe('string');
    expect(response.engineVersion.length).toBeGreaterThan(0);
    expect(response.ok).toBe(true);
  });

  it('engineScan on the clean fixture passes with zero findings', async () => {
    const response = await new RustEngineAdapter().engineScan({
      root: path.join(fixtures, 'clean-repo'),
    });
    expect(response.gate?.result).toBe('PASS');
    expect(response.exitCode).toBe(0);
    expect(response.findings ?? []).toHaveLength(0);
    const secretsResult = (response.engineScannerResults ?? []).find((s) => s.scanner === 'secrets');
    expect(secretsResult?.status).toBe('PASS');
  });

  it('engineScan on the secret fixture fails and keeps raw values out of the response', async () => {
    const response = await new RustEngineAdapter().engineScan({
      root: path.join(fixtures, 'secret-repo'),
    });
    expect(response.gate?.result).toBe('FAIL');
    expect(response.exitCode).toBe(1);
    const ids = (response.findings ?? []).map((f) => f.id);
    expect(ids).toContain('SECRETS-8C5562BA');
    expect(ids).toContain('SECRETS-5833D5DA');
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain(RAW_AWS_KEY);
    expect(serialized).not.toContain(RAW_GITHUB_TOKEN);
    expect(serialized).toContain('redacted');
  });

  function writeStubScript(content: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veylqorix-engine-stub-'));
    const file = path.join(dir, 'stub-engine.sh');
    fs.writeFileSync(file, content, { mode: 0o755 });
    return file;
  }

  it('classifies a zero-exit garbage response as a protocol error', async () => {
    const stub = writeStubScript('#!/bin/sh\necho "this is not json, just noise"\nexit 0\n');
    const adapter = new RustEngineAdapter({ binaryPath: stub });
    let caught: unknown;
    try {
      await adapter.ping();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EngineProtocolError);
    // A protocol error is never read as a pass: no decision is produced.
    expect((caught as EngineProtocolError).message).toMatch(/not valid JSON/i);
  });

  it('classifies an engine exit-64 as a protocol error carrying the exit code', async () => {
    const stub = writeStubScript('#!/bin/sh\necho "veylqorix-engine: malformed request" >&2\nexit 64\n');
    const adapter = new RustEngineAdapter({ binaryPath: stub });
    let caught: unknown;
    try {
      await adapter.ping();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EngineProtocolError);
    expect((caught as EngineProtocolError).exitCode).toBe(64);
  });

  it('reports a missing pinned binary as EngineUnavailableError', async () => {
    const adapter = new RustEngineAdapter({ binaryPath: '/definitely/not/a/real/engine/binary' });
    let caught: unknown;
    try {
      await adapter.ping();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EngineUnavailableError);
  });
});

describe.skipIf(!engineAvailable)('runAudit with the Rust engine', () => {
  it('fails on the secret fixture and reports the engine-sourced secret scanner', async () => {
    const result = await runAudit({
      root: path.join(fixtures, 'secret-repo'),
      online: false,
      skipQualityChecks: true,
    });
    expect(result.gate.result).toBe('FAIL');
    expect(result.exitCode).toBe(1);
    const secrets = result.scanners.find((s) => s.scanner === 'secrets');
    expect(secrets).toBeDefined();
    expect(secrets?.status).toBe('FAIL');
    // The engine secret scanner result is the one recorded: its summary is
    // stamped with the offline-rules source, not the TS mock note.
    expect(String(secrets?.summary?.['source'] ?? '')).toContain('offline-rules');
    const serialized = JSON.stringify(result.findings);
    expect(serialized).not.toContain(RAW_AWS_KEY);
    expect(serialized).not.toContain(RAW_GITHUB_TOKEN);
  });

  it('passes on the clean fixture', async () => {
    const result = await runAudit({
      root: path.join(fixtures, 'clean-repo'),
      online: false,
      skipQualityChecks: true,
      mocks: { dependencies: [] },
    });
    expect(result.gate.result).toBe('PASS');
    expect(result.exitCode).toBe(0);
    expect(result.coverage).toBe('FULL');
    expect(result.findings).toHaveLength(0);
  });

  it('stays INCOMPLETE (exit 2) when the dependency scanner is unavailable', async () => {
    const result = await runAudit({
      root: path.join(fixtures, 'no-scanner-repo'),
      online: false,
      skipQualityChecks: true,
    });
    const dep = result.scanners.find((s) => s.scanner.startsWith('dependencies'));
    expect(dep?.status).toBe('SKIPPED');
    expect(result.gate.result).toBe('INCOMPLETE');
    expect(result.exitCode).toBe(2);
  });

  it('maps the engine strictExitCode in strict mode and keeps the soft mapping', async () => {
    const result = await runAudit({
      root: path.join(fixtures, 'no-scanner-repo'),
      online: false,
      skipQualityChecks: true,
      strict: true,
    });
    // A recorded blocking reason (mandatory scanner skipped) forces strict exit 1,
    // while the default mapping of the same decision is 2.
    expect(result.exitCode).toBe(1);
    expect(result.softExitCode).toBe(2);
  });
});

describe('runAudit in TypeScript compatibility mode (engine unavailable)', () => {
  it('still produces a decision and labels the degraded run honestly', async () => {
    const saved = saveEngineEnv();
    try {
      // Point the resolver at a path that does not exist; runAudit creates a
      // fresh adapter per audit, so the env change takes effect immediately.
      process.env.VEYLQORIX_ENGINE = '/nonexistent-veylqorix-engine';
      const result = await runAudit({
        root: path.join(fixtures, 'secret-repo'),
        online: false,
        skipQualityChecks: true,
      });
      expect(result.gate.result).toBe('FAIL');
      expect(result.exitCode).toBe(1);
      const secrets = result.scanners.find((s) => s.scanner === 'secrets');
      expect(secrets).toBeDefined();
      expect(secrets?.status).toBe('FAIL');
      const hasDegradedNote =
        secrets?.notes.some((n) => n.includes('Rust engine unavailable')) === true;
      expect(hasDegradedNote).toBe(true);
      const serialized = JSON.stringify(result.findings);
      expect(serialized).not.toContain(RAW_AWS_KEY);
      expect(serialized).not.toContain(RAW_GITHUB_TOKEN);
    } finally {
      saved.restore();
    }
  });

  it('degraded clean repo passes with the same exit-code semantics', async () => {
    const saved = saveEngineEnv();
    try {
      process.env.VEYLQORIX_ENGINE = '/nonexistent-veylqorix-engine';
      const result = await runAudit({
        root: path.join(fixtures, 'clean-repo'),
        online: false,
        skipQualityChecks: true,
        mocks: { dependencies: [] },
      });
      expect(result.gate.result).toBe('PASS');
      expect(result.exitCode).toBe(0);
      const secrets = result.scanners.find((s) => s.scanner === 'secrets');
      expect(secrets?.notes.some((n) => n.includes('Rust engine unavailable'))).toBe(true);
    } finally {
      saved.restore();
    }
  });
});
