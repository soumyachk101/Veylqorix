/**
 * Veylqorix API client (browser).
 *
 * In development the Next.js dev server proxies `/api/*` to the Veylqorix API
 * (see `rewrites` in next.config.mjs, driven by `VEYLQORIX_API_BASE`, default
 * `http://localhost:4173`), so relative URLs work. In any deployment where the
 * API is not behind the app's own origin, set `NEXT_PUBLIC_API_BASE` to point
 * the browser directly at the API (CORS is enabled on the server: `*`).
 */
import type {
  Finding,
  Policy,
  RepoLatest,
  Repository,
  ScanDetail,
  ScanRecordSummary,
} from './types';

/**
 * Browser-side base for API requests.
 *
 * - `NEXT_PUBLIC_API_BASE` (set at build time) always wins — use it when the
 *   app and API live on different origins and no proxy is in front.
 * - Otherwise the browser talks to the same origin: in dev, the Next.js dev
 *   server proxies `/api/*` to the Veylqorix API (see `rewrites` in
 *   next.config.mjs, default `http://localhost:4173`), and a deployed app
 *   behind a gateway does the same. `empty string = same origin`.
 */
export function apiBase(): string {
  return (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_BASE) || '';
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const detail =
      body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : res.statusText;
    throw new ApiError(detail, res.status);
  }
  return body as T;
}

export interface Health {
  ok: boolean;
  time: string;
}

export async function getHealth(): Promise<Health> {
  return request<Health>('/api/health');
}

export async function listRepositories(): Promise<Repository[]> {
  const data = await request<{ repositories: Repository[] }>('/api/repositories');
  return data.repositories;
}

export async function addRepository(path: string, name?: string): Promise<Repository> {
  const data = await request<{ repository: Repository }>('/api/repositories', {
    method: 'POST',
    body: JSON.stringify(name ? { path, name } : { path }),
  });
  return data.repository;
}

export interface StartScan {
  id: string;
  repoId: string;
  status: string;
}

/** Start a scan by registered repo, or ad-hoc by filesystem path. */
export async function startScan(repoId?: string, path?: string): Promise<StartScan> {
  const body: Record<string, string> = {};
  if (repoId) body.repoId = repoId;
  else if (path) body.path = path;
  const data = await request<{ scan: StartScan }>('/api/scan', { method: 'POST', body: JSON.stringify(body) });
  return data.scan;
}

export async function getScan(id: string): Promise<ScanDetail> {
  return request<ScanDetail>(`/api/scan/${encodeURIComponent(id)}`);
}

export async function getScanFindings(id: string): Promise<{ status: string; findings: Finding[] }> {
  return request<{ status: string; findings: Finding[] }>(`/api/scan/${encodeURIComponent(id)}/findings`);
}

/** Report endpoint: format is markdown | json | sarif. */
export async function getScanReport(id: string, format: 'markdown' | 'json' | 'sarif' = 'markdown'): Promise<string> {
  const res = await fetch(`${apiBase()}/api/scan/${encodeURIComponent(id)}/report?format=${format}`);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body && typeof body === 'object' && 'error' in body) detail = String(body.error);
    } catch {
      /* keep statusText */
    }
    throw new ApiError(detail, res.status);
  }
  return res.text();
}

export async function getLatest(repoId: string): Promise<RepoLatest> {
  return request<RepoLatest>(`/api/repo/${encodeURIComponent(repoId)}/latest`);
}

export async function getHistory(repoId: string): Promise<{
  repository: Repository;
  history: ScanRecordSummary[];
}> {
  return request<{ repository: Repository; history: ScanRecordSummary[] }>(
    `/api/repo/${encodeURIComponent(repoId)}/history`
  );
}

/**
 * Effective policy attached to a scan result, with the workspace default
 * policy (mirrors `veylqorix-policy.json` and the engine's DEFAULT_POLICY)
 * as a fallback when the API is unreachable or the scan predates the field.
 */
export const DEFAULT_POLICY: Policy = {
  blockOnSeverity: ['CRITICAL', 'HIGH'],
  blockOnSecrets: true,
  blockOnTestFailure: true,
  blockOnScannerError: true,
  blockOnSkippedCheck: true,
  reportOnSeverity: ['MEDIUM', 'LOW'],
  maxExceptions: 5,
  exceptions: [],
};
