import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Import the built API package directly (it is not linked into the root
// node_modules; the same shape of import is used by packages/api's own tests).
import { createServer, createStore } from '../../packages/api/dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const fixtures = path.join(repoRoot, 'tests', 'fixtures');

interface Response {
  status: number;
  text: string;
  json: unknown;
}

function request(port: number, method: string, urlPath: string, body?: unknown): Promise<Response> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: urlPath,
        headers: payload ? { 'Content-Type': 'application/json' } : {},
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json: unknown = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch {
            json = data;
          }
          resolve({ status: res.statusCode ?? 0, text: data, json });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function listen(server: http.Server): Promise<number> {
  return new Promise((r) => server.listen(0, () => r()));
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}

async function pollUntilDone(port: number, scanId: string, timeoutMs = 60_000): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let last = await request(port, 'GET', `/api/scans/${scanId}`);
  let guard = 0;
  while (
    last.json &&
    typeof last.json === 'object' &&
    (last.json as { status?: string }).status === 'RUNNING' &&
    guard < 120 &&
    Date.now() < deadline
  ) {
    await new Promise((r) => setTimeout(r, 500));
    last = await request(port, 'GET', `/api/scans/${scanId}`);
    guard += 1;
  }
  return last;
}

describe('Veylqorix API route integration (register → scan → findings → sarif)', () => {
  let server: http.Server;
  let port: number;
  let scanId = '';

  beforeAll(async () => {
    server = createServer({
      store: createStore(),
      // Offline: deterministic, no advisory DB network calls in tests.
      auditDefaults: { online: false },
      allowedRoots: [fixtures],
    });
    port = await listen(server);
  });

  afterAll(async () => {
    await close(server);
  });

  it('GET /api/health returns liveness', async () => {
    const res = await request(port, 'GET', '/api/health');
    expect(res.status).toBe(200);
    expect((res.json as { ok: boolean }).ok).toBe(true);
  });

  it('POST /api/repositories registers the secret-repo fixture', async () => {
    const res = await request(port, 'POST', '/api/repositories', {
      path: path.join(fixtures, 'secret-repo'),
      name: 'secret-repo',
    });
    expect(res.status).toBe(201);
    const repo = (res.json as { repository: { id: string; path: string } }).repository;
    expect(repo.path).toContain('secret-repo');
    expect(repo.id).toMatch(/^repo-/);
  });

  it('POST /api/repositories rejects paths outside allowedRoots with structured JSON', async () => {
    const res = await request(port, 'POST', '/api/repositories', { path: '/etc' });
    expect(res.status).toBe(403);
    expect((res.json as { error: string }).error).toMatch(/outside the allowed roots/i);
  });

  it('POST /api/scan starts a scan and returns 202 with a scan id', async () => {
    const list = await request(port, 'GET', '/api/repositories');
    const repoId = (list.json as { repositories: Array<{ id: string }> }).repositories[0]?.id;
    expect(repoId).toBeDefined();

    const res = await request(port, 'POST', '/api/scan', { repoId });
    expect(res.status).toBe(202);
    const scan = (res.json as { scan: { id: string; status: string; repoId: string } }).scan;
    expect(scan.id).toMatch(/^scan-/);
    expect(scan.status).toBe('RUNNING');
    expect(scan.repoId).toBe(repoId);
    scanId = scan.id;
  });

  it('GET /api/scans lists scans and shows the completed scan', async () => {
    await pollUntilDone(port, scanId);

    const res = await request(port, 'GET', '/api/scans');
    expect(res.status).toBe(200);
    const scans = (res.json as { scans: Array<{ id: string; status: string; repoId: string }> }).scans;
    expect(scans.length).toBe(1);
    expect(scans[0]?.id).toBe(scanId);
    expect(scans[0]?.status).toBe('DONE');

    // The repo-filtered listing agrees.
    const filtered = await request(port, 'GET', `/api/scans?repoId=${scans[0]?.repoId}`);
    expect((filtered.json as { scans: unknown[] }).scans).toHaveLength(1);
  });

  it('GET /api/scans/:id returns the completed scan with a redacted secret finding', async () => {
    const done = await pollUntilDone(port, scanId);
    const scan = done.json as {
      status: string;
      gate: { result: string };
      exitCode: number;
      findings: Array<{ secret?: boolean; scanner: string; evidence?: { snippet?: string } }>;
    };
    expect(scan.status).toBe('DONE');
    // The secret fixture has blocking secrets => FAIL, exit 1.
    expect(scan.gate.result).toBe('FAIL');
    expect(scan.exitCode).toBe(1);
    expect(scan.findings.length).toBeGreaterThan(0);

    const secretFinding = scan.findings.find((f) => f.secret === true || f.scanner === 'secrets');
    expect(secretFinding).toBeDefined();
    const blob = JSON.stringify(scan.findings);
    // Redaction invariant: raw fake secret values never appear in API output.
    expect(blob).not.toContain('AKIA0123456789ABCDEF');
    expect(blob).not.toContain('ghp_0123456789abcdefghijklmnopqrstuvwxyz0123456789');
    expect(blob).toContain('redacted');
  });

  it('GET /api/reports/:scanId?sarif returns a SARIF 2.1.0 document', async () => {
    const sarif = await request(port, 'GET', `/api/reports/${scanId}?format=sarif`);
    expect(sarif.status).toBe(200);
    const doc = sarif.json as { version: string; runs: unknown[] };
    expect(doc.version).toBe('2.1.0');
    expect(Array.isArray(doc.runs)).toBe(true);
    expect(doc.runs.length).toBeGreaterThan(0);
    // SARIF must not leak raw secret values either.
    expect(sarif.text).not.toContain('AKIA0123456789ABCDEF');
  });

  it('GET /api/reports/:scanId returns markdown and json formats', async () => {
    const md = await request(port, 'GET', `/api/reports/${scanId}`);
    expect(md.status).toBe(200);
    expect(md.text).toContain('Veylqorix Security Audit Report');

    const json = await request(port, 'GET', `/api/reports/${scanId}?format=json`);
    expect(json.status).toBe(200);
    expect((json.json as { schemaVersion: number }).schemaVersion).toBe(1);
    expect(json.json).toHaveProperty('gate');
  });

  it('GET /api/reports/:scanId rejects unknown formats with structured JSON', async () => {
    const res = await request(port, 'GET', `/api/reports/${scanId}?format=pdf`);
    expect(res.status).toBe(400);
    expect((res.json as { error: string }).error).toMatch(/Unsupported format/i);
  });

  it('unknown routes return structured JSON 404s', async () => {
    const res = await request(port, 'GET', '/api/nope');
    expect(res.status).toBe(404);
    expect((res.json as { error: string }).error).toMatch(/No route/i);

    const missing = await request(port, 'GET', '/api/scans/does-not-exist');
    expect(missing.status).toBe(404);
  });
});
