import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../packages/mcp-server/src/index.js';

/**
 * MCP server tests at the repo tests/ level. Drives the server from
 * packages/mcp-server through an in-memory MCP client, mirroring the package
 * tests with repo-relative fixtures.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const fixtures = path.join(repoRoot, 'tests', 'fixtures');
const cleanRoot = path.join(fixtures, 'clean-repo');
const secretRoot = path.join(fixtures, 'secret-repo');
const noScannerRoot = path.join(fixtures, 'no-scanner-repo');

function textOf(result: { content?: unknown[] }): string {
  return ((result.content as Array<{ text: string }>) ?? [])
    .map((c) => c.text ?? '')
    .join('\n');
}

describe('MCP server (repo-level integration)', () => {
  let client: InstanceType<typeof Client>;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const server = createServer({ roots: [fixtures], online: false, timeoutMs: 20_000 });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'veylqorix-tests-client', version: '0.0.1' });
    await client.connect(clientTransport);
    close = async () => {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    };
  }, 30_000);

  afterAll(async () => {
    await close?.();
  });

  it('exposes the six security tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'get_findings',
      'run_security_checks',
      'scan_dependencies',
      'scan_repository',
      'scan_secrets',
      'validate_fix',
    ]);
  });

  it('rejects a path that escapes the configured root', async () => {
    const res = await client.callTool({ name: 'scan_repository', arguments: { root: '/etc' } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('PATH_ERROR');
    const structured = res.structuredContent as { error?: { code?: string } };
    expect(structured?.error?.code).toBe('PATH_ERROR');
  });

  it('rejects a `..` traversal that escapes the fixtures root', async () => {
    const res = await client.callTool({
      name: 'scan_secrets',
      arguments: { root: path.join(fixtures, '../../..') },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('PATH_ERROR');
  });

  it('rejects malformed input (non-string root)', async () => {
    const res = await client.callTool({
      name: 'scan_repository',
      arguments: { root: 12345, skipQualityChecks: true },
    });
    expect(res.isError).toBe(true);
  });

  it('rejects a missing required argument', async () => {
    const res = await client.callTool({ name: 'scan_secrets', arguments: {} });
    expect(res.isError).toBe(true);
  });

  it('redacts secret values in scan_secrets results', async () => {
    const res = await client.callTool({ name: 'scan_secrets', arguments: { root: secretRoot } });
    expect(res.isError).not.toBe(true);
    const findings = (res.structuredContent as { findings?: Array<{ id: string }> }).findings ?? [];
    expect(findings.length).toBeGreaterThan(0);
    const blob = JSON.stringify(res.structuredContent ?? {}) + textOf(res);
    expect(blob).not.toContain('AKIA0123456789ABCDEF');
    expect(blob).not.toContain('ghp_0123456789abcdefghijklmnopqrstuvwxyz0123456789');
    expect(blob).toContain('redacted');
  });

  it('reports an unavailable dependency scanner honestly (SKIPPED/ERROR, never a pass)', async () => {
    const res = await client.callTool({ name: 'scan_dependencies', arguments: { root: noScannerRoot } });
    const structured = res.structuredContent as {
      status: string;
      available?: boolean;
      notes?: string[];
    };
    expect(['SKIPPED', 'ERROR']).toContain(structured.status);
    expect(structured.available).toBe(false);
    expect(Array.isArray(structured.notes)).toBe(true);
  });

  it('validates a fix by checking finding ids no longer appear', async () => {
    const res = await client.callTool({
      name: 'validate_fix',
      arguments: { root: cleanRoot, scanners: ['secrets'], findingIds: ['SECRETS-00000000'] },
    });
    expect(res.isError).not.toBe(true);
    const structured = res.structuredContent as {
      checked?: Array<{ id: string; stillPresent: boolean }>;
      unresolved?: string[];
    };
    expect(Array.isArray(structured.checked)).toBe(true);
    expect(structured.checked?.[0].stillPresent).toBe(false);
    expect(structured.unresolved).toEqual([]);
  });

  it('does not echo a raw private key or credential into any tool result', async () => {
    // A fixture repo containing a PEM private key and a literal credential
    // value; after a scan, no raw value may survive in the serialized result.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veylqorix-sec-'));
    const keyBody = 'MIIW0123456789abcdefghijklmnopqrstuvwxyzXYZ789';
    fs.writeFileSync(
      path.join(tmp, 'id_rsa'),
      `-----BEGIN RSA PRIVATE KEY-----\n${keyBody}\n-----END RSA PRIVATE KEY-----\n`,
    );
    fs.writeFileSync(path.join(tmp, 'config.json'), '{"apiKey": "AKIA0123456789ABCDEF"}');
    try {
      const local = createServer({ roots: [tmp], online: false, timeoutMs: 20_000 });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await local.connect(st);
      const lc = new Client({ name: 'veylqorix-sec-client', version: '0.0.1' });
      await lc.connect(ct);
      const res = await lc.callTool({ name: 'scan_secrets', arguments: { root: tmp } });
      expect(res.isError).not.toBe(true);
      const blob = JSON.stringify(res.structuredContent ?? {}) + textOf(res);
      expect(blob).not.toContain(keyBody);
      expect(blob).not.toContain('AKIA0123456789ABCDEF');
      expect(blob).not.toContain('BEGIN RSA PRIVATE KEY');
      await lc.close().catch(() => undefined);
      await local.close().catch(() => undefined);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('rejects a symlink that points outside the configured root', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veylqorix-sym-'));
    fs.symlinkSync('/etc', path.join(tmp, 'esc'));
    try {
      const local = createServer({ roots: [tmp], online: false, timeoutMs: 5_000 });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await local.connect(st);
      const lc = new Client({ name: 'veylqorix-sym-client', version: '0.0.1' });
      await lc.connect(ct);
      const res = await lc.callTool({
        name: 'scan_secrets',
        arguments: { root: path.join(tmp, 'esc') },
      });
      expect(res.isError).toBe(true);
      expect(textOf(res)).toContain('PATH_ERROR');
      await lc.close().catch(() => undefined);
      await local.close().catch(() => undefined);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fails closed when no roots are configured (no unlimited access)', () => {
    expect(() => createServer({ roots: [], online: false })).toThrowError(/root/i);
  });

  it('fails closed when a configured root does not exist', () => {
    expect(() =>
      createServer({ roots: [path.join(os.tmpdir(), 'veylqorix-missing-root-xyz')], online: false }),
    ).toThrowError(/existing directory/i);
  });

  it('keeps the same result shape for the same tool and inputs', async () => {
    const a = await client.callTool({
      name: 'scan_repository',
      arguments: { root: cleanRoot, skipQualityChecks: true },
    });
    const b = await client.callTool({
      name: 'scan_repository',
      arguments: { root: cleanRoot, skipQualityChecks: true },
    });
    const keys = (r: unknown) =>
      Object.keys((r as { structuredContent?: Record<string, unknown> }).structuredContent ?? {})
        .sort()
        .join(',');
    expect(keys(a)).toBe(keys(b));
    const s = (a as { structuredContent?: Record<string, unknown> }).structuredContent ?? {};
    expect(typeof s.findingsTruncated).toBe('boolean');
  });

  it('reports scanner unavailability as a structured condition, never success', async () => {
    const res = await client.callTool({
      name: 'get_findings',
      arguments: { root: noScannerRoot },
    });
    const structured = res.structuredContent as {
      scanners?: Array<{ scanner: string; status: string; available: boolean }>;
    };
    expect(Array.isArray(structured.scanners)).toBe(true);
    for (const sc of structured.scanners ?? []) {
      const unavailable = sc.status === 'SKIPPED' || sc.status === 'ERROR';
      expect(sc.available).toBe(!unavailable);
    }
    // No tool-level success flag is set for an unavailable scanner.
    expect(res.isError).not.toBe(true);
  });

  it('preserves scan-status fields when the text block is truncated', async () => {
    const capped = createServer({
      roots: [fixtures],
      online: false,
      timeoutMs: 20_000,
      maxTextChars: 60,
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await capped.connect(st);
    const lc = new Client({ name: 'veylqorix-cap-client', version: '0.0.1' });
    await lc.connect(ct);
    const res = await lc.callTool({
      name: 'scan_repository',
      arguments: { root: cleanRoot, skipQualityChecks: true },
    });
    expect(res.isError).not.toBe(true);
    expect(textOf(res)).toContain('truncated to 60 chars');
    const s = res.structuredContent as Record<string, unknown>;
    expect(s.gate).toBeDefined();
    expect(typeof s.coverage).toBe('string');
    expect(typeof s.exitCode).toBe('number');
    // The truncated result still states the scan's completeness.
    expect(typeof s.findingsTruncated).toBe('boolean');
    // No malformed JSON: the structured payload is intact.
    JSON.parse(JSON.stringify(s));
    await lc.close().catch(() => undefined);
    await capped.close().catch(() => undefined);
  });
});
