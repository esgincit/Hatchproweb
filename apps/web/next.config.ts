import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { fileURLToPath } from 'node:url';

const nextConfig: NextConfig = {
  // monorepo: pnpm lockfile lives at the repo root
  turbopack: { root: fileURLToPath(new URL('../..', import.meta.url)) },
};

export default createNextIntlPlugin('./i18n/request.ts')(nextConfig);
