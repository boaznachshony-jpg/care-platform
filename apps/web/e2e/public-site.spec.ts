import { expect, test } from '@playwright/test';

test.describe('public website', () => {
  test('presents the service before entering the private app', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('main h1')).toBeVisible();
    await expect(page).toHaveTitle(/CareDesk/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://care-platform-web.vercel.app/',
    );
    await expect(page.locator('header a[href="/app"]')).toHaveAttribute('href', '/app');
    await expect(page.locator('[data-client-id]')).toHaveCount(0);
  });

  test('publishes a readable employment guide and keeps the app behind its own route', async ({
    page,
  }) => {
    await page.goto('/guide/direct-caregiver-employment');
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.locator('article h2')).toHaveCount(5);

    await page.locator('main a[href="/app"]').click();
    await expect(page).toHaveURL(/\/app$/);
  });
});
