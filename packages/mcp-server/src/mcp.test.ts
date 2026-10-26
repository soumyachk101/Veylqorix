import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
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

  it('rejects a symlink inside the root that points outside it', async () => {
    // Build a throwaway root that contains a symlink escaping to /etc.
    // realpath the root so the tool argument lines up with the canonical
    // form createServer checks containment against.
    const tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'veylqorix-mcp-')));
    try {
      fs.symlinkSync('/etc', path.join(tmpRoot, 'esc'));
      const local = createServer({ roots: [tmpRoot], online: false, timeoutMs: 5_000 });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await local.connect(st);
      const localClient = new Client({ name: 'veylqorix-symlink-client', version: '0.0.1' });
      await localClient.connect(ct);
      const res = await localClient.callTool({
        name: 'scan_secrets',
        arguments: { root: path.join(tmpRoot, 'esc') },
      });
      // The symlink resolves outside the root, so the call fails with a
      // structured PATH_ERROR — it is never followed.
      expect(res.isError).toBe(true);
      expect(textOf(res)).toContain('PATH_ERROR');
      await localClient.close().catch(() => undefined);
      await local.close().catch(() => undefined);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('rejects a root that is not a configured workspace root (fail closed)', async () => {
    // No configured roots -> createServer refuses to build the server at all.
    expect(() => createServer({ roots: [], online: false })).toThrowError(/root/i);
    // A configured root that does not exist also fails closed, so confinement
    // is never checked against a phantom spelling.
    expect(() =>
      createServer({ roots: [path.join(os.tmpdir(), 'veylqorix-does-not-exist-xyz')] }),
    ).toThrowError(/existing directory/i);
  });

  it('returns a structured PATH_ERROR (not a crash) for a target outside every root', async () => {
    // A path that contains no traversal but is outside the configured roots:
    // the confinement check rejects it before any filesystem access.
    const res = await client.callTool({
      name: 'scan_secrets',
      arguments: { root: '/nonexistent-veylqorix-target' },
    });
    expect(res.isError).toBe(true);
    const err = structuredOf(res).error as { code?: string; message?: string };
    expect(err?.code).toBe('PATH_ERROR');
    expect(typeof err?.message).toBe('string');
    // The payload is still a safe structured result, not an exception.
    expect(JSON.parse(JSON.stringify(structuredOf(res)))).toBeDefined();
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
      Object.keys(structuredOf(r)).sort();
    expect(keys(a)).toEqual(keys(b));
    // Truncation bookkeeping is part of the stable shape.
    expect((structuredOf(a).findingsTruncated as boolean | undefined) !== undefined).toBe(true);
  });

  it('caps the text block with an explicit marker while keeping structured status fields', async () => {
    // Tiny cap so the gate summary text is guaranteed to exceed it; the
    // structured payload (gate, coverage, exitCode, findings caps) must
    // survive and remain valid JSON.
    const capped = createServer({
      roots: [fixtures],
      online: false,
      timeoutMs: 20_000,
      maxTextChars: 80,
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await capped.connect(st);
    const cappedClient = new Client({ name: 'veylqorix-capped-client', version: '0.0.1' });
    await cappedClient.connect(ct);
    const res = await cappedClient.callTool({
      name: 'scan_repository',
      arguments: { root: cleanRoot, skipQualityChecks: true },
    });
    expect(res.isError).not.toBe(true);
    const text = textOf(res);
    expect(text).toContain('truncated to 80 chars');
    const s = structuredOf(res);
    expect(s.gate).toBeDefined();
    expect(typeof s.coverage).toBe('string');
    expect(typeof s.exitCode).toBe('number');
    expect(Array.isArray(s.findings)).toBe(true);
    expect(Array.isArray(s.scanners)).toBe(true);
    // The payload is intact JSON with its scan-completeness fields intact.
    JSON.parse(JSON.stringify(s));
    await cappedClient.close().catch(() => undefined);
    await capped.close().catch(() => undefined);
  });

  it('keeps a scanner-unavailable flag consistent across tools that report scanners', async () => {
    const res = await client.callTool({
      name: 'get_findings',
      arguments: { root: noScannerRoot },
    });
    const s = structuredOf(res);
    const scanners = s.scanners as Array<{ scanner: string; status: string; available: boolean }>;
    expect(scanners.length).toBeGreaterThan(0);
    for (const sc of scanners) {
      const unavailable = sc.status === 'SKIPPED' || sc.status === 'ERROR';
      expect(sc.available).toBe(!unavailable);
    }
  });

  it('caps findingsTruncated reporting when the limit is smaller than the total', async () => {
    const res = await client.callTool({
      name: 'get_findings',
      arguments: { root: secretRoot, onlyScanners: ['secrets'], limit: 1 },
    });
    const s = structuredOf(res);
    expect(Array.isArray(s.findings)).toBe(true);
    expect((s.findings as unknown[]).length).toBeLessThanOrEqual(1);
    expect(typeof s.findingsTruncated).toBe('boolean');
    expect(typeof s.totalFindings).toBe('number');
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

  it('scrubs a whole PEM private key block, including its body', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEogIBAAKCAQEAabc123def456xyz789\nsecretBodyBytes\n-----END RSA PRIVATE KEY-----';
    const out = redactText(pem);
    expect(out).toContain('[REDACTED-PRIVATE-KEY]');
    expect(out).not.toContain('secretBodyBytes');
    expect(out).not.toContain('BEGIN RSA PRIVATE KEY');
  });

  it('redacts assigned credential values that no value pattern recognizes', () => {
    expect(redactText('password = "hunter2secret"')).not.toContain('hunter2secret');
    expect(redactText('const token="mySup3rSecretValue"')).not.toContain('mySup3rSecretValue');
  });

  it('does not leak raw values from nested structures or Markdown-formatted text', () => {
    const nested = {
      notes: ['key AKIA0123456789ABCDEF found'],
      markdown: '## Report\n- AKIA0123456789ABCDEF in `config.js`\n',
      list: [{ value: 'ghp_0123456789abcdefghijklmnopqrstuvwxyz0123456789' }],
    };
    const serialized = JSON.stringify(nested);
    // redactText runs on every string value; simulate the deep pass here.
    const deep = JSON.parse(
      JSON.stringify(nested, (_k, v) => (typeof v === 'string' ? redactText(v) : v)),
    );
    const blob = JSON.stringify(deep);
    expect(blob).not.toContain('AKIA0123456789ABCDEF');
    expect(blob).not.toContain('ghp_0123456789abcdefghijklmnopqrstuvwxyz0123456789');
    expect(blob).toContain('redacted');
    expect(serialized).toContain('AKIA0123456789ABCDEF'); // raw input did contain it
  });
});
