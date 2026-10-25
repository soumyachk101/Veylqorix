#!/usr/bin/env node
import path from 'node:path';
import { createServer, type ApiOptions } from './index.js';

const port = Number(process.env.VEYLQORIX_API_PORT ?? 4173);
const allowedRoots = (process.env.VEYLQORIX_ALLOWED_ROOTS ?? '')
  .split(/[,\s]+/)
  .map((r) => (r ? path.resolve(r) : ''))
  .filter(Boolean);

const options: ApiOptions = {
  allowedRoots,
  auditDefaults: {
    online: process.env.VEYLQORIX_OFFLINE !== '1',
    includeTests: process.env.VEYLQORIX_INCLUDE_TESTS === '1',
    scannerTimeoutMs: Number(process.env.VEYLQORIX_TIMEOUT_MS ?? 120_000),
  },
};

const server = createServer(options);
server.on('error', (error) => {
  console.error('veylqorix-api: failed to start:', (error as Error).message);
  process.exit(1);
});
server.listen(port, () => {
  console.log(`veylqorix-api listening on http://localhost:${port}`);
  if (allowedRoots.length > 0) console.log(`allowed roots: ${allowedRoots.join(', ')}`);
});
