import { defineConfig } from 'vitest/config';

export default defineConfig({
  // React 17+ automatic JSX runtime (the classic runtime needs `React` in scope).
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    testTimeout: 10_000,
  },
});
