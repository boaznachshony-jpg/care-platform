/* eslint-disable no-restricted-syntax */
import { expect, test, type Page } from '@playwright/test';

const completedProfile = {
  employerName: 'מעסיק בדיקה',
  employerIdNumber: '123456782',
  employerPhone: '0501234567',
  recipientName: 'מטופל בדיקה',
  caregiverName: 'Dilnoza',
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

async function seedCompletedProfile(page: Page) {
  await page.goto('/app');
  await page.evaluate((profile) => {
    localStorage.clear();
    localStorage.setItem('caredesk.mvp.profile.v1', JSON.stringify(profile));
  }, completedProfile);
}

test.describe('persistent profile and reminder preferences', () => {
  test.beforeEach(async ({ page }) => {
    await seedCompletedProfile(page);
  });

  test('persists edited profile data, all reminder choices and quiet hours after reload', async ({
    page,
  }) => {
    await page.goto('/settings');

    const employerName = page.getByLabel('שם המעסיק');
    const reminderLead = page.getByLabel('כמה זמן מראש להזכיר?');
    const quietStart = page.getByLabel('תחילת שעות שקטות');
    const quietEnd = page.getByLabel('סיום שעות שקטות');

    await employerName.fill('מעסיק מעודכן');

    for (const days of ['7', '14', '21', '30']) {
      await reminderLead.selectOption(days);
      await expect(reminderLead).toHaveValue(days);
    }

    await quietStart.fill('22:30');
    await quietEnd.fill('07:15');
    await page.getByRole('button', { name: 'שמירת השינויים' }).click();
    await expect(page.getByRole('status')).toContainText('השינויים נשמרו בהצלחה');

    await page.reload();
    await expect(employerName).toHaveValue('מעסיק מעודכן');
    await expect(reminderLead).toHaveValue('30');
    await expect(quietStart).toHaveValue('22:30');
    await expect(quietEnd).toHaveValue('07:15');

    const stored = await page.evaluate(() => localStorage.getItem('caredesk.mvp.profile.v1'));
    expect(stored).toMatch(/^caredesk-encrypted-v1:/);
    expect(stored).not.toContain('מעסיק מעודכן');
  });

  test('master switch disables reminder timing and persists both states', async ({ page }) => {
    await page.goto('/settings');
    const masterSwitch = page.getByRole('checkbox', { name: 'הפעלת כל ההתראות' });
    const reminderLead = page.getByLabel('כמה זמן מראש להזכיר?');

    await masterSwitch.uncheck();
    await expect(reminderLead).toBeDisabled();
    await page.getByRole('button', { name: 'שמירת השינויים' }).click();
    await page.reload();
    await expect(masterSwitch).not.toBeChecked();
    await expect(reminderLead).toBeDisabled();

    await masterSwitch.check();
    await expect(reminderLead).toBeEnabled();
    await reminderLead.selectOption('14');
    await page.getByRole('button', { name: 'שמירת השינויים' }).click();
    await page.reload();
    await expect(masterSwitch).toBeChecked();
    await expect(reminderLead).toHaveValue('14');
  });
});

test.describe('task management', () => {
  test.beforeEach(async ({ page }) => {
    await seedCompletedProfile(page);
    await page.goto('/tasks');
  });

  test('creates, edits, completes and persists a task after reload', async ({ page }) => {
    await page.getByRole('button', { name: /משימה חדשה/ }).click();
    await page.getByLabel('מה צריך לבצע?').fill('חידוש ביטוח רפואי');
    await page.getByLabel('מועד יעד').fill('2026-08-18');
    await page.getByLabel('עדיפות').selectOption('important');
    await page.getByRole('button', { name: 'שמירת המשימה' }).click();

    await expect(page.getByRole('status')).toContainText('המשימה נוספה ונשמרה');
    await expect(page.getByRole('heading', { name: 'חידוש ביטוח רפואי' })).toBeVisible();
    await expect(page.getByText('מועד יעד: 18.08.2026')).toBeVisible();
    await expect(page.getByText('חשוב', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'עריכה' }).click();
    await page.getByLabel('מה צריך לבצע?').fill('חידוש ביטוח רפואי מעודכן');
    await page.getByLabel('מועד יעד').fill('2026-08-25');
    await page.getByLabel('עדיפות').selectOption('urgent');
    await page.getByRole('button', { name: 'שמירת המשימה' }).click();

    await expect(page.getByRole('status')).toContainText('המשימה עודכנה ונשמרה');
    await expect(page.getByRole('heading', { name: 'חידוש ביטוח רפואי מעודכן' })).toBeVisible();
    await expect(page.getByText('מועד יעד: 25.08.2026')).toBeVisible();
    await expect(page.getByText('דחוף', { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'חידוש ביטוח רפואי מעודכן' })).toBeVisible();

    await page.getByRole('button', { name: 'השלמת חידוש ביטוח רפואי מעודכן' }).click();
    await expect(page.getByRole('heading', { name: 'חידוש ביטוח רפואי מעודכן' })).not.toBeVisible();

    await page.getByRole('button', { name: 'הושלמו' }).click();
    await expect(page.getByRole('heading', { name: 'חידוש ביטוח רפואי מעודכן' })).toBeVisible();

    await page.reload();
    await page.getByRole('button', { name: 'הושלמו' }).click();
    await expect(page.getByRole('heading', { name: 'חידוש ביטוח רפואי מעודכן' })).toBeVisible();
  });
});

test.describe('document validation and persistence', () => {
  test.beforeEach(async ({ page }) => {
    await seedCompletedProfile(page);
    await page.goto('/documents');
    await page.getByRole('button', { name: /הוספת מסמך/ }).click();
    await page.getByLabel('שם המסמך').fill('אשרת עבודה');
    await page.getByLabel('תוקף המסמך').fill('2028-12-31');
  });

  test('rejects a missing file and an unsupported file type', async ({ page }) => {
    await page.getByRole('button', { name: 'שמירת המסמך' }).click();
    await expect(page.getByRole('status')).toContainText('יש לבחור קובץ לפני השמירה');

    await page.getByLabel('בחירת קובץ').setInputFiles({
      name: 'malware.exe',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('not a supported document'),
    });
    await page.getByRole('button', { name: 'שמירת המסמך' }).click();
    await expect(page.getByRole('status')).toContainText('סוג הקובץ אינו נתמך');
  });

  test('rejects a file larger than 10MB', async ({ page }) => {
    await page.getByLabel('בחירת קובץ').setInputFiles({
      name: 'too-large.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(10_000_001),
    });
    await page.getByRole('button', { name: 'שמירת המסמך' }).click();
    await expect(page.getByRole('status')).toContainText('הקובץ גדול מדי');
  });

  test('saves document metadata, edits it and keeps the edit after reload', async ({ page }) => {
    await page.getByLabel('סוג').selectOption('אשרת עבודה');
    await page.getByLabel('מצב').selectOption('attention');
    await page.getByLabel('בחירת קובץ').setInputFiles({
      name: 'work-permit.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 test file'),
    });
    await page.getByRole('button', { name: 'שמירת המסמך' }).click();
    await expect(page.getByRole('status')).toContainText('המסמך נוסף ונשמר');

    const documentCard = page.getByRole('article').filter({ hasText: 'אשרת עבודה' });
    await expect(documentCard).toContainText('דורש טיפול');
    await expect(documentCard).toContainText('work-permit.pdf');

    await documentCard.getByRole('button', { name: 'עריכה' }).click();
    await page.getByLabel('שם המסמך').fill('אשרת עבודה מעודכנת');
    await page.getByLabel('תוקף המסמך').fill('2029-12-31');
    await page.getByLabel('מצב').selectOption('valid');
    await page.getByRole('button', { name: 'שמירת המסמך' }).click();
    await expect(page.getByRole('status')).toContainText('פרטי המסמך עודכנו ונשמרו');

    await page.reload();
    const updatedCard = page.getByRole('article').filter({ hasText: 'אשרת עבודה מעודכנת' });
    await expect(updatedCard).toContainText('בתוקף עד 31.12.2029');
    await expect(updatedCard).toContainText('תקין');
    await expect(updatedCard).toContainText('work-permit.pdf');
  });
});

