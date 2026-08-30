/**
 * TEMPORARY ARTIFACT — SAFE TO DELETE.
 *
 * Created while verifying the release-gate §2 width matrix. It runs the spec's
 * browser-free rule test without the `webServer` build step:
 *
 *   npx playwright test --config=pw.tmp-matrix.config.ts -g "חוקי המטריצה"
 *
 * The sandbox that created it could not unlink files on this mount, so it was
 * left behind. Nothing imports it; deleting it changes no behaviour.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: /responsive-width-matrix\.spec\.ts/,
  reporter: 'list',
  projects: [{ name: 'rules-only' }],
});
