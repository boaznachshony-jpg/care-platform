/* eslint-disable no-restricted-syntax */
import { expect, test, type Page } from '@playwright/test';

const completedProfile = {
  employerName: 'מעסיק בדיקת השקה',
  employerIdNumber: '123456782',
  employerPhone: '0501234567',
  recipientName: 'מטופל בדיקת השקה',
  caregiverName: 'Dilnoza',
  caregiverCountry: 'אוזבקיסטן',
  caregiverLanguage: 'אוזבקית',
  employmentStartDate: '2026-01-15',
  representativeName: 'נציג בדיקת השקה',
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
  await page.goto('/');
  await page.evaluate((profile) => {
    localStorage.clear();
    localStorage.setItem('caredesk.mvp.profile.v1', JSON.stringify(profile));
  }, completedProfile);
}

test.describe('launch readiness interactions', () => {
  test('completes every onboarding field and supports backward navigation', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(page.getByRole('button', { name: 'חזרה' })).toBeDisabled();
    await page.getByLabel('שם המעסיק').fill('מעסיק חדש');
    await page.getByLabel('מספר תעודת זהות').fill('123456782');
    await page.getByLabel('מספר טלפון').fill('0501111111');
    await page.getByLabel('שם המטופל').fill('מטופל חדש');
    await page.getByRole('button', { name: 'המשך' }).click();

    await page.getByLabel('שם המטפל או המטפלת').fill('Dilnoza');
    await page.getByLabel('ארץ מוצא').selectOption('אוזבקיסטן');
    await expect(page.getByLabel('שפה מועדפת')).toHaveValue('אוזבקית');
    await page.getByLabel('תאריך תחילת ההעסקה').fill('2026-01-15');
    await page.getByRole('button', { name: 'חזרה' }).click();
    await expect(page.getByLabel('שם המעסיק')).toHaveValue('מעסיק חדש');
    await page.getByRole('button', { name: 'המשך' }).click();
    await expect(page.getByLabel('שם המטפל או המטפלת')).toHaveValue('Dilnoza');
    await page.getByRole('button', { name: 'המשך' }).click();

    await page.getByLabel('שם הנציג המורשה').fill('נציג חדש');
    await page.getByLabel('מספר טלפון').fill('0521111111');
    await page.getByRole('button', { name: 'שמירה וכניסה למערכת' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'שלום מעסיק חדש' })).toBeVisible();
  });

  test('updates and persists every editable caregiver field', async ({ page }) => {
    await seedCompletedProfile(page);
    await page.goto('/employee');

    await page.getByRole('button', { name: 'עריכת פרטים' }).click();
    await page.getByLabel('שם המטפל או המטפלת').fill('Nargiza');
    await page.getByLabel('ארץ מוצא').selectOption('גאורגיה');
    await expect(page.getByLabel('שפה מועדפת')).toHaveValue('גאורגית');
    await page.getByLabel('שפה מועדפת').selectOption('רוסית');
    await page.getByRole('button', { name: 'שמירת הפרטים' }).click();

    await expect(page.getByRole('status')).toContainText('פרטי המטפל נשמרו');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Nargiza', level: 1 })).toBeVisible();
    await expect(page.getByText(/גאורגיה · תחילת העסקה/)).toBeVisible();
    await expect(page.getByText('שפה מועדפת: רוסית')).toBeVisible();

    await page.getByRole('button', { name: 'עריכת פרטים' }).click();
    await page.getByLabel('שם המטפל או המטפלת').fill('שינוי לביטול');
    await page.getByRole('button', { name: 'ביטול' }).click();
    await expect(page.getByRole('heading', { name: 'Nargiza', level: 1 })).toBeVisible();
  });

  test('copies every trust message and both caregiver shortcuts navigate', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await seedCompletedProfile(page);
    await page.goto('/employee');

    await page.getByRole('link', { name: 'מסרים לבניית אמון' }).click();
    await expect(page).toHaveURL(/\/trust$/);

    const messageCards = page.locator('.trust-message-card');
    await expect(messageCards).toHaveCount(4);
    for (let index = 0; index < 4; index += 1) {
      const card = messageCards.nth(index);
      await card.getByRole('button', { name: 'העתקת המסר' }).click();
      await expect(card.getByRole('button', { name: 'הועתק' })).toBeVisible();
    }

    await page.getByRole('link', { name: 'לפרטי המטפל' }).click();
    await expect(page).toHaveURL(/\/employee$/);
    await page.getByRole('link', { name: 'לפתיחת המסרים' }).click();
    await expect(page).toHaveURL(/\/trust$/);
  });

  test('offers the caregiver completion shortcut when trust details are missing', async ({
    page,
  }) => {
    await seedCompletedProfile(page);
    await page.evaluate(() => {
      const profile = JSON.parse(localStorage.getItem('caredesk.mvp.profile.v1') ?? '{}');
      localStorage.setItem(
        'caredesk.mvp.profile.v1',
        JSON.stringify({ ...profile, caregiverCountry: '', caregiverLanguage: '' }),
      );
    });
    await page.goto('/trust');

    await page.getByRole('link', { name: 'השלמת הפרטים' }).click();
    await expect(page).toHaveURL(/\/employee$/);
  });

  test('secondary task and document controls respond correctly', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-08-01T12:00:00'));
    await seedCompletedProfile(page);
    await page.goto('/tasks');

    await page.getByRole('button', { name: /משימה חדשה/ }).click();
    await page.getByRole('button', { name: 'סגירה' }).click();
    await expect(page.getByRole('heading', { name: 'משימה חדשה' })).not.toBeVisible();

    await page.getByRole('button', { name: /משימה חדשה/ }).click();
    await page.getByLabel('מה צריך לבצע?').fill('משימה לשבוע הקרוב');
    await page.getByLabel('מועד יעד').fill('2026-08-05');
    await page.getByLabel('עדיפות').selectOption('normal');
    await page.getByRole('button', { name: 'שמירת המשימה' }).click();
    await page.getByRole('button', { name: 'השבוע' }).click();
    await expect(page.getByRole('heading', { name: 'משימה לשבוע הקרוב' })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'מעבר לאתר הביטוח הלאומי לדיווח ולתשלום' }),
    ).toHaveAttribute('href', /btl\.gov\.il/);

    await page.goto('/documents');
    await page.getByRole('button', { name: /הוספת מסמך/ }).click();
    await page.getByRole('button', { name: 'סגירה' }).click();
    await expect(page.getByRole('heading', { name: 'הוספת מסמך' })).not.toBeVisible();
  });

  test('skip link, text size controls and notification shortcut are operational', async ({
    page,
  }) => {
    await seedCompletedProfile(page);
    await page.goto('/');

    await expect(page.getByRole('link', { name: 'דלג לתוכן' })).toHaveAttribute(
      'href',
      '#main-content',
    );
    await page.getByRole('button', { name: 'הגדלת טקסט' }).click();
    await expect(page.locator('.app-frame')).toHaveCSS('zoom', '1.15');
    await page.getByRole('button', { name: 'הקטנת טקסט' }).click();
    await expect(page.locator('.app-frame')).toHaveCSS('zoom', '1');
    await page.getByRole('link', { name: /מעבר למשימות פתוחות/ }).click();
    await expect(page).toHaveURL(/\/tasks$/);
  });

  test('updates every settings field and exercises notification actions', async ({ page }) => {
    await page.addInitScript(() => {
      class MockNotification {
        static permission: NotificationPermission = 'default';

        static async requestPermission(): Promise<NotificationPermission> {
          MockNotification.permission = 'granted';
          return 'granted';
        }

        constructor(_title: string, _options?: NotificationOptions) {}
      }
      Object.defineProperty(window, 'Notification', {
        configurable: true,
        value: MockNotification,
      });
    });
    await seedCompletedProfile(page);
    await page.goto('/settings');

    await page.getByLabel('שם המעסיק').fill('מעסיק מעודכן להשקה');
    await page.getByLabel('מספר תעודת זהות').fill('123');
    await expect(page.getByRole('alert')).toContainText('אינו תקין');
    await expect(page.getByRole('button', { name: 'שמירת השינויים' })).toBeDisabled();
    await page.getByLabel('מספר תעודת זהות').fill('123456782');
    await page.getByLabel('מספר טלפון').first().fill('0507654321');
    await page.getByLabel('שם הנציג המורשה').fill('נציג מעודכן');
    await page.getByLabel('מספר טלפון').last().fill('0527654321');

    const masterSwitch = page.getByRole('checkbox', { name: 'הפעלת כל ההתראות' });
    await masterSwitch.uncheck();
    await expect(page.getByLabel('כמה זמן מראש להזכיר?')).toBeDisabled();
    await masterSwitch.check();
    for (const days of ['1', '7', '14', '21', '30']) {
      await page.getByLabel('כמה זמן מראש להזכיר?').selectOption(days);
      await expect(page.getByLabel('כמה זמן מראש להזכיר?')).toHaveValue(days);
    }
    await page.getByLabel('תחילת שעות שקטות').fill('22:30');
    await page.getByLabel('סיום שעות שקטות').fill('07:15');

    await page.getByRole('button', { name: 'אישור התראות בדפדפן' }).click();
    await expect(page.getByRole('status')).toBeVisible();
    await page.getByRole('button', { name: 'שליחת התראת בדיקה' }).click();
    await expect(page.getByRole('status')).toBeVisible();
    await page.getByRole('button', { name: 'שמירת השינויים' }).click();
    await expect(page.getByText('השינויים נשמרו בהצלחה')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('שם המעסיק')).toHaveValue('מעסיק מעודכן להשקה');
    await expect(page.getByLabel('מספר טלפון').first()).toHaveValue('0507654321');
    await expect(page.getByLabel('שם הנציג המורשה')).toHaveValue('נציג מעודכן');
    await expect(page.getByLabel('מספר טלפון').last()).toHaveValue('0527654321');
    await expect(page.getByLabel('כמה זמן מראש להזכיר?')).toHaveValue('30');
    await expect(page.getByLabel('תחילת שעות שקטות')).toHaveValue('22:30');
    await expect(page.getByLabel('סיום שעות שקטות')).toHaveValue('07:15');

    await page.getByRole('link', { name: 'פתיחת ההדרכה מחדש' }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test('uses every monthly payroll input and persists the annual record', async ({ page }) => {
    await seedCompletedProfile(page);
    await page.goto('/payroll');

    const month = page.getByLabel('חודש שכר');
    await month.fill('2026-07');
    await page.getByRole('button', { name: 'המשך' }).click();

    const baseFields: Array<[string, string]> = [
      ['שכר בסיס', '7200'],
      ['תאריך תחילת עבודה בחודש, לחישוב יחסי', '2026-07-03'],
      ['ימי עבודה', '20'],
      ['ימי חופשה שנוצלו', '1.5'],
      ['ימי מחלה', '2'],
      ['ימי היעדרות אחרים', '0.5'],
      ['מספר שבתות או ימי מנוחה שעבדו', '3'],
      ['תעריף לכל שבת או יום מנוחה', '450'],
      ['ימי חג שעבדו', '1'],
    ];
    for (const [label, value] of baseFields) {
      await page.getByLabel(label, { exact: true }).fill(value);
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
    }
    await page.getByRole('button', { name: 'המשך' }).click();

    const additionFields: Array<[string, string]> = [
      ['תשלום ימי חג', '450'],
      ['תשלום חופשה', '350'],
      ['תשלום מחלה', '300'],
      ['הפרשות מעסיק: פנסיה ופיצויים', '900'],
      ['תוספת אחרת, אם קיימת', '125'],
    ];
    for (const [label, value] of additionFields) {
      await page.getByLabel(label).fill(value);
      await expect(page.getByLabel(label)).toHaveValue(value);
    }
    await page.getByRole('button', { name: 'המשך' }).click();

    const deductionFields: Array<[string, string]> = [
      ['דמי כיס שכבר שולמו', '100'],
      ['ניכוי ביטוח רפואי', '75'],
      ['ניכוי מגורים', '150'],
      ['מקדמות שכבר שולמו', '200'],
      ['ניכוי מוסכם', '50'],
    ];
    for (const [label, value] of deductionFields) {
      await page.getByLabel(label).fill(value);
      await expect(page.getByLabel(label)).toHaveValue(value);
    }
    await page.getByRole('button', { name: 'המשך' }).click();

    await expect(page.getByText('מתוכם דמי כיס')).toBeVisible();
    await expect(page.getByText(/100\.00/)).toBeVisible();
    await page.getByRole('button', { name: 'חזרה' }).click();
    await expect(page.getByLabel('דמי כיס שכבר שולמו')).toHaveValue('100');
    await page.getByRole('button', { name: 'המשך' }).click();
    await page.getByRole('button', { name: 'אישור ושמירה' }).click();

    await expect(page.getByRole('heading', { name: 'שכר מצטבר והיסטוריה שנתית' })).toBeVisible();
    await page.reload();
    await expect(page.getByText('2026-07', { exact: true })).toBeVisible();
    await page.getByLabel('שנת הדוח').selectOption('2026');
    await page.getByRole('button', { name: 'עריכת החודש' }).click();
    await expect(page.getByLabel('חודש שכר')).toHaveValue('2026-07');

    await page.getByRole('button', { name: 'עדכון שכר בסיס' }).click();
    await page.getByLabel('שכר בסיס חודשי בש״ח').fill('7300');
    await page.getByLabel('בתוקף מתאריך').fill('2026-07-01');
    await page.getByRole('button', { name: 'שמירת הגדרת השכר' }).click();
    await expect(page.getByRole('heading', { name: 'הכנת שכר חודשי' })).toBeVisible();
  });

  test('all dashboard and timeline shortcuts lead to their intended screens', async ({ page }) => {
    await seedCompletedProfile(page);
    await page.goto('/');

    await page.getByRole('link', { name: 'בדיקת הפרטים' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.goto('/');
    await page.getByRole('link', { name: 'פתיחת המסמכים' }).click();
    await expect(page).toHaveURL(/\/documents$/);

    const timelineTargets = ['/documents', '/payroll', '/tasks', '/', '/tasks'];
    for (let index = 0; index < timelineTargets.length; index += 1) {
      await page.goto('/timeline');
      await page.getByRole('link', { name: 'פרטים' }).nth(index).click();
      const expected = timelineTargets[index];
      await expect(page).toHaveURL(new RegExp(`${expected === '/' ? '/$' : `${expected}$`}`));
    }
  });
});
