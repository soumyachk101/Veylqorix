import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  addRepository,
  getHealth,
  getLatest,
  getScan,
  listRepositories,
  startScan,
} from './api';

function mockFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (_input: string | URL | Request) => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getHealth', () => {
  it('GETs /api/health and returns the payload', async () => {
    const m = mockFetch(200, { ok: true, time: 'now' });
    const h = await getHealth();
    expect(h.ok).toBe(true);
    expect(String(m.mock.calls[0]![0])).toContain('/api/health');
  });

  it('throws ApiError with the server error message', async () => {
    mockFetch(500, { error: 'boom' });
    await expect(getHealth()).rejects.toMatchObject({ status: 500, message: 'boom' });
  });
});

describe('listRepositories / addRepository', () => {
  it('unwraps the repositories list', async () => {
    mockFetch(200, { repositories: [{ id: 'r1', path: '/x', name: 'x', registeredAt: '' }] });
    const repos = await listRepositories();
    expect(repos).toHaveLength(1);
    expect(repos[0]!.id).toBe('r1');
  });

  it('POSTs {path, name} when a name is given and {path} otherwise', async () => {
    const m = mockFetch(201, { repository: { id: 'r2', path: '/y', name: 'y', registeredAt: '' } });
    await addRepository('/y', 'y');
    await addRepository('/z');
    const first = JSON.parse(String((m.mock.calls[0]![1] as RequestInit).body));
    const second = JSON.parse(String((m.mock.calls[1]![1] as RequestInit).body));
    expect(first).toEqual({ path: '/y', name: 'y' });
    expect(second).toEqual({ path: '/z' });
  });
});

describe('startScan', () => {
  it('POSTs repoId when provided, path when only a path is provided', async () => {
    const m = mockFetch(202, { scan: { id: 's1', repoId: 'r1', status: 'RUNNING' } });
    const byRepo = await startScan('r1');
    expect(byRepo.id).toBe('s1');
    const byPath = await startScan(undefined, '/some/path');
    expect(byPath.repoId).toBe('r1');
    const body1 = JSON.parse(String((m.mock.calls[0]![1] as RequestInit).body));
    const body2 = JSON.parse(String((m.mock.calls[1]![1] as RequestInit).body));
    expect(body1).toEqual({ repoId: 'r1' });
    expect(body2).toEqual({ path: '/some/path' });
  });
});

describe('getScan / getLatest', () => {
  it('URL-encodes ids in paths', async () => {
    const m = mockFetch(200, { id: 'a/b', status: 'DONE' });
    await getScan('a/b');
    expect(String(m.mock.calls[0]![0])).toContain('/api/scan/a%2Fb');
  });

  it('fetches the latest scan for a repo', async () => {
    const m = mockFetch(200, { repository: { id: 'r1' }, latest: null });
    const out = await getLatest('r1');
    expect(out.latest).toBeNull();
    expect(String(m.mock.calls[0]![0])).toContain('/api/repo/r1/latest');
  });
});

describe('ApiError', () => {
  it('carries the HTTP status', () => {
    const e = new ApiError('nope', 404);
    expect(e.message).toBe('nope');
    expect(e.status).toBe(404);
    expect(e).toBeInstanceOf(Error);
  });
});
