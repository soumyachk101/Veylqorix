/**
 * Veylqorix REST API.
 *
 * A dependency-free Node HTTP server that runs real `runAudit` scans from the
 * core engine and serves them to the dashboard. It persists repositories and
 * scan results through the `ApiStore` interface, so the JSON file
 * implementation can be swapped for SQLite/PostgreSQL without touching the
 * route handlers.
 *
 * Security model (see docs/engineering/SECURITY_HARDENING.md):
 * - no token: loopback-only binding is enforced at startup (bin), which is
 *   safe because the API can read the configured roots;
 * - token configured: every /api route (except the liveness probe) requires a
 *   bearer token, checked with a timing-safe digest comparison;
 * - CORS: exact-origin allowlist only, no wildcard, no credentials;
 * - roots: candidate paths are confined to canonical roots (roots.ts), so a
 *   registration check cannot be bypassed by a later scan.
 */
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import {
  runAudit,
  toMarkdown,
  toJson,
  toSarif,
  type AuditResultWithExit,
  type Finding,
} from '@veylqorix/core';
import {
  createStore,
  STORE_SCHEMA_VERSION,
  type Repository,
  type ScanRecord,
  type ScanStatus,
  type ApiStore,
  type JsonStoreOptions,
} from './store.js';
import { initializeRoots, createConfinement, type RootConfinement } from './roots.js';

export { createStore, STORE_SCHEMA_VERSION };
export type { Repository, ScanRecord, ScanStatus, ApiStore, JsonStoreOptions, RootConfinement };
export { initializeRoots, createConfinement };

/** Structured log sink. Must never receive Authorization headers or tokens. */
export type LogSink = (event: Record<string, unknown>) => void;

/** Default: structured JSON lines on stdout; nothing sensitive is logged. */
function defaultLog(event: Record<string, unknown>): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), ...event }));
}

export interface ApiOptions {
  store?: ApiStore;
  /** Default audit options applied to each scan. */
  auditDefaults?: {
    online?: boolean;
    skipQualityChecks?: boolean;
    includeTests?: boolean;
    /** Pass-through to the engine's per-scanner wall-clock budget. */
    scannerTimeoutMs?: number;
  };
  /**
   * Restrict which repository paths may be scanned (least privilege).
   * When non-empty every root is canonicalized and verified at construction
   * time; an invalid root throws (fail closed).
   */
  allowedRoots?: string[];
  /**
   * Bearer token. When set, the server is in protected mode: /api routes
   * reject requests without it (401) or with a wrong one (403). The token
   * itself is never written to logs or responses.
   */
  token?: string;
  /** Exact origins allowed by CORS. Empty means no CORS headers are emitted. */
  corsOrigins?: string[];
  /** Bounded concurrent scans; excess requests are rejected with 429. */
  maxConcurrentScans?: number;
  /** Maximum JSON request body in bytes. */
  bodyLimitBytes?: number;
  /** Maximum accepted length of the `path`/`name`/`repoId` fields. */
  maxFieldLength?: number;
  log?: LogSink;
}

/** Default limits. Sensible for a local audit tool, not a public gateway. */
export const DEFAULT_MAX_CONCURRENT_SCANS = 2;
export const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;
export const DEFAULT_MAX_FIELD_LENGTH = 4096;

/** Deterministic id without a clock dependency in the signature. */
function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Timing-safe token check. SHA-256 digests are always 32 bytes, so
 * `timingSafeEqual` runs on equal-length digests and no length difference can
 * be observed by the caller.
 */
