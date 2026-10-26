import { describe, expect, it } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createServer,
  createStore,
  createApi,
  initializeRoots,
  createConfinement,
  type ApiStore,
  type ScanRecord,
} from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, '..', '..', '..', 'tests', 'fixtures');

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper returns arbitrary JSON
function request(port: number, method: string, urlPath: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; json: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: urlPath,
        headers: { ...(payload ? { 'Content-Type': 'application/json' } : {}), ...headers },
      },
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
          resolve({ status: res.statusCode ?? 0, json, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      if (!a || typeof a === 'string') return reject(new Error('address unavailable'));
      resolve(a.port);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}

/** Fresh, isolated root tree for the confinement tests. */
function makeRootSandbox(): { base: string; root: string; sibling: string; inner: string; outside: string; linkOut: string; cleanup: () => void } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'veylqorix-roots-'));
  const root = path.join(base, 'root');
  const sibling = path.join(base, 'root-sibling'); // sibling prefix trap
  const inner = path.join(root, 'nested', 'repo');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(sibling, { recursive: true });
  fs.mkdirSync(inner, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  const linkOut = path.join(root, 'link-out');
  fs.symlinkSync(outside, linkOut, 'dir');
  return {
    base,
    root,
    sibling,
    inner,
    outside,
    linkOut,
    cleanup: () => fs.rmSync(base, { recursive: true, force: true }),
  };
}

describe('Veylqorix API server', () => {
  let server: http.Server;
  let port: number;

  it('registers a repository and returns it', async () => {
    server = createServer({ store: createStore(), auditDefaults: { online: false } });
    port = await listen(server);

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
    expect(health.json.store).toBe(true);
    expect(health.json.schemaVersion).toBe(1);

    await close(server);
  });

  it('rejects repositories outside the allowed roots (least privilege)', async () => {
    const guarded = createServer({
      store: createStore(),
      allowedRoots: [fixtures],
      auditDefaults: { online: false },
    });
    const gport = await listen(guarded);
    const ok = await request(gport, 'POST', '/api/repositories', { path: path.join(fixtures, 'clean-repo') });
    expect(ok.status).toBe(201);
    const denied = await request(gport, 'POST', '/api/repositories', { path: '/etc' });
    expect(denied.status).toBe(403);
    expect(denied.json.error).toMatch(/outside the allowed roots/i);
    // The stored path is the canonical one, never the raw input.
    expect(ok.json.repository.path).toBe(path.join(await realpathOf(fixtures), 'clean-repo'));
    await close(guarded);
  });

  it('runs a real scan and exposes findings, gate, and history', async () => {
    const s = createServer({ store: createStore(), auditDefaults: { online: false } });
    const p = await listen(s);

    const reg = await request(p, 'POST', '/api/repositories', { path: path.join(fixtures, 'secret-repo') });
    const result = await request(p, 'POST', '/api/scan', { repoId: reg.json.repository.id });
    expect(result.status).toBe(202);
    const scanId = result.json.scan.id as string;

    // Poll until the scan completes.
    let scan = await request(p, 'GET', `/api/scan/${scanId}`);
    let tries = 0;
    while (scan.json.status === 'RUNNING' && tries < 60) {
      await new Promise((r) => setTimeout(r, 200));
      scan = await request(p, 'GET', `/api/scan/${scanId}`);
      tries++;
    }
    expect(scan.json.status).toBe('DONE');
    // The secret fixture has a blocking exposed secret => FAIL, exit 1.
    expect(scan.json.gate.result).toBe('FAIL');
    expect(scan.json.exitCode).toBe(1);
    expect(scan.json.findings.length).toBeGreaterThan(0);
    // Redaction: no raw fake value in the API response.
    expect(JSON.stringify(scan.json.findings)).not.toContain('AKIA0123456789ABCDEF');

    const findings = await request(p, 'GET', `/api/scan/${scanId}/findings`);
    expect(findings.status).toBe(200);
    expect(findings.json.findings.length).toBeGreaterThan(0);

    const report = await request(p, 'GET', `/api/scan/${scanId}/report`);
    expect(report.status).toBe(200);
    expect(String(report.json)).toContain('Veylqorix Security Audit Report');

    const sarif = await request(p, 'GET', `/api/scan/${scanId}/report?format=sarif`);
    expect(sarif.status).toBe(200);
    expect(sarif.json.version).toBe('2.1.0');

    const repoId = (await request(p, 'GET', '/api/repositories')).json.repositories[0].id;
    const history = await request(p, 'GET', `/api/repo/${repoId}/history`);
    expect(history.json.history[0].id).toBe(scanId);

    await close(s);
  }, 60_000);
});

