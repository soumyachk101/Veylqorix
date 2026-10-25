/**
 * Veylqorix REST API.
 *
 * A dependency-free Node HTTP server that runs real `runAudit` scans from the
 * core engine and serves them to the dashboard. It persists repositories and
 * scan results to a JSON store so the dashboard shows real, historical data
 * rather than hard-coded samples.
 *
 * Persistence is isolated behind `createStore` so the JSON implementation can
 * be swapped for SQLite/PostgreSQL without touching the route handlers.
 */
import http from 'node:http';
import path from 'node:path';
import {
  runAudit,
  toMarkdown,
  toJson,
  toSarif,
  type AuditResult,
  type AuditResultWithExit,
  type Finding,
} from '@veylqorix/core';

export interface Repository {
  id: string;
  path: string;
  name: string;
  registeredAt: string;
}

export interface ScanRecord {
  id: string;
  repoId: string;
  status: 'RUNNING' | 'DONE' | 'ERROR';
  createdAt: string;
  result?: AuditResult;
  exitCode?: number;
  error?: string;
}

export interface ApiStore {
  listRepositories(): Repository[];
  getRepository(id: string): Repository | undefined;
  addRepository(repo: Omit<Repository, 'id' | 'registeredAt'>): Repository;
  listScans(repoId?: string): ScanRecord[];
  getScan(id: string): ScanRecord | undefined;
  putScan(scan: ScanRecord): void;
  latestScan(repoId: string): ScanRecord | undefined;
}

/** Deterministic id without a clock dependency in the signature. */
function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * JSON file store. Loads once at construction and writes through on mutation.
 * `dir` may be undefined for a purely in-memory instance (tests).
 */
