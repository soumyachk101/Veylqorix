import { describe, expect, it, beforeAll, afterAll } from 'vitest';
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
});
