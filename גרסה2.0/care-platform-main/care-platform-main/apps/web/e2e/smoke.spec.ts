import { expect, test } from '@playwright/test';

const routes = [
  ['/', 'הכול נראה תקין'],
  ['/tasks', 'מה צריך לבצע'],
  ['/employee', 'Maria Santos'],
  ['/documents', 'כל המסמכים במקום אחד'],
  ['/timeline', 'המועדים הבאים'],
  ['/payroll', 'הכנת שכר חודשי'],
  ['/settings', 'הגדרות'],
] as const;

test('loads the shell in Hebrew RTL with one main landmark', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'דלג לתוכן' })).toBeVisible();
});

for (const [route, heading] of routes) {
  test(`renders ${route} without a client-side crash`, async ({ page }) => {
    await page.goto(route);
    await expect(page.getByRole('main')).toContainText(heading);
    await expect(page.locator('body')).not.toContainText('Application error');
  });
}

test('mobile navigation remains usable at a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const mobileNav = page.getByRole('navigation', { name: 'ניווט תחתון' });
  await expect(mobileNav).toBeVisible();
  await mobileNav.getByRole('link', { name: /משימות/ }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole('main')).toContainText('מה צריך לבצע');
});

test('desktop navigation exposes the primary product areas', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'ניווט ראשי' });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link')).toHaveCount(6);
});
