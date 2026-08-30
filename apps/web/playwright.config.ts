import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const baseURL = `http://127.0.0.1:${port}`;

/** Release gate §2 runs in its own project — see the `layout-matrix` entry below. */
const layoutMatrixSpec = /responsive-width-matrix\.spec\.ts/;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  webServer: {
    command: `pnpm build && pnpm preview --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: layoutMatrixSpec,
    },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] }, testIgnore: layoutMatrixSpec },
    // Release gate §2. The spec drives all seven widths itself, so running it under a
    // device preset as well would only duplicate work and emulate a phone at 2560px.
    {
      name: 'layout-matrix',
      use: { ...devices['Desktop Chrome'] },
      testMatch: layoutMatrixSpec,
    },
  ],
});
