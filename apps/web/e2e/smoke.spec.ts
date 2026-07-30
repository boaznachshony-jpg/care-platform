/* eslint-disable no-restricted-syntax */
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

const completedProfile = {
  employerName: 'בועז בדיקה',
  employerIdNumber: '123456782',
  employerPhone: '0501234567',
  recipientName: 'מטופל בדיקה',
  caregiverName: 'Caregiver Test',
  caregiverCountry: 'אוזבקיסטן',
  caregiverLanguage: 'אוזבקית',
  employmentStartDate: '2026-01-15',
  representativeName: 'נציג בדיקה',
  representativePhone: '0521234567',
  notificationsEnabled: true,
  reminderLeadDays: 7,
  quietHoursStart: '21:00',
  quietHoursEnd: '08:00',
  onboardingCompleted: true,
  baseSalary: 7000,
  salaryEffectiveDate: '2026-01-15',
};

async function seedCompletedProfile(page: import('@playwright/test').Page) {
  await page.evaluate((profile) => {
    localStorage.setItem('caredesk.mvp.profile.v1', JSON.stringify(profile));
  }, completedProfile);
}

test('completes onboarding, persists data and updates settings', async ({ page }) => {
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  await page.getByLabel('שם המעסיק').fill('בועז בדיקה');
  await page.getByLabel('מספר תעודת זהות').fill('123456782');
  await page.getByLabel('מספר טלפון').fill('0501234567');
  await page.getByLabel('שם המטופל').fill('מטופל בדיקה');
  await page.getByRole('button', { name: 'המשך' }).click();

  await page.getByLabel('שם המטפל או המטפלת').fill('Caregiver Test');
  await page.getByLabel('ארץ מוצא').selectOption('אוזבקיסטן');
  await page.getByLabel('שפה מועדפת').selectOption('אוזבקית');
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

test('mobile navigation keeps payroll accessible', async ({ page }) => {
  await seedCompletedProfile(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'ניווט תחתון' })).toContainText('שכר');
  await page
    .getByRole('navigation', { name: 'ניווט תחתון' })
    .getByRole('link', { name: '₪ שכר' })
    .click();
  await expect(page).toHaveURL(/\/payroll$/);
  await expect(page.getByRole('heading', { name: 'הכנת שכר חודשי' })).toBeVisible();
});

const productRoutes = [
  ['/', 'שלום בועז בדיקה'],
  ['/tasks', 'מה צריך לבצע'],
  ['/employee', 'Caregiver Test'],
  ['/trust', 'מסרים לבניית אמון'],
  ['/documents', 'כל המסמכים במקום אחד'],
  ['/timeline', 'המועדים הבאים'],
  ['/payroll', 'הכנת שכר חודשי'],
  ['/settings', 'פרטים והעדפות'],
] as const;

for (const [route, heading] of productRoutes) {
  test(`renders ${route} after onboarding`, async ({ page }) => {
    await seedCompletedProfile(page);
    await page.goto(route);
    await expect(page.getByRole('main')).toContainText(heading);
    await expect(page.getByRole('main')).toBeVisible();
  });
}

test('marks and restores a task in the current session', async ({ page }) => {
  await seedCompletedProfile(page);
  await page.goto('/tasks');
  const task = page.getByRole('article').filter({ hasText: 'בדיקת ביטוח רפואי' });
  const checkbox = task.getByRole('button').first();
  await checkbox.click();
  await expect(task).toHaveClass(/completed/);
  await checkbox.click();
  await expect(task).not.toHaveClass(/completed/);
});

