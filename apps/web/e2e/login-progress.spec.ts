/* eslint-disable no-restricted-syntax */
import { expect, test } from '@playwright/test';

test('slow authentication stays clear, locked and responsive', async ({ page }) => {
  test.skip(
    !process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    'The preview server runs without an authentication provider; the same state is covered by LoginPage.test.tsx.',
  );

  await page.route('**/auth/v1/token**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3600));
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Invalid login credentials' }),
    });
  });

  await page.goto('/app');
  await page.getByLabel('כתובת דוא״ל').fill('owner@example.test');
  await page.getByLabel('סיסמה').fill('secure-password');
  await page.getByRole('button', { name: 'כניסה למערכת' }).click();

  const submitButton = page.getByRole('button', { name: 'מתחברים בבטחה…' });
  const progress = page.getByRole('status');
  await expect(submitButton).toBeDisabled();
  await expect(progress).toContainText('מאמתים את פרטי הכניסה בחיבור מאובטח');
  await expect(progress).toContainText('אין צורך ללחוץ שוב');

  await expect(progress).toContainText('האימות נמשך מעט מהרגיל', { timeout: 4500 });
  await expect(page.getByRole('alert')).toContainText('פרטי הכניסה אינם תקינים', {
    timeout: 5500,
  });
  await expect(page.getByRole('button', { name: 'כניסה למערכת' })).toBeEnabled();

  const layout = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    pageWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth);
});