async function realpathOf(p: string): Promise<string> {
  return fs.promises.realpath(p);
}

describe('root confinement (roots.ts)', () => {
  it('accepts the root itself and nested paths, rejects sibling-prefix traps', () => {
    const sandbox = makeRootSandbox();
    try {
      const confinement = initializeRoots([sandbox.root]);
      expect(confinement.roots).toHaveLength(1);
      // The root and a nested child are allowed…
      expect(confinement.confine(sandbox.root)).toBeDefined();
      expect(confinement.confine(sandbox.inner)).toBeDefined();
      // …but the sibling-prefix trap is not (a naive startsWith would pass).
      expect(confinement.confine(sandbox.sibling)).toBeUndefined();
      // Traversal via .. lands in the sibling tree: rejected.
      expect(confinement.confine(path.join(sandbox.inner, '..', '..', 'root-sibling', 'x'))).toBeUndefined();
      // A non-existent candidate is rejected without revealing what exists.
      expect(confinement.confine(path.join(sandbox.root, 'does-not-exist'))).toBeUndefined();
    } finally {
      sandbox.cleanup();
    }
  });

  it('rejects a symlink whose target is outside the root', () => {
    const sandbox = makeRootSandbox();
    try {
      const confinement = initializeRoots([sandbox.root]);
      expect(confinement.confine(sandbox.linkOut)).toBeUndefined();
    } finally {
      sandbox.cleanup();
    }
  });

  it('fails closed when a configured root does not exist or is not a directory', () => {
    const sandbox = makeRootSandbox();
    try {
      expect(() => initializeRoots([path.join(sandbox.base, 'missing-root')])).toThrow(/does not exist|not a directory/);
      const file = path.join(sandbox.base, 'a-file');
      fs.writeFileSync(file, 'not a directory');
      expect(() => initializeRoots([file])).toThrow(/not a directory/);
      // The API constructor must not listen on broken configuration.
      expect(() => createServer({ allowedRoots: [path.join(sandbox.base, 'nope')] })).toThrow();
    } finally {
      sandbox.cleanup();
    }
  });

  it('confines scan-body paths through the same gate as registration', async () => {
    const sandbox = makeRootSandbox();
    try {
      const server = createServer({
        store: createStore(),
        allowedRoots: [sandbox.root],
        auditDefaults: { online: false },
      });
      const port = await listen(server);
      // Inside the root: the one-call register+scan path is accepted.
      const inside = await request(port, 'POST', '/api/scan', { path: sandbox.inner });
      expect(inside.status).toBe(202);
      // Symlink-outside: same gate, same 403 as registration.
      const escaped = await request(port, 'POST', '/api/scan', { path: sandbox.linkOut });
      expect(escaped.status).toBe(403);
      expect(escaped.json.error).toMatch(/outside the allowed roots/i);
      // A rejected scan created nothing.
      const scans = await request(port, 'GET', '/api/scans');
      expect(scans.json.scans).toHaveLength(1);
      await close(server);
    } finally {
      sandbox.cleanup();
    }
  }, 60_000);

  it('with no roots configured, confinement requires a resolvable directory only', () => {
    const open = createConfinement([]);
    expect(open.confine(process.cwd())).toBeDefined();
    expect(open.confine(path.join(os.tmpdir(), 'definitely-missing-dir'))).toBeUndefined();
  });
});

describe('authentication', () => {
  it('protected mode: 401 without a token, 403 with a wrong one, 200 with the right one', async () => {
    const server = createServer({ store: createStore(), token: 's3cret-token' });
    const port = await listen(server);

    const health = await request(port, 'GET', '/api/health');
    expect(health.status).toBe(200); // liveness stays open for orchestrators

    const missing = await request(port, 'GET', '/api/repositories');
    expect(missing.status).toBe(401);
    expect(missing.json.error).toMatch(/Authentication required/i);

    const wrong = await request(port, 'GET', '/api/repositories', undefined, { Authorization: 'Bearer not-the-token' });
    expect(wrong.status).toBe(403);
    expect(wrong.json.error).toMatch(/rejected/i);

    const right = await request(port, 'GET', '/api/repositories', undefined, { Authorization: 'Bearer s3cret-token' });
    expect(right.status).toBe(200);

    // Malformed scheme is treated as missing, never as a match.
    const malformed = await request(port, 'GET', '/api/repositories', undefined, { Authorization: 's3cret-token' });
    expect(malformed.status).toBe(401);

    await close(server);
  });

  it('without a token the server stays open (loopback-only deployments)', async () => {
    const server = createServer({ store: createStore() });
    const port = await listen(server);
    const res = await request(port, 'GET', '/api/repositories');
    expect(res.status).toBe(200);
    await close(server);
  });
});