test('walks through all payroll steps', async ({ page }) => {
  await seedCompletedProfile(page);
  await page.goto('/payroll');
  const next = page.getByRole('button', { name: 'המשך' });
  await next.click();
  await expect(page.getByRole('heading', { name: 'שכר בסיס' })).toBeVisible();
  await next.click();
  await expect(page.getByRole('heading', { name: 'תוספות' })).toBeVisible();
  await next.click();
  await expect(page.getByRole('heading', { name: 'ניכויים' })).toBeVisible();
  await next.click();
  await expect(page.getByRole('heading', { name: 'סיכום ואישור' })).toBeVisible();
  await expect(page.getByText('נתוני העסקה', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'אישור ושמירה' }).click();
  await expect(page.getByText('חישוב השכר החודשי נשמר וניתן לעריכה חוזרת.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'סיכום שכר שנתי' })).toBeVisible();
  await expect(page.getByText(/סה״כ לתשלום בשנת/)).toBeVisible();
});

test('tracks quarterly and annual employment expenses', async ({ page }) => {
  await seedCompletedProfile(page);
  await page.goto('/payroll');
  await expect(page.getByRole('heading', { name: 'תשלומים תקופתיים של ההעסקה' })).toBeVisible();
  await page.getByLabel('סוג התשלום').selectOption({ label: 'ביטוח לאומי' });
  await page.getByLabel('תדירות').selectOption('quarterly');
  await page.getByLabel('סכום בש״ח').fill('1840');
  await page.getByLabel('תאריך יעד').fill('2026-09-30');
  await page.getByLabel('הערה או אסמכתה').fill('רבעון שלישי');
  await page.getByRole('button', { name: 'הוספת תשלום למעקב' }).click();
  await expect(page.getByText('התשלום התקופתי נשמר בלוח עלויות ההעסקה.')).toBeVisible();
  await expect(page.getByText('רבעוני · יעד 2026-09-30 · רבעון שלישי')).toBeVisible();
  await page.reload();
  await expect(page.locator('.employment-expenses strong').getByText('ביטוח לאומי')).toBeVisible();
});

test('adds, opens, edits and persists a realistic image document', async ({ page }) => {
  await seedCompletedProfile(page);
  await page.goto('/documents');
  await expect(page.getByText('עדיין לא נוספו מסמכים')).toBeVisible();
  await page.getByRole('button', { name: '↑ הוספת מסמך' }).click();
  await page.getByLabel('שם המסמך').fill('דרכון בדיקה');
  await page.getByLabel('סוג').selectOption('דרכון');
  await page.getByLabel('תאריך או הערה').fill('בתוקף עד 31.12.2028');
  await page.getByLabel('בחירת קובץ').setInputFiles({
    name: 'passport.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.alloc(2_000_000, 1),
  });
  await page.getByRole('button', { name: 'שמירת המסמך' }).click();
  await expect(page.getByRole('heading', { name: 'דרכון בדיקה' })).toBeVisible();

  await page.getByRole('button', { name: 'עריכה' }).click();
  await page.getByLabel('שם המסמך').fill('דרכון מעודכן');
  await page.getByRole('button', { name: 'שמירת המסמך' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'דרכון מעודכן' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'פתיחה' }).click();
  await expect((await download).suggestedFilename()).toBe('passport.jpg');
});

test('requires an explicit salary source before payroll', async ({ page }) => {
  await page.evaluate((profile) => {
    localStorage.setItem(
      'caredesk.mvp.profile.v1',
      JSON.stringify({ ...profile, baseSalary: null, salaryEffectiveDate: '' }),
    );
  }, completedProfile);
  await page.goto('/payroll');
  await expect(page.getByRole('heading', { name: 'הגדרת מקור השכר' })).toBeVisible();
  await expect(page.getByText('טרם הוגדר')).toBeVisible();
});

test('saves Uzbekistan as caregiver country and shows Uzbek trust messages', async ({ page }) => {
  await seedCompletedProfile(page);
  await page.goto('/employee');
  await expect(page.getByText('אוזבקיסטן · תחילת העסקה 2026-01-15')).toBeVisible();
  await page.getByRole('link', { name: 'מסרים לבניית אמון' }).click();
  await expect(page.getByText('ארץ מוצא: אוזבקיסטן · שפה שנבחרה: אוזבקית')).toBeVisible();
  await expect(page.getByText('Rahmat. Yordamingizni qadrlayman.')).toBeVisible();
});

test('notification master switch disables reminder timing', async ({ page }) => {
  await seedCompletedProfile(page);
  await page.goto('/settings');
  const masterSwitch = page.getByRole('checkbox', { name: 'הפעלת כל ההתראות' });
  const reminderSelect = page.getByLabel('כמה זמן מראש להזכיר?');
  await masterSwitch.uncheck();
  await expect(reminderSelect).toBeDisabled();
  await page.getByRole('button', { name: 'שמירת השינויים' }).click();
  await page.reload();
  await expect(masterSwitch).not.toBeChecked();
});
