import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../tests/ui',
  timeout: 90_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: undefined, // tests boot their own runtime via fixture
});
