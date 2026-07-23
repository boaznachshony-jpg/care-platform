import { expect, test } from '@playwright/test';

test('loads the shell in Hebrew RTL with a single main landmark', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  await expect(page.getByRole('main')).toHaveCount(1);
});
