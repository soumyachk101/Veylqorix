#!/usr/bin/env node
import path from 'node:path';
import { createApi, createStore, type ApiHandle } from './index.js';

/**
 * Startup configuration. Unknown values fail closed; typos in the known
 * ones get explicit guidance. Nothing sensitive is logged.
 */

function fail(message: string): never {
  console.error(`veylqorix-api: ${message}`);
  process.exit(1);
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    fail(`${name} must be a positive integer, got "${raw}".`);
  }
  return value;
}

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (Number.isNaN(value) || value < 0) {
    fail(`${name} must be a non-negative number, got "${raw}".`);
  }
  return value;
}

const port = intEnv('VEYLQORIX_API_PORT', 4173);
const token = process.env.VEYLQORIX_API_TOKEN;
const host = process.env.VEYLQORIX_API_HOST;
const storePath = process.env.VEYLQORIX_STORE_PATH
  ? path.resolve(process.env.VEYLQORIX_STORE_PATH)
  : path.resolve('./.veylqorix-store.json');
const corsOrigins = (process.env.VEYLQORIX_CORS_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const allowedRoots = (process.env.VEYLQORIX_ALLOWED_ROOTS ?? '')
  .split(/[,\s]+/)
  .map((r) => (r ? path.resolve(r) : ''))
  .filter(Boolean);

// Bind address decision (default is loopback-only):
// - no token  + no host      -> 127.0.0.1, warn nothing
// - no token  + host not loopback -> refuse: exposing a root-reading API
//   without authentication is never a safe default
// - token set + host (any)   -> protected remote mode
if (host && !token) {
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (!loopback) {
    fail(
      `VEYLQORIX_API_HOST is "${host}" but no VEYLQORIX_API_TOKEN is set. ` +
        'Bind to a non-loopback address only in protected mode: set VEYLQORIX_API_TOKEN (bearer auth) first.',
    );
  }
}
if (token && !host) {
  console.warn(
    'veylqorix-api: warning: VEYLQORIX_API_TOKEN is set but VEYLQORIX_API_HOST is not; ' +
      'binding to 127.0.0.1. Set VEYLQORIX_API_HOST to enable remote/protected mode.',
  );
}
const bindHost = host && !['localhost', '127.0.0.1', '::1'].includes(host) ? host : '127.0.0.1';

if (process.env.VEYLQORIX_OFFLINE !== undefined && process.env.VEYLQORIX_OFFLINE !== '1' && process.env.VEYLQORIX_OFFLINE !== '0') {
  fail(`VEYLQORIX_OFFLINE must be "1" or "0" when set, got "${process.env.VEYLQORIX_OFFLINE}".`);
}
if (process.env.VEYLQORIX_INCLUDE_TESTS !== undefined && process.env.VEYLQORIX_INCLUDE_TESTS !== '1' && process.env.VEYLQORIX_INCLUDE_TESTS !== '0') {
  fail(`VEYLQORIX_INCLUDE_TESTS must be "1" or "0" when set, got "${process.env.VEYLQORIX_INCLUDE_TESTS}".`);
}

// Fail closed on bad roots and store files before anything listens.
let store: ReturnType<typeof createStore>;
try {
  store = createStore({ path: storePath });
} catch (error) {
  fail(`store error: ${(error as Error).message}`);
}

let api: ApiHandle;
try {
  api = createApi({
    store,
    allowedRoots,
    token,
    corsOrigins,
    maxConcurrentScans: intEnv('VEYLQORIX_MAX_CONCURRENT_SCANS', 2),
    bodyLimitBytes: numEnv('VEYLQORIX_BODY_LIMIT_BYTES', 1024 * 1024),
    maxFieldLength: numEnv('VEYLQORIX_MAX_FIELD_LENGTH', 4096),
    auditDefaults: {
      online: process.env.VEYLQORIX_OFFLINE !== '1',
      includeTests: process.env.VEYLQORIX_INCLUDE_TESTS === '1',
      scannerTimeoutMs: numEnv('VEYLQORIX_TIMEOUT_MS', 120_000),
    },
  });
} catch (error) {
  fail((error as Error).message);
}

const server = api.server;
server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    fail(`port ${port} is already in use. Stop the other Veylqorix API process or set VEYLQORIX_API_PORT.`);
  }
  console.error('veylqorix-api: failed to start:', (error as Error).message);
  process.exit(1);
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`veylqorix-api: ${signal} received; shutting down gracefully`);
  try {
    await api.shutdown(30_000);
  } catch {
    // Drain failure must not wedge the exit path.
  }
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

server.listen(port, bindHost, () => {
  console.log(`veylqorix-api listening on http://${bindHost === '127.0.0.1' ? 'localhost' : bindHost}:${port}`);
  if (token) {
    console.log('protected mode: bearer token required for /api routes (token value not logged)');
  } else if (bindHost !== '127.0.0.1') {
    console.warn(`warning: bound to ${bindHost} without a token; requests can reach this API from other hosts`);
  }
  if (allowedRoots.length > 0) console.log(`allowed roots: ${allowedRoots.join(', ')}`);
  console.log(`store: ${storePath} (single-process; in-flight scans recover as INTERRUPTED on restart)`);
});
