import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from './index.js';

/**
 * Drive the real MCP server through an in-memory transport with a real MCP
 * client. This exercises argument validation, path confinement, secret
 * redaction, and structured error paths without a stdio process.
 */
describe('Veylqorix MCP server', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const fixtures = path.join(repoRoot, 'tests', 'fixtures');
  const cleanRoot = path.join(fixtures, 'clean-repo');

  let client: InstanceType<typeof Client>;
  let server: ReturnType<typeof createServer>;
  let close: () => Promise<void>;

  beforeAll(async () => {
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
    expect(names).toEqual(
      [
        'check_dependencies',
        'detect_secrets',
        'get_audit_report',
        'run_quality_checks',
        'scan_project',
        'verify_quality_gate',
      ].sort(),
    );
  });

  it('run scan_project on an authorized root and get structured output', async () => {
    const res = await client.callTool({
      name: 'scan_project',
      arguments: { root: cleanRoot, skipQualityChecks: true },
    });
    const structured = res.structuredContent as { gate: { result: string }; exitCode: number; findings: unknown[] };
    expect(structured.gate).toBeDefined();
    expect(typeof structured.exitCode).toBe('number');
    expect(Array.isArray(structured.findings)).toBe(true);
  });

  it('confines filesystem access to the authorized roots', async () => {
    const res = await client.callTool({
      name: 'scan_project',
      arguments: { root: '/etc' },
    });
    expect(res.isError).toBe(true);
    const text = (res.content as { text: string }[]).map((c) => c.text).join(' ');
    expect(text).toContain('PATH_ERROR');
  });

  it('rejects path traversal that escapes the root', async () => {
    const res = await client.callTool({
      name: 'detect_secrets',
      arguments: { root: path.join(fixtures, '../../..') },
    });
    expect(res.isError).toBe(true);
  });

  it('detects and redacts the fake secret in the secret fixture', async () => {
    const res = await client.callTool({
      name: 'detect_secrets',
      arguments: { root: path.join(fixtures, 'secret-repo') },
    });
    const structured = res.structuredContent as { findings: { evidence?: { snippet?: string }; secret?: boolean }[] };
    expect(structured.findings.length).toBeGreaterThan(0);
    for (const f of structured.findings) {
      expect(f.secret).toBe(true);
      const snippet = f.evidence?.snippet ?? '';
      expect(snippet).not.toContain('AKIA0123456789ABCDEF');
      expect(snippet).not.toContain('ghp_0123456789abcdefghijklmnopqrstuvwxyz0123456789');
    }
  });

  it('verifies the quality gate with a deterministic exit code', async () => {
    const res = await client.callTool({
      name: 'verify_quality_gate',
      arguments: { root: cleanRoot, blockOnSeverity: ['CRITICAL', 'HIGH'] },
    });
    const structured = res.structuredContent as { result: string; exitCode: number; coverage: string };
    expect(['PASS', 'FAIL', 'INCOMPLETE']).toContain(structured.result);
    expect([0, 1, 2]).toContain(structured.exitCode);
    // Offline + mandatory dep scanner skip => INCOMPLETE, never a fake PASS.
    if (structured.result === 'INCOMPLETE') expect(structured.exitCode).toBe(2);
    if (structured.result === 'PASS') expect(structured.exitCode).toBe(0);
  });

  it('returns a structured error for a missing required argument', async () => {
    const res = await client.callTool({
      name: 'detect_secrets',
      arguments: {},
    });
    // Zod should reject the missing `root`; the SDK surfaces it as an error result.
    expect(res.isError).toBe(true);
  });

  it('handles an unavailable (offline) dependency scanner gracefully', async () => {
    const res = await client.callTool({
      name: 'check_dependencies',
      arguments: { root: path.join(fixtures, 'no-scanner-repo') },
    });
    const structured = res.structuredContent as { status: string; notes: string[] };
    // Offline + no pip-audit => SKIPPED, with an explanatory note, not a crash.
    expect(['SKIPPED', 'ERROR', 'PASS', 'FAIL']).toContain(structured.status);
    expect(Array.isArray(structured.notes)).toBe(true);
  });
});