describe('CORS', () => {
  const ALLOWED = 'http://dashboard.veylqorix.local';

  it('reflects an allowlisted origin exactly', async () => {
    const server = createServer({ store: createStore(), corsOrigins: [ALLOWED] });
    const port = await listen(server);
    const res = await request(port, 'GET', '/api/health', undefined, { Origin: ALLOWED });
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
    await close(server);
  });

  it('omits allow-origin for a disallowed origin (with Vary: Origin)', async () => {
    const server = createServer({ store: createStore(), corsOrigins: [ALLOWED] });
    const port = await listen(server);
    const res = await request(port, 'GET', '/api/health', undefined, { Origin: 'http://evil.example' });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['vary']).toContain('Origin');
    await close(server);
  });

  it('emits no CORS headers when the Origin header is absent', async () => {
    const server = createServer({ store: createStore(), corsOrigins: [ALLOWED] });
    const port = await listen(server);
    const res = await request(port, 'GET', '/api/health');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await close(server);
  });

  it('answers preflight for approved and rejected origins', async () => {
    const server = createServer({ store: createStore(), corsOrigins: [ALLOWED] });
    const port = await listen(server);
    const ok = await request(port, 'OPTIONS', '/api/repositories', undefined, { Origin: ALLOWED });
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(ok.headers['access-control-allow-headers']).toContain('Authorization');

    const bad = await request(port, 'OPTIONS', '/api/repositories', undefined, { Origin: 'http://evil.example' });
    expect(bad.status).toBe(204);
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    await close(server);
  });

  it('without a configured allowlist no origin ever gets allow-origin headers', async () => {
    const server = createServer({ store: createStore() });
    const port = await listen(server);
    const res = await request(port, 'GET', '/api/health', undefined, { Origin: ALLOWED });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await close(server);
  });
});

describe('resource limits', () => {
  it('rejects oversized request bodies with 413', async () => {
    const server = createServer({ store: createStore(), bodyLimitBytes: 128 });
    const port = await listen(server);
    const res = await request(port, 'POST', '/api/repositories', { path: 'x'.repeat(200) });
    expect(res.status).toBe(413);
    expect(res.json.error).toMatch(/size limit/i);
    await close(server);
  });

  it('rejects fields longer than the configured maximum with 400', async () => {
    const server = createServer({ store: createStore(), maxFieldLength: 8 });
    const port = await listen(server);
    const res = await request(port, 'POST', '/api/repositories', { path: '/tmp/a-really-long-repo-name' });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/maximum field length/i);
    await close(server);
  });

  it('rejects excess concurrent scans with 429 and never records a rejected scan', async () => {
    const server = createServer({
      store: createStore(),
      allowedRoots: [fixtures],
      maxConcurrentScans: 1,
      auditDefaults: { online: false },
    });
    const port = await listen(server);

    const register = await request(port, 'POST', '/api/repositories', { path: path.join(fixtures, 'secret-repo') });
    const repoId = register.json.repository.id as string;
    const first = await request(port, 'POST', '/api/scan', { repoId });
    expect(first.status).toBe(202);

    // While the first scan is in flight, the second must be rejected, not
    // queued or reported as started.
    const second = await request(port, 'POST', '/api/scan', { repoId });
    expect(second.status).toBe(429);
    expect(second.json.retryAfterSec).toBeGreaterThan(0);

    // Let the first scan drain, then a new scan is accepted again.
    let scan = await request(port, 'GET', `/api/scan/${first.json.scan.id}`);
    for (let i = 0; scan.json.status === 'RUNNING' && i < 60; i++) {
      await new Promise((r) => setTimeout(r, 200));
      scan = await request(port, 'GET', `/api/scan/${first.json.scan.id}`);
    }
    const third = await request(port, 'POST', '/api/scan', { repoId });
    expect(third.status).toBe(202);
    expect(third.json.scan.id).not.toBe(first.json.scan.id);
    await close(server);
  }, 60_000);

  it('returns safe JSON from the catch-all error handler', async () => {
    // A store whose read path throws must not leak a stack trace or internal
    // detail into the response.
    const broken: ApiStore = {
      listRepositories: () => {
        throw new Error('VEYLQORIX_INTERNAL_DETAIL leaked-secret-marker /var/secret');
      },
      getRepository: () => undefined,
      addRepository: () => {
        throw new Error('no');
      },
      listScans: () => [],
      getScan: () => undefined,
      putScan: () => undefined,
      latestScan: () => undefined,
      flush: () => undefined,
      isHealthy: () => true,
    };
    const server = createServer({ store: broken });
    const port = await listen(server);
    const res = await request(port, 'GET', '/api/repositories');
    expect(res.status).toBe(500);
    expect(res.json.error).toMatch(/Internal server error/i);
    expect(res.json.error).not.toContain('VEYLQORIX_INTERNAL_DETAIL');
    expect(res.json.error).not.toContain('leaked-secret-marker');
    expect(res.json.error).not.toContain('/var/secret');
    await close(server);
  });
});

