import { describe, expect, it } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, createStore } from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const fixtures = path.join(repoRoot, 'tests', 'fixtures');

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper returns arbitrary JSON
function request(port: number, method: string, urlPath: string, body?: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      { host: '127.0.0.1', port, method, path: urlPath, headers: payload ? { 'Content-Type': 'application/json' } : {} },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json: unknown;
          try {
            json = data ? JSON.parse(data) : null;
          } catch {
            json = data;
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('Veylqorix API server', () => {
  let server: http.Server;
  let port: number;

  it('registers a repository and returns it', async () => {
    server = createServer({ store: createStore(), auditDefaults: { online: false } });
    await new Promise<void>((r) => server.listen(0, () => r()));
    port = (server.address() as { port: number }).port;

    const reg = await request(port, 'POST', '/api/repositories', {
      path: path.join(fixtures, 'secret-repo'),
      name: 'secret-repo',
    });
    expect(reg.status).toBe(201);
    expect(reg.json.repository.path).toContain('secret-repo');

    const list = await request(port, 'GET', '/api/repositories');
    expect(list.json.repositories).toHaveLength(1);

    const health = await request(port, 'GET', '/api/health');
    expect(health.json.ok).toBe(true);
  });

  it('rejects repositories outside the allowed roots (least privilege)', async () => {
    const guarded = createServer({
      store: createStore(),
      allowedRoots: [fixtures],
      auditDefaults: { online: false },
    });
    await new Promise<void>((r) => guarded.listen(0, () => r()));
    const gport = (guarded.address() as { port: number }).port;
    const ok = await request(gport, 'POST', '/api/repositories', { path: path.join(fixtures, 'clean-repo') });
    expect(ok.status).toBe(201);
    const denied = await request(gport, 'POST', '/api/repositories', { path: '/etc' });
    expect(denied.status).toBe(403);
    await new Promise<void>((resolve, reject) => guarded.close((e) => (e ? reject(e) : resolve())));
  });

  it('runs a real scan and exposes findings, gate, and history', async () => {
    const result = await request(port, 'POST', '/api/scan', { repoId: (await request(port, 'GET', '/api/repositories')).json.repositories[0].id });
    expect(result.status).toBe(202);
    const scanId = result.json.scan.id as string;

    // Poll until the scan completes.
    let scan = await request(port, 'GET', `/api/scan/${scanId}`);
    let tries = 0;
    while (scan.json.status === 'RUNNING' && tries < 60) {
      await new Promise((r) => setTimeout(r, 200));
      scan = await request(port, 'GET', `/api/scan/${scanId}`);
      tries++;
    }
    expect(scan.json.status).toBe('DONE');
    // The secret fixture has a blocking exposed secret => FAIL, exit 1.
    expect(scan.json.gate.result).toBe('FAIL');
    expect(scan.json.exitCode).toBe(1);
    expect(scan.json.findings.length).toBeGreaterThan(0);
    // Redaction: no raw fake value in the API response.
    expect(JSON.stringify(scan.json.findings)).not.toContain('AKIA0123456789ABCDEF');

    const findings = await request(port, 'GET', `/api/scan/${scanId}/findings`);
    expect(findings.status).toBe(200);
    expect(findings.json.findings.length).toBeGreaterThan(0);

    const report = await request(port, 'GET', `/api/scan/${scanId}/report`);
    expect(report.status).toBe(200);
    expect(String(report.json)).toContain('Veylqorix Security Audit Report');

    const sarif = await request(port, 'GET', `/api/scan/${scanId}/report?format=sarif`);
    expect(sarif.status).toBe(200);
    expect(sarif.json.version).toBe('2.1.0');

    const repoId = (await request(port, 'GET', '/api/repositories')).json.repositories[0].id;
    const history = await request(port, 'GET', `/api/repo/${repoId}/history`);
    expect(history.json.history[0].id).toBe(scanId);

    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }, 60_000);
});