test('shows Uzbekistan context and Uzbek trust-building messages', async ({ page }) => {
  await seedCompletedProfile(page);
  await page.goto('/trust');

  await expect(page.getByRole('heading', { name: 'מסרים לבניית אמון' })).toBeVisible();
  await expect(page.getByText('ארץ מוצא: אוזבקיסטן · שפה שנבחרה: אוזבקית')).toBeVisible();
  await expect(page.getByText('Xayrli tong. Bugun o‘zingizni qanday his qilyapsiz?')).toBeVisible();
  await expect(page.getByText('Rahmat. Yordamingizni qadrlayman.')).toBeVisible();
  await expect(page.getByText('Keling, bugungi rejani birga ko‘rib chiqamiz.')).toBeVisible();
  await expect(
    page.getByText('Biz bilishimiz yoki yordam berishimiz kerak bo‘lgan biror narsa bormi?'),
  ).toBeVisible();
});

test('discarded caregiver edits do not reappear when editing again', async ({ page }) => {
  await seedCompletedProfile(page);
  await page.goto('/employee');

  await page.getByRole('button', { name: 'עריכת פרטים' }).click();
  await page.getByLabel('שם המטפל או המטפלת').fill('שם שלא נשמר');
  await page.getByRole('button', { name: 'ביטול' }).click();
  await page.getByRole('button', { name: 'עריכת פרטים' }).click();

  await expect(page.getByLabel('שם המטפל או המטפלת')).toHaveValue('Dilnoza');
});

test('settings saved confirmation clears after a new unsaved edit', async ({ page }) => {
  await seedCompletedProfile(page);
  await page.goto('/settings');

  await page.getByRole('button', { name: 'שמירת השינויים' }).click();
  await expect(page.getByText('השינויים נשמרו בהצלחה')).toBeVisible();
  await page.getByLabel('שם המעסיק').fill('שינוי שטרם נשמר');

  await expect(page.getByText('השינויים נשמרו בהצלחה')).not.toBeVisible();
});