describe('file-backed store (store.ts)', () => {
  function storeFile(name: string): string {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'veylqorix-store-')), name);
  }

  it('persists repositories and scans across reloads', () => {
    const file = storeFile('store.json');
    const first = createStore({ path: file });
    const repo = first.addRepository({ path: '/srv/repos/app', name: 'app' });
    const scan: ScanRecord = {
      id: 'scan-abc',
      repoId: repo.id,
      status: 'DONE',
      createdAt: '2026-01-01T00:00:00.000Z',
      exitCode: 0,
    };
    first.putScan(scan);
    first.putScan({ ...scan, id: 'scan-err', status: 'ERROR', error: 'blocked' });

    const second = createStore({ path: file });
    expect(second.listRepositories()).toHaveLength(1);
    expect(second.getScan('scan-abc')?.status).toBe('DONE');
    expect(second.getScan('scan-err')?.status).toBe('ERROR');
    // A failed scan must never read back as success.
    expect(second.latestScan(repo.id)?.id).toBe('scan-abc');
    expect(second.latestScan(repo.id)?.status).toBe('DONE');
    expect(second.latestScan(repo.id)?.error).toBeUndefined();
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it('recovers in-flight scans as INTERRUPTED, never as completed', () => {
    const file = storeFile('store.json');
    const file2 = file; // one file, two "processes"
    const first = createStore({ path: file2 });
    first.addRepository({ path: '/srv/repos/app', name: 'app' });
    first.putScan({
      id: 'scan-pending',
      repoId: first.listRepositories()[0]!.id,
      status: 'RUNNING',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const second = createStore({ path: file2 });
    const recovered = second.getScan('scan-pending')!;
    expect(recovered.status).toBe('INTERRUPTED');
    expect(recovered.error).toMatch(/interrupted/i);
    expect(recovered.status).not.toBe('DONE');
    // INTERRUPTED is recoverable: it never satisfies "latest completed scan".
    expect(second.latestScan(recovered.repoId)).toBeUndefined();
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it('fails closed on a corrupt or unreadable store file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veylqorix-store-'));
    const file = path.join(dir, 'store.json');
    fs.writeFileSync(file, '{ not json');
    expect(() => createStore({ path: file })).toThrow(/corrupt/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('wires the file store into the HTTP API end to end', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veylqorix-store-'));
    const file = path.join(dir, 'store.json');
    const server = createApi({ store: createStore({ path: file }), auditDefaults: { online: false } });
    const port = await listen(server.server);
    const reg = await request(port, 'POST', '/api/repositories', { path: path.join(fixtures, 'clean-repo') });
    expect(reg.status).toBe(201);
    await server.shutdown(0);

    // Reload: the registration survives the restart.
    const reloaded = createStore({ path: file });
    expect(reloaded.listRepositories()).toHaveLength(1);
    expect(reloaded.listRepositories()[0]!.name).toContain('clean-repo');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports store health on /api/health', async () => {
    const server = createServer({ store: createStore() });
    const port = await listen(server);
    const res = await request(port, 'GET', '/api/health');
    expect(res.json.store).toBe(true);
    await close(server);
  });
});
