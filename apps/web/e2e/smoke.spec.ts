/* eslint-disable no-restricted-syntax */
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('completes onboarding, persists data and updates settings', async ({ page }) => {
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  await page.getByLabel('שם המעסיק').fill('בועז בדיקה');
  await page.getByLabel('מספר טלפון').fill('0501234567');
  await page.getByLabel('שם המטופל').fill('מטופל בדיקה');
  await page.getByRole('button', { name: 'המשך' }).click();

  await page.getByLabel('שם המטפל או המטפלת').fill('Caregiver Test');
  await page.getByLabel('תאריך תחילת ההעסקה').fill('2026-01-15');
  await page.getByRole('button', { name: 'המשך' }).click();

  await page.getByLabel('שם הנציג המורשה').fill('נציג בדיקה');
  await page.getByLabel('מספר טלפון').fill('0521234567');
  await page.getByRole('button', { name: 'שמירה וכניסה למערכת' }).click();

  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'שלום בועז בדיקה' })).toBeVisible();
  await expect(page.getByText('מטופל בדיקה')).toBeVisible();
  await expect(page.getByText('Caregiver Test')).toBeVisible();
  await expect(page.getByText('דורש טיפול', { exact: true })).toBeVisible();

  await page.goto('/settings');
  await page.getByLabel('שם המעסיק').fill('בועז מעודכן');
  await page.getByLabel('כמה זמן מראש להזכיר?').selectOption('21');
  await page.getByRole('button', { name: 'שמירת השינויים' }).click();
  await expect(page.getByText('השינויים נשמרו בהצלחה')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('שם המעסיק')).toHaveValue('בועז מעודכן');
  await expect(page.getByLabel('כמה זמן מראש להזכיר?')).toHaveValue('21');

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'שלום בועז מעודכן' })).toBeVisible();
});

test('mobile controls remain readable and touch friendly', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'בואו נכין את התיק שלכם' })).toBeVisible();
  const continueButton = page.getByRole('button', { name: 'המשך' });
  await expect(continueButton).toBeVisible();
  const box = await continueButton.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(48);
});
