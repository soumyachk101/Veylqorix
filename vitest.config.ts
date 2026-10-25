import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * pnpm links @modelcontextprotocol/sdk only into packages/mcp-server, so a
 * tests/-level test file cannot bare-import it from the repo root. Alias the
 * specifier to the SDK's real ESM output directory (its package.json `exports`
 * rewrites `./x` -> `./dist/esm/x`), keeping a single module instance so the
 * in-memory client and server share one SDK copy. If the link is missing the
 * alias is simply not applied and the package-local tests still resolve it.
 */
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const mcpSdkLink = path.join(
  rootDir,
  'packages/mcp-server/node_modules/@modelcontextprotocol/sdk',
);

function resolveMcpSdkEsmDir(): string | undefined {
  if (!fs.existsSync(mcpSdkLink)) return undefined;
  const real = fs.realpathSync(mcpSdkLink);
  const esm = path.join(real, 'dist', 'esm');
  return fs.existsSync(path.join(esm, 'client', 'index.js')) ? esm : undefined;
}

const mcpSdkEsm = resolveMcpSdkEsmDir();

export default defineConfig({
  resolve: mcpSdkEsm
    ? {
        alias: [
          {
            find: /^@modelcontextprotocol\/sdk\/(.*)$/,
            replacement: path.join(mcpSdkEsm, '$1'),
          },
        ],
      }
    : {},
  test: {
    include: ['tests/**/*.test.ts', 'packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: ['default'],
  },
});
