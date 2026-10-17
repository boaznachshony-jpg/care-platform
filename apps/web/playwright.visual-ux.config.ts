import { defineConfig, devices } from '@playwright/test';

const baselinePort = Number(process.env.VISUAL_BASELINE_PORT ?? 6177);
const testPort = Number(process.env.VISUAL_TEST_PORT ?? 6178);
// Browser fixtures intercept the existing contracts. Neither comparison build
// may inherit a developer shell's remote API or authentication configuration.
const comparisonEnv = {
  VITE_API_BASE_URL: 'http://127.0.0.1:4000',
  VITE_DEV_TOKEN: 'dev-local-token',
  VITE_SUPABASE_URL: '',
  VITE_SUPABASE_PUBLISHABLE_KEY: '',
  VITE_REGULATION_CONSOLE: '',
  VITE_PUBLIC_SITE_URL: '',
  VITE_PUBLIC_SIGNUP_URL: '',
};

export default defineConfig({
  testDir: './e2e',
  testMatch: /visual-ux\.spec\.ts/,
  fullyParallel: true,
  workers: 2,
  // A comparison must be ready on its first run; retries can hide stale-page reads.
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  outputDir: 'test-results/visual-ux',
  webServer: [
    {
      command: `pnpm build --outDir dist/visual-baseline && pnpm preview --host 127.0.0.1 --outDir dist/visual-baseline --port ${baselinePort} --strictPort`,
      url: `http://127.0.0.1:${baselinePort}`,
      reuseExistingServer: false,
      env: comparisonEnv,
      timeout: 120_000,
    },
    {
      command: `pnpm build:visual-test --outDir dist/visual-test && pnpm preview --host 127.0.0.1 --outDir dist/visual-test --port ${testPort} --strictPort`,
      url: `http://127.0.0.1:${testPort}`,
      reuseExistingServer: false,
      env: comparisonEnv,
      timeout: 120_000,
    },
  ],
  use: {
    baseURL: `http://127.0.0.1:${testPort}`,
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'visual-ux',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
