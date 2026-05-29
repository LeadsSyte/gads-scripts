// Playwright config for the syte-seo-suite E2E tests.
// Tests live in test/e2e/ and run against a Vite dev server that the
// runner spins up automatically. External APIs are mocked at the
// network layer (page.route) so tests don't need real keys.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: false,
  // Local: try once. CI: 0 retries — flake should fail loudly.
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    actionTimeout: 8000,
    navigationTimeout: 12000
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe'
  }
});
