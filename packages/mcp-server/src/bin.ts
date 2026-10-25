#!/usr/bin/env node
import path from 'node:path';
import { startServer } from './index.js';

const configuredRoots = (process.env.VEYLQORIX_ROOTS ?? '')
  .split(/[\s;]+/)
  .map((root) => path.resolve(root))
  .filter(Boolean);

const roots = configuredRoots.length > 0 ? configuredRoots : [process.cwd()];

try {
  await startServer({
    roots,
    online: process.env.VEYLQORIX_OFFLINE !== '1',
    timeoutMs: Number(process.env.VEYLQORIX_TIMEOUT_MS ?? 120_000),
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`veylqorix-mcp: ${message}\n`);
  process.exit(1);
}
