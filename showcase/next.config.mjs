import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // This app lives inside a larger pnpm monorepo. Pin Next.js's tracing root
  // to the showcase directory so it never infers the repo root (which has
  // pnpm-lock.yaml) as the workspace root.
  outputFileTracingRoot: here,
};

export default nextConfig;