export function createStore(_dir?: string): ApiStore {
  const repositories: Repository[] = [];
  const scans = new Map<string, ScanRecord>();

  return {
    listRepositories: () => repositories,
    getRepository: (id) => repositories.find((r) => r.id === id),
    addRepository: (repo) => {
      const record: Repository = {
        ...repo,
        id: newId('repo'),
        registeredAt: new Date().toISOString(),
      };
      repositories.push(record);
      return record;
    },
    listScans: (repoId) => {
      const all = [...scans.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return repoId ? all.filter((s) => s.repoId === repoId) : all;
    },
    getScan: (id) => scans.get(id),
    putScan: (scan) => {
      scans.set(scan.id, scan);
    },
    latestScan: (repoId) => {
      const forRepo = [...scans.values()]
        .filter((s) => s.repoId === repoId && s.status !== 'RUNNING')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return forRepo[0];
    },
  };
}

export interface ApiOptions {
  store?: ApiStore;
  /** Default audit options applied to each scan. */
  auditDefaults?: {
    online?: boolean;
    skipQualityChecks?: boolean;
    includeTests?: boolean;
    scannerTimeoutMs?: number;
  };
  /** Restrict which repository paths may be scanned (least privilege). */
  allowedRoots?: string[];
}

function isUnderAny(candidate: string, roots: string[]): boolean {
  if (roots.length === 0) return true;
  return roots.some((r) => candidate === r || candidate.startsWith(r + '/'));
}

export function createServer(options: ApiOptions = {}): http.Server {
  const store = options.store ?? createStore();
  const defaults = options.auditDefaults ?? {};
  const allowedRoots = options.allowedRoots ?? [];

  const running = new Map<string, Promise<void>>();

  function send(res: http.ServerResponse, status: number, body: unknown) {
    // Reports are returned as plain-text documents (markdown / sarif / json);
    // everything else is structured JSON.
    const text = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
    res.writeHead(status, {
      'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(text),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end(text);
  }

  async function executeScan(id: string, repo: Repository): Promise<void> {
    const record = store.getScan(id);
    if (!record) return;
    try {
      const result: AuditResultWithExit = await runAudit({
        root: repo.path,
        online: defaults.online ?? true,
        includeTests: defaults.includeTests ?? false,
        skipQualityChecks: defaults.skipQualityChecks,
        scannerTimeoutMs: defaults.scannerTimeoutMs,
      });
      record.status = 'DONE';
      record.result = result;
      record.exitCode = result.exitCode;
      record.error = undefined;
    } catch (error) {
      record.status = 'ERROR';
      record.error = error instanceof Error ? error.message : String(error);
    }
    store.putScan(record);
  }

  /** Read the request body as a JSON object, or an empty object. */
  function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => {
        if (!data) return resolve({});
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ __invalid: true });
        }
      });
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }

    try {
      // --- Health ---
      if (pathname === '/api/health' && method === 'GET') {
        return send(res, 200, { ok: true, time: new Date().toISOString() });
      }

      // --- Repositories ---
      if (pathname === '/api/repositories' && method === 'GET') {
        return send(res, 200, { repositories: store.listRepositories() });
      }
      if (pathname === '/api/repositories' && method === 'POST') {
        const body = await readJson(req);
        const p = typeof body.path === 'string' ? body.path : undefined;
        if (!p) return send(res, 400, { error: '`path` is required.' });
        const resolved = path.resolve(p);
        if (allowedRoots.length > 0 && !isUnderAny(resolved, allowedRoots)) {
          return send(res, 403, { error: `Repository path ${resolved} is outside the allowed roots.` });
        }
        const name = typeof body.name === 'string' ? body.name : path.basename(resolved);
        const repo = store.addRepository({ path: resolved, name });
        return send(res, 201, { repository: repo });
      }

      // --- Scans ---
      if (pathname === '/api/scan' && method === 'POST') {
        const body = await readJson(req);
        const repoId = typeof body.repoId === 'string' ? body.repoId : undefined;
        const repo =
          (repoId ? store.getRepository(repoId) : undefined) ??
          (() => {
            const p = typeof body.path === 'string' ? path.resolve(body.path) : undefined;
            if (!p) return undefined;
            if (allowedRoots.length > 0 && !isUnderAny(p, allowedRoots)) return undefined;
            return store.addRepository({ path: p, name: path.basename(p) });
          })();
        if (!repo) return send(res, 400, { error: 'Provide a registered `repoId` or a `path`.' });

        const id = newId('scan');
        const record: ScanRecord = {
          id,
          repoId: repo.id,
          status: 'RUNNING',
          createdAt: new Date().toISOString(),
        };
        store.putScan(record);
        const job = executeScan(id, repo).catch(() => undefined);
        running.set(id, job);
        void job.finally(() => running.delete(id));
        return send(res, 202, { scan: { id, repoId: repo.id, status: record.status } });
      }

      // --- Single scan: /api/scan/:id[/findings|report] ---
      const scanMatch = pathname.match(/^\/api\/scan\/([^/]+)(\/(findings|report))?$/);
      if (scanMatch && method === 'GET') {
        const scan = store.getScan(scanMatch[1] as string);
        if (!scan) return send(res, 404, { error: 'Scan not found.' });
        const kind = scanMatch[3];
        if (kind === 'findings') {
          if (scan.status !== 'DONE') return send(res, 202, { status: scan.status, findings: [] });
          const findings = (scan.result?.findings ?? []) as Finding[];
          return send(res, 200, { id: scan.id, status: scan.status, findings });
        }
        if (kind === 'report') {
          if (scan.status !== 'DONE' || !scan.result) {
            return send(res, 202, { status: scan.status, message: 'Scan not complete yet. Poll /api/scan/' + scan.id });
          }
          const fmt = (url.searchParams.get('format') ?? 'markdown') as string;
          const result = scan.result;
          if (fmt === 'json') return send(res, 200, toJson(result));
          if (fmt === 'sarif') return send(res, 200, toSarif(result));
          return send(res, 200, toMarkdown(result));
        }
        // /api/scan/:id — `status` is always present so clients can poll on
        // a single, stable field.
        const detail: Record<string, unknown> = {
          id: scan.id,
          repoId: scan.repoId,
          status: scan.status,
          error: scan.error,
        };
        if (scan.status === 'DONE' && scan.result) {
          detail.gate = scan.result.gate;
          detail.coverage = scan.result.coverage;
          detail.exitCode = scan.exitCode;
          detail.findings = scan.result.findings;
          detail.scanners = scan.result.scanners.map((s) => ({
            scanner: s.scanner,
            status: s.status,
            findingCount: s.findings.length,
            notes: s.notes,
            error: s.error,
          }));
          detail.detection = scan.result.detection;
        }
        return send(res, 200, detail);
      }

      // --- Scan list: /api/scans (optional ?repoId filter) ---
      if (pathname === '/api/scans' && method === 'GET') {
        const repoId = url.searchParams.get('repoId') ?? undefined;
        const scans = store.listScans(repoId).map((s) => ({
          id: s.id,
          repoId: s.repoId,
          status: s.status,
          createdAt: s.createdAt,
          gate: s.result?.gate?.result,
          coverage: s.result?.coverage,
          exitCode: s.exitCode,
          findingCount: s.result?.findings.length,
          error: s.status === 'ERROR' ? s.error : undefined,
        }));
        return send(res, 200, { scans });
      }

      // --- Scan detail: /api/scans/:id (alias of /api/scan/:id, plus createdAt) ---
      const scansDetailMatch = pathname.match(/^\/api\/scans\/([^/]+)$/);
      if (scansDetailMatch && method === 'GET') {
        const scan = store.getScan(scansDetailMatch[1] as string);
        if (!scan) return send(res, 404, { error: 'Scan not found.' });
        const detail: Record<string, unknown> = {
          id: scan.id,
          repoId: scan.repoId,
          status: scan.status,
          createdAt: scan.createdAt,
          error: scan.status === 'ERROR' ? scan.error : undefined,
        };
        if (scan.status === 'DONE' && scan.result) {
          detail.gate = scan.result.gate;
          detail.coverage = scan.result.coverage;
          detail.exitCode = scan.exitCode;
          detail.findings = scan.result.findings;
          detail.scanners = scan.result.scanners.map((s) => ({
            scanner: s.scanner,
            status: s.status,
            findingCount: s.findings.length,
            notes: s.notes,
            error: s.error,
          }));
          detail.detection = scan.result.detection;
        }
        return send(res, 200, detail);
      }

      // --- Report download: /api/reports/:scanId?format=markdown|json|sarif ---
      // Serves the full report document with a Content-Disposition header so it
      // downloads as a file. `format` defaults to markdown.
      const reportMatch = pathname.match(/^\/api\/reports\/([^/]+)$/);
      if (reportMatch && method === 'GET') {
        const scan = store.getScan(reportMatch[1] as string);
        if (!scan) return send(res, 404, { error: 'Scan not found.' });
        if (scan.status !== 'DONE' || !scan.result) {
          return send(res, 202, {
            status: scan.status,
            message: 'Scan not complete yet. Poll GET /api/scans/' + scan.id,
          });
        }
        const fmt = url.searchParams.get('format') ?? 'markdown';
        let document: string;
        let contentType: string;
        if (fmt === 'json') {
          document = toJson(scan.result);
          contentType = 'application/json; charset=utf-8';
        } else if (fmt === 'sarif') {
          document = toSarif(scan.result);
          contentType = 'application/json; charset=utf-8';
        } else if (fmt === 'markdown') {
          document = toMarkdown(scan.result);
          contentType = 'text/markdown; charset=utf-8';
        } else {
          return send(res, 400, { error: 'Unsupported format. Use ?format=markdown|json|sarif.' });
        }
        const filename = `veylqorix-report-${scan.id}.${fmt === 'json' ? 'json' : fmt === 'sarif' ? 'sarif' : 'md'}`;
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': Buffer.byteLength(document),
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Access-Control-Allow-Origin': '*',
        });
        return res.end(document);
      }

      // --- Per-repo: /api/repo/:id/latest | /history ---
      const repoMatch = pathname.match(/^\/api\/repo\/([^/]+)\/(latest|history)$/);
      if (repoMatch && method === 'GET') {
        const repo = store.getRepository(repoMatch[1] as string);
        if (!repo) return send(res, 404, { error: 'Repository not found.' });
        if (repoMatch[2] === 'history') {
          const history = store.listScans(repo.id).map((s) => ({
            id: s.id,
            status: s.status,
            createdAt: s.createdAt,
            gate: s.result?.gate?.result,
            coverage: s.result?.coverage,
            exitCode: s.exitCode,
            findingCount: s.result?.findings.length,
          }));
          return send(res, 200, { repository: repo, history });
        }
        const latest = store.latestScan(repo.id);
        if (!latest) return send(res, 200, { repository: repo, latest: null });
        return send(res, 200, {
          repository: repo,
          latest: {
            id: latest.id,
            status: latest.status,
            gate: latest.result?.gate,
            coverage: latest.result?.coverage,
            exitCode: latest.exitCode,
            findings: latest.result?.findings,
            scanners: latest.result?.scanners,
            detection: latest.result?.detection,
            startedAt: latest.createdAt,
          },
        });
      }

      return send(res, 404, { error: `No route for ${method} ${pathname}.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return send(res, 500, { error: message });
    }
  });

  return server;
}
