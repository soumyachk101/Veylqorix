#!/usr/bin/env node
import path from 'node:path';
import { startServer } from './index.js';

// Roots must be explicit. Without VEYLQORIX_ROOTS the server fails closed
// (refuses to start) instead of silently confining to process.cwd(), which
// would let a caller pick the confinement surface implicitly.
const configuredRoots = (process.env.VEYLQORIX_ROOTS ?? '')
  .split(/[,\s;]+/)
  .map((root) => path.resolve(root))
  .filter(Boolean);

if (configuredRoots.length === 0) {
  process.stderr.write(
    'veylqorix-mcp: VEYLQORIX_ROOTS is required. Set it to the absolute workspace root(s) to confine tool access; the server does not fall back to the current directory.\n',
  );
  process.exit(1);
}

try {
  await startServer({
    roots: configuredRoots,
    online: process.env.VEYLQORIX_OFFLINE !== '1',
    timeoutMs: Number(process.env.VEYLQORIX_TIMEOUT_MS ?? 120_000),
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`veylqorix-mcp: ${message}\n`);
  process.exit(1);
}
