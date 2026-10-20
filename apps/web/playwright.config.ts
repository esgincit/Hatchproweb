import { defineConfig } from '@playwright/test';

process.loadEnvFile('.env.local'); // Node >= 20.12

export default defineConfig({
  testDir: 'e2e',
  workers: 1, // tests reset shared seed rows
  fullyParallel: false,
  use: { baseURL: 'http://localhost:3100' },
  webServer: { command: 'pnpm dev --port 3100', url: 'http://localhost:3100/login', reuseExistingServer: true, timeout: 120_000 },
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  ],
});
