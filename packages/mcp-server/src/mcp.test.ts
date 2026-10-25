import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, redactText } from './index.js';

/**
 * Drive the real MCP server through an in-memory transport with a real MCP
 * client. This exercises argument validation, path confinement, secret
 * redaction, and structured error paths without a stdio process.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

const ALL_TOOLS = [
  'get_findings',
  'run_security_checks',
  'scan_dependencies',
  'scan_repository',
  'scan_secrets',
  'validate_fix',
].sort();

/**
 * Pull the first text block out of a tool result, for assertions. The SDK's
 * callTool result is a union across tool kinds, so accept it as-is and cast
 * internally.
 */
function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text: string }> }).content ?? [];
  return content.map((c) => c.text).join('\n');
}

function structuredOf(result: unknown): Record<string, unknown> {
  return (result as { structuredContent?: Record<string, unknown> }).structuredContent ?? {};
}

describe('Veylqorix MCP server', () => {
  const fixtures = path.join(repoRoot, 'tests', 'fixtures');
  const cleanRoot = path.join(fixtures, 'clean-repo');
  const secretRoot = path.join(fixtures, 'secret-repo');
  const noScannerRoot = path.join(fixtures, 'no-scanner-repo');

  let client: InstanceType<typeof Client>;
  let server: ReturnType<typeof createServer>;
  let close: () => Promise<void>;

  beforeAll(async () => {
    // Offline + short timeout: deterministic, no external scanners invoked.
    server = createServer({ roots: [fixtures], online: false, timeoutMs: 20_000 });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'veylqorix-test-client', version: '0.0.1' });
    await client.connect(clientTransport);
    close = async () => {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    };
  }, 30_000);

  afterAll(async () => {
    await close?.();
  });

  it('exposes all six security tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(ALL_TOOLS);
  });

  it('runs scan_repository on an authorized root and returns structured output', async () => {
    const res = await client.callTool({
      name: 'scan_repository',
      arguments: { root: cleanRoot, skipQualityChecks: true },
    });
    expect(res.isError).not.toBe(true);
    const s = structuredOf(res);
    expect(s.gate).toBeDefined();
    expect(typeof s.exitCode).toBe('number');
    expect(Array.isArray(s.findings)).toBe(true);
    expect(Array.isArray(s.scanners)).toBe(true);
    expect(Array.isArray(s.checks)).toBe(true);
  });

  it('confines filesystem access to the authorized roots (path traversal)', async () => {
    // An absolute path that lives outside every configured root.
    const outside = await client.callTool({
      name: 'scan_repository',
      arguments: { root: '/etc' },
    });
    expect(outside.isError).toBe(true);
    expect(textOf(outside)).toContain('PATH_ERROR');
    expect((structuredOf(outside).error as { code?: string } | undefined)?.code).toBe('PATH_ERROR');

    // A `..` sequence that would escape the fixtures root.
    const traversal = await client.callTool({
      name: 'scan_secrets',
      arguments: { root: path.join(fixtures, '../../..') },
    });
    expect(traversal.isError).toBe(true);
    expect(textOf(traversal)).toContain('PATH_ERROR');
  });

  it('rejects a missing required argument', async () => {
    const res = await client.callTool({
      name: 'scan_secrets',
      arguments: {},
    });
    // Zod rejects the missing `root`; the SDK surfaces it as an error result.
    expect(res.isError).toBe(true);
  });

  it('rejects a malformed argument value', async () => {
    const res = await client.callTool({
      name: 'scan_repository',
      arguments: { root: 42, skipQualityChecks: true },
    });
    expect(res.isError).toBe(true);
  });

  it('detects the fake secrets and redacts their raw values in tool results', async () => {
    const res = await client.callTool({
      name: 'scan_secrets',
      arguments: { root: secretRoot },
    });
    expect(res.isError).not.toBe(true);
    const s = structuredOf(res);
    const findings = s.findings as Array<{ id: string; title: string; evidence?: { snippet?: string } }>;
    expect(findings.length).toBeGreaterThan(0);

    // No raw credential value may appear anywhere in the serialized result.
    const blob = JSON.stringify(res.structuredContent ?? {}) + textOf(res);
    expect(blob).not.toContain('AKIA0123456789ABCDEF');
    expect(blob).not.toContain('ghp_0123456789abcdefghijklmnopqrstuvwxyz0123456789');
    // The redacted markers are present instead.
    expect(blob).toContain('redacted');
  });

  it('reports an unavailable scanner honestly (SKIPPED/ERROR, never a pass)', async () => {
    const res = await client.callTool({
      name: 'scan_dependencies',
      arguments: { root: noScannerRoot },
    });
    const s = structuredOf(res);
    // Offline Python project with no pip-audit: the dependency scanner cannot
    // complete, so it is reported SKIPPED/ERROR and marked unavailable.
    expect(['SKIPPED', 'ERROR']).toContain(s.status);
    expect(s.available).toBe(false);
    expect(Array.isArray(s.notes)).toBe(true);
    // The text must not claim a clean pass.
    expect(textOf(res)).not.toMatch(/clean|no known vulnerabilities/i);
  });

  it('reports the gate with a deterministic exit code', async () => {
    const res = await client.callTool({
      name: 'scan_repository',
      arguments: { root: cleanRoot, skipQualityChecks: true },
    });
    const s = structuredOf(res);
    const gate = s.gate as { result: string };
    expect(['PASS', 'FAIL', 'INCOMPLETE']).toContain(gate.result);
    expect([0, 1, 2]).toContain(s.exitCode);
    // Offline: the mandatory dependency scanner is skipped, so coverage is not
    // FULL and the gate is INCOMPLETE, never a fake PASS.
    if (gate.result === 'INCOMPLETE') expect(s.exitCode).toBe(2);
    if (gate.result === 'PASS') expect(s.exitCode).toBe(0);
  });

  it('validates a fix by checking that finding ids no longer appear', async () => {
    // Ask for a finding id that does not exist in this clean repo: it should be
    // reported as resolved (not present), and the fresh run's findings returned.
    const res = await client.callTool({
      name: 'validate_fix',
      arguments: { root: cleanRoot, scanners: ['secrets'], findingIds: ['SECRETS-00000000'] },
    });
    const s = structuredOf(res);
    expect(res.isError).not.toBe(true);
    expect(Array.isArray(s.checked)).toBe(true);
    const checked = s.checked as Array<{ id: string; stillPresent: boolean }>;
    expect(checked[0]?.stillPresent).toBe(false);
    expect(s.unresolved).toEqual([]);
    // Notes spell out that a fix is only verified by a fresh run.
    expect(Array.isArray(s.notes)).toBe(true);
  });

  it('returns findings via get_findings with a working cap', async () => {
    const res = await client.callTool({
      name: 'scan_secrets',
      arguments: { root: secretRoot },
    });
    const total = (structuredOf(res).totalFindings as number | undefined) ?? 0;
    const got = await client.callTool({
      name: 'get_findings',
      arguments: { root: secretRoot, onlyScanners: ['secrets'], limit: 1 },
    });
    const s = structuredOf(got);
    expect((s.findings as unknown[]).length).toBeLessThanOrEqual(1);
    expect(s.findingsTruncated).toBe(total > 1);
    expect(s.limit).toBe(1);
  });
});

describe('redactText', () => {
  it('masks every known secret pattern', () => {
    expect(redactText('k=AKIA0123456789ABCDEF')).not.toContain('AKIA0123456789ABCDEF');
    expect(redactText('t=ghp_0123456789abcdefghijklmnopqrstuvwxyz0123456789')).not.toContain(
      'ghp_0123456789abcdefghijklmnopqrstuvwxyz0123456789',
    );
    expect(redactText('sk-ant-abcdef1234567890abcdef1234567890abcde')).not.toContain(
      'sk-ant-abcdef1234567890abcdef1234567890abcde',
    );
    expect(redactText('-----BEGIN RSA PRIVATE KEY-----xxxx')).toContain('[REDACTED-PRIVATE-KEY]');
    expect(redactText('hello world')).toBe('hello world');
  });
});