function tokenMatches(provided: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Build the CORS headers for one request. Returns undefined when the request
 * carries no Origin header (no CORS headers at all: same-origin and
 * non-browser clients stay open-safe) or when no allowlist is configured.
 */
function corsHeaders(origin: string | undefined, allowlist: string[]): Record<string, string> | undefined {
  if (!origin || allowlist.length === 0) return undefined;
  const headers: Record<string, string> = { Vary: 'Origin' };
  if (allowlist.includes(origin)) {
    // Exact reflection only: never a wildcard, and never with credentials.
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    headers['Access-Control-Max-Age'] = '86400';
  }
  // Disallowed origins get Vary: Origin and no Allow-Origin header, which is
  // the standards-safe way to deny without advertising the endpoint.
  return headers;
}

export interface ApiHandle {
  server: http.Server;
  store: ApiStore;
  confinement: RootConfinement;
  /** Stop accepting connections, drain in-flight scans, flush the store. */
  shutdown(timeoutMs?: number): Promise<void>;
}

/** Route ids are decoded once; a malformed %-escape must 404, not 500. */
function decodeId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function createApi(options: ApiOptions = {}): ApiHandle {
  const store = options.store ?? createStore();
  const defaults = options.auditDefaults ?? {};
  const log: LogSink = options.log ?? defaultLog;
  const maxConcurrent = options.maxConcurrentScans ?? DEFAULT_MAX_CONCURRENT_SCANS;
  const bodyLimit = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES;
  const maxField = options.maxFieldLength ?? DEFAULT_MAX_FIELD_LENGTH;
  const token = options.token;
  const protectedMode = Boolean(token);
  const corsOrigins = options.corsOrigins ?? [];

  // Fail closed at startup: configured roots must be real directories.
  const confinement: RootConfinement =
    (options.allowedRoots?.length ?? 0) > 0
      ? initializeRoots(options.allowedRoots ?? [])
      : createConfinement([]);

  const running = new Map<string, Promise<void>>();

  function send(res: http.ServerResponse, status: number, body: unknown, origin?: string | null, extra?: Record<string, string>) {
    // Reports are returned as plain-text documents (markdown / sarif / json);
    // everything else is structured JSON.
    const text = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
    const headers: Record<string, string> = {
      'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(text)),
    };
    const cors = corsHeaders(origin ?? undefined, corsOrigins);
    if (cors) Object.assign(headers, cors);
    if (extra) Object.assign(headers, extra);
    res.writeHead(status, headers);
    res.end(text);
  }

  function sendCorsOptions(req: http.IncomingMessage, res: http.ServerResponse): void {
    const headers: Record<string, string> = {};
    const cors = corsHeaders(req.headers.origin, corsOrigins);
    if (cors) Object.assign(headers, cors);
    res.writeHead(204, headers);
    res.end();
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

  type BodyParse =
    | { ok: true; body: Record<string, unknown> }
    | { ok: false; status: number; message: string };

  /**
   * Read the request body as a JSON object, or an empty object. Past the byte
   * limit, extra data is accepted but discarded; the 413 is answered once the
   * client has finished sending, so the response reaches it on the same
   * socket.
   */
  function readJson(req: http.IncomingMessage): Promise<BodyParse> {
    return new Promise((resolve) => {
      let data = '';
      let overLimit = false;
      req.on('data', (chunk: Buffer) => {
        if (overLimit) return; // still drain the socket, but never buffer it
        data += chunk.toString();
        if (data.length > bodyLimit) overLimit = true;
      });
      req.on('end', () => {
        if (overLimit) {
          return resolve({ ok: false, status: 413, message: 'Request body exceeds the size limit.' });
        }
        if (!data) return resolve({ ok: true, body: {} });
        try {
          const parsed: unknown = JSON.parse(data);
          resolve({
            ok: true,
            body: parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { __invalid: true },
          });
        } catch {
          resolve({ ok: true, body: { __invalid: true } });
        }
      });
      req.on('error', () => resolve({ ok: false, status: 400, message: 'Failed to read request body.' }));
    });
  }

  /**
   * Bearer-token gate. Returns null when the request is authorized, otherwise
   * a ready-to-send rejection (401 missing/malformed, 403 wrong token).
   */
  function authGate(req: http.IncomingMessage): { status: number; body: Record<string, unknown> } | null {
    if (!protectedMode) return null;
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.toLowerCase().startsWith('bearer ')) {
      return { status: 401, body: { error: 'Authentication required. Provide a bearer token (Authorization: Bearer <token>).' } };
    }
    const provided = header.slice(7).trim();
    if (!tokenMatches(provided, token as string)) {
      // Distinguish "wrong" from "missing" without echoing either value.
      return { status: 403, body: { error: 'The provided token was rejected.' } };
    }
    return null;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;
    const method = req.method ?? 'GET';
    const origin = req.headers.origin ?? null;

    if (method === 'OPTIONS') {
      // Preflight is answered before authentication: browsers send it
      // without the Authorization header, so it must be CORS-shape only.
      return sendCorsOptions(req, res);
    }

    // Structured, redacted logging: the request line, never the headers.
    log({ event: 'request', method, path: pathname, query: url.search || undefined });

    // Liveness probe stays open so orchestrators can probe a protected API.
    if (pathname === '/api/health' && method === 'GET') {
      return send(res, 200, {
        ok: true,
        store: store.isHealthy(),
        schemaVersion: STORE_SCHEMA_VERSION,
        time: new Date().toISOString(),
      }, origin);
    }

    const denied = authGate(req);
    if (denied) {
      log({ event: 'auth_denied', path: pathname, status: denied.status });
      return send(res, denied.status, denied.body, origin);
    }

    try {
      // --- Repositories ---
      if (pathname === '/api/repositories' && method === 'GET') {
        return send(res, 200, { repositories: store.listRepositories() }, origin);
      }
      if (pathname === '/api/repositories' && method === 'POST') {
        const parsed = await readJson(req);
        if (!parsed.ok) {
          return send(res, parsed.status, { error: parsed.message }, origin);
        }
        const body = parsed.body;
        const p = typeof body.path === 'string' ? body.path : undefined;
        if (!p) return send(res, 400, { error: '`path` is required.' }, origin);
        if (p.length > maxField) {
          return send(res, 400, { error: '`path` exceeds the maximum field length.' }, origin);
        }
        const name = typeof body.name === 'string' ? body.name : path.basename(p);
        if (name.length > maxField) {
          return send(res, 400, { error: '`name` exceeds the maximum field length.' }, origin);
        }
        const confined = confinement.confine(p);
        if (confined === undefined) {
          // No filesystem detail: the message is safe to surface to a client.
          return send(
            res,
            403,
            confinement.roots.length > 0
              ? { error: 'Repository path is outside the allowed roots, or the path does not resolve to a usable directory.' }
              : { error: 'Repository path does not resolve to a usable directory.' },
            origin,
          );
        }
        const repo = store.addRepository({ path: confined, name });
        log({ event: 'repository_added', id: repo.id });
        return send(res, 201, { repository: repo }, origin);
      }

      // --- Scans ---
      if (pathname === '/api/scan' && method === 'POST') {
        const parsed = await readJson(req);
        if (!parsed.ok) {
          return send(res, parsed.status, { error: parsed.message }, origin);
        }
        const body = parsed.body;
        let repo: Repository | undefined;
        if (typeof body.repoId === 'string') {
          if (body.repoId.length > maxField) {
            return send(res, 400, { error: '`repoId` exceeds the maximum field length.' }, origin);
          }
          repo = store.getRepository(body.repoId);
        }
        if (!repo && typeof body.path === 'string') {
          if (body.path.length > maxField) {
            return send(res, 400, { error: '`path` exceeds the maximum field length.' }, origin);
          }
          const confined = confinement.confine(body.path);
          if (confined === undefined) {
            // The same canonical containment gate as registration: a path
            // that cleared /api/repositories cannot be bypassed here, and
            // nothing about the tree is leaked.
            return send(res, 403, { error: 'Path is outside the allowed roots, or does not resolve to a usable directory.' }, origin);
          }
          repo = store.addRepository({ path: confined, name: path.basename(confined) });
        }
        if (!repo) return send(res, 400, { error: 'Provide a registered `repoId` or a `path`.' }, origin);

        // Bounded concurrency: a rejected scan must never be reported as a
        // started one. The 429 (with a short retry hint) is the contract.
        if (running.size >= maxConcurrent) {
          log({ event: 'scan_rejected', repoId: repo.id, reason: 'concurrency_limit' });
          return send(res, 429, { error: 'Concurrent scan limit reached. Retry shortly.', retryAfterSec: 5 }, origin);
        }

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
        log({ event: 'scan_started', id, repoId: repo.id });
        return send(res, 202, { scan: { id, repoId: repo.id, status: record.status } }, origin);
      }

      // --- Single scan: /api/scan/:id[/findings|report] ---
      const scanMatch = pathname.match(/^\/api\/scan\/([^/]+)(\/(findings|report))?$/);
      if (scanMatch && method === 'GET') {
        const scan = store.getScan(decodeId(scanMatch[1] as string));
        if (!scan) return send(res, 404, { error: 'Scan not found.' }, origin);
        const kind = scanMatch[3];
        if (kind === 'findings') {
          if (scan.status !== 'DONE') return send(res, 202, { status: scan.status, findings: [] }, origin);
          const findings = (scan.result?.findings ?? []) as Finding[];
          return send(res, 200, { id: scan.id, status: scan.status, findings }, origin);
        }
        if (kind === 'report') {
          if (scan.status !== 'DONE' || !scan.result) {
            return send(res, 202, { status: scan.status, message: 'Scan not complete yet. Poll /api/scan/' + scan.id }, origin);
          }
          const fmt = (url.searchParams.get('format') ?? 'markdown') as string;
          const result = scan.result;
          if (fmt === 'json') return send(res, 200, toJson(result), origin);
          if (fmt === 'sarif') return send(res, 200, toSarif(result), origin);
          return send(res, 200, toMarkdown(result), origin);
        }
        // /api/scan/:id — `status` is always present so clients can poll on
        // a single, stable field.
        const detail: Record<string, unknown> = {
          id: scan.id,
          repoId: scan.repoId,
          status: scan.status,
          error: scan.status === 'ERROR' || scan.status === 'INTERRUPTED' ? scan.error : undefined,
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
        return send(res, 200, detail, origin);
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
          error: s.status === 'ERROR' || s.status === 'INTERRUPTED' ? s.error : undefined,
        }));
        return send(res, 200, { scans }, origin);
      }

      // --- Scan detail: /api/scans/:id (alias of /api/scan/:id, plus createdAt) ---
      const scansDetailMatch = pathname.match(/^\/api\/scans\/([^/]+)$/);
      if (scansDetailMatch && method === 'GET') {
        const scan = store.getScan(decodeId(scansDetailMatch[1] as string));
        if (!scan) return send(res, 404, { error: 'Scan not found.' }, origin);
        const detail: Record<string, unknown> = {
          id: scan.id,
          repoId: scan.repoId,
          status: scan.status,
          createdAt: scan.createdAt,
          error: scan.status === 'ERROR' || scan.status === 'INTERRUPTED' ? scan.error : undefined,
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
        return send(res, 200, detail, origin);
      }

      // --- Report download: /api/reports/:scanId?format=markdown|json|sarif ---
      // Serves the full report document with a Content-Disposition header so it
      // downloads as a file. `format` defaults to markdown.
      const reportMatch = pathname.match(/^\/api\/reports\/([^/]+)$/);
      if (reportMatch && method === 'GET') {
        const scan = store.getScan(decodeId(reportMatch[1] as string));
        if (!scan) return send(res, 404, { error: 'Scan not found.' }, origin);
        if (scan.status !== 'DONE' || !scan.result) {
          return send(res, 202, {
            status: scan.status,
            message: 'Scan not complete yet. Poll GET /api/scans/' + scan.id,
          }, origin);
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
          return send(res, 400, { error: 'Unsupported format. Use ?format=markdown|json|sarif.' }, origin);
        }
        const filename = `veylqorix-report-${scan.id}.${fmt === 'json' ? 'json' : fmt === 'sarif' ? 'sarif' : 'md'}`;
        const extra: Record<string, string> = {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${filename}"`,
        };
        return send(res, 200, document, origin, extra);
      }

      // --- Per-repo: /api/repo/:id/latest | /history ---
      const repoMatch = pathname.match(/^\/api\/repo\/([^/]+)\/(latest|history)$/);
      if (repoMatch && method === 'GET') {
        const repo = store.getRepository(decodeId(repoMatch[1] as string));
        if (!repo) return send(res, 404, { error: 'Repository not found.' }, origin);
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
          return send(res, 200, { repository: repo, history }, origin);
        }
        const latest = store.latestScan(repo.id);
        if (!latest) return send(res, 200, { repository: repo, latest: null }, origin);
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
        }, origin);
      }

      // Catch-all for unknown routes: structured, safe JSON.
      return send(res, 404, { error: `No route for ${method} ${pathname}.` }, origin);
    } catch (error) {
      // Catch-all error handler: safe JSON error. Full error detail goes to
      // the structured log only; the response carries no stack trace, no
      // config, and no internal paths.
      log({ event: 'request_failed', path: pathname, level: 'error', message: error instanceof Error ? error.message : String(error) });
      return send(res, 500, { error: 'Internal server error. See the Veylqorix API server log for details.' }, origin);
    }
  });

  /**
   * Graceful shutdown: stop accepting connections, drain in-flight scans
   * (bounded), then flush the store. Scans still running when the timeout
   * elapses stay RUNNING in the store and are re-stamped INTERRUPTED on the
   * next start — never lost as "completed".
   */
  async function shutdown(timeoutMs = 30_000): Promise<void> {
    log({ event: 'shutdown_started', inFlight: running.size });
    server.close(() => undefined); // stop accepting; keep-alive connections drain
    const jobs = [...running.values()];
    if (jobs.length > 0) {
      await Promise.race([
        Promise.allSettled(jobs),
        new Promise<void>((r) => setTimeout(r, timeoutMs).unref()),
      ]);
    }
    store.flush();
    log({ event: 'shutdown_complete' });
  }

  return { server, store, confinement, shutdown };
}

/** Pre-hardening shape for existing callers: the raw http.Server. */
export function createServer(options: ApiOptions = {}): http.Server {
  return createApi(options).server;
}
