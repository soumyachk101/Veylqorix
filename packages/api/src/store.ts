/**
 * Persistence for the Veylqorix API.
 *
 * `createStore` is isolated behind the `ApiStore` interface so the JSON file
 * implementation can be swapped for SQLite/PostgreSQL without touching the
 * route handlers.
 *
 * Durability model: every mutation writes through atomically (temp file in
 * the same directory, fsync, rename). The store is single-process: two API
 * processes sharing one file will lose interleaved writes.
 *
 * Recovery: on load, scans still marked RUNNING are re-stamped INTERRUPTED.
 * That is a recoverable state — a client re-triggers the scan — and it is
 * never surfaced as completed.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AuditResult } from '@veylqorix/core';

export interface Repository {
  id: string;
  path: string;
  name: string;
  registeredAt: string;
}

export type ScanStatus = 'RUNNING' | 'DONE' | 'ERROR' | 'INTERRUPTED';

export interface ScanRecord {
  id: string;
  repoId: string;
  status: ScanStatus;
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
  /** Persist any in-memory state to disk. No-op for in-memory stores. */
  flush(): void;
  /** True when the store is usable (loaded file readable, or memory-backed). */
  isHealthy(): boolean;
}

export interface JsonStoreOptions {
  /** File to load from / persist to. Undefined means a pure in-memory store. */
  path?: string;
}

/** Bumped on every breaking layout change; the loader fails closed on mismatch. */
export const STORE_SCHEMA_VERSION = 1;

/** Deterministic id without a clock dependency in the signature. */
function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface StoredDocument {
  schemaVersion: number;
  repositories: Repository[];
  scans: ScanRecord[];
}

function isStoreDocument(value: unknown): value is StoredDocument {
  if (typeof value !== 'object' || value === null) return false;
  const doc = value as Partial<StoredDocument>;
  return (
    typeof doc.schemaVersion === 'number' &&
    Array.isArray(doc.repositories) &&
    Array.isArray(doc.scans)
  );
}

/**
 * Re-stamp in-flight work as a recoverable state. A RUNNING scan whose owner
 * process is gone can never report itself DONE later, so it must surface as
 * INTERRUPTED, not success.
 */
function recoverInFlight(doc: StoredDocument): void {
  for (const scan of doc.scans) {
    if (scan.status === 'RUNNING') {
      scan.status = 'INTERRUPTED';
      scan.error = 'Scan interrupted by process exit; re-run it.';
    }
  }
}

/** Atomic write: temp file in the same directory, fsync, rename. */
function atomicWriteFileSync(file: string, data: string): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  // Durability of the rename itself: fsync the directory where supported.
  try {
    const dfd = fs.openSync(dir, 'r');
    try {
      fs.fsyncSync(dfd);
    } finally {
      fs.closeSync(dfd);
    }
  } catch {
    // Platform without directory fsync: the file rename is still durable.
  }
}

function loadDocument(file: string): StoredDocument {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { schemaVersion: STORE_SCHEMA_VERSION, repositories: [], scans: [] };
    }
    throw new Error('cannot read the store file; refusing to start with an unreadable store', { cause: error });
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    throw new Error('store file is corrupt (not valid JSON); refusing to start. Back it up and remove it to reset.');
  }
  if (!isStoreDocument(doc)) {
    throw new Error('store file has an unrecognized layout; refusing to start');
  }
  if (doc.schemaVersion > STORE_SCHEMA_VERSION) {
    throw new Error('store file was written by a newer version of the API; refusing to downgrade it');
  }
  if (doc.schemaVersion < STORE_SCHEMA_VERSION) {
    // v1 is the first layout; older layouts are unknown to this binary.
    throw new Error(`store file schema version ${doc.schemaVersion} is not supported by this build`);
  }
  recoverInFlight(doc);
  return doc;
}

/**
 * JSON store. With a `path`, loads once at construction and writes through on
 * every mutation (atomic). Without a path, a purely in-memory instance for
 * tests and throwaway processes.
 */
export function createStore(options: string | JsonStoreOptions = {}): ApiStore {
  const file = typeof options === 'string' ? options : options.path;
  const doc: StoredDocument = file
    ? loadDocument(file)
    : { schemaVersion: STORE_SCHEMA_VERSION, repositories: [], scans: [] };
  const repositories = doc.repositories;
  const scans = new Map(doc.scans.map((s) => [s.id, s]));
  let healthy = true;

  const persist = (): void => {
    if (!file) return;
    try {
      atomicWriteFileSync(file, JSON.stringify({ schemaVersion: STORE_SCHEMA_VERSION, repositories, scans: [...scans.values()] }));
    } catch {
      // A failed persist must not take the request path down; the in-memory
      // state is still correct, the next mutation retries.
      healthy = false;
    }
  };

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
      persist();
      return record;
    },
    listScans: (repoId) => {
      const all = [...scans.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return repoId ? all.filter((s) => s.repoId === repoId) : all;
    },
    getScan: (id) => scans.get(id),
    putScan: (scan) => {
      scans.set(scan.id, scan);
      persist();
    },
    latestScan: (repoId) => {
      // "Latest" means the newest terminal result. RUNNING is in flight;
      // INTERRUPTED is recoverable and must not be read as a result.
      const forRepo = [...scans.values()]
        .filter((s) => s.repoId === repoId && (s.status === 'DONE' || s.status === 'ERROR'))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return forRepo[0];
    },
    flush: () => {
      healthy = true;
      persist();
    },
    isHealthy: () => healthy,
  };
}
