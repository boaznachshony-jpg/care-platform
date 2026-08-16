/* eslint-disable no-restricted-syntax */
import { expect, test, type Page } from '@playwright/test';
import { installCanonicalProductIntelligence } from './fixtures/canonical-product-intelligence.js';

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
  licensedBureauName: 'תאגיד בדיקת השקה',
  licensedBureauRegistrationNumber: 'LB-2001',
  licensedBureauContactName: 'אשת קשר תאגיד',
  licensedBureauContactPhone: '0531234567',
  licensedBureauContactEmail: 'launch-bureau@example.test',
  notificationsEnabled: true,
  reminderLeadDays: 7,
  quietHoursStart: '21:00',
  quietHoursEnd: '08:00',
  onboardingCompleted: true,
  employmentAgreementConfirmed: true,
  medicalInsuranceConfirmed: true,
  medicalInsuranceExpiryDate: '2027-06-30',
  baseSalary: 7000,
  salaryEffectiveDate: '2026-01-15',
  saturdayRate: 440,
  licenseRenewalDate: '2027-01-15',
  visaRenewalDate: '2026-12-31',
};

async function seedCompletedProfile(page: Page) {
  const canonical = await installCanonicalProductIntelligence(page);
  await page.goto('/app');
  await page.evaluate((profile) => {
    localStorage.clear();
    localStorage.setItem('caredesk.mvp.profile.v1', JSON.stringify(profile));
  }, completedProfile);
  await page.goto('/app');
  if (new URL(page.url()).pathname === '/app') {
    await page.getByRole('button', { name: 'כניסה לתיק' }).click();
  }
  await expect(page).toHaveURL(/\/clients\/[^/]+$/);
  return { ...canonical, clientHome: page.url() };
}

test.describe('launch readiness interactions', () => {
  test('completes every onboarding field and supports backward navigation', async ({ page }) => {
    await page.goto('/app');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByRole('button', { name: 'פתיחת תיק ראשון' }).click();
    const clientBase = page.url().replace(/\/onboarding$/, '');

    await expect(page.getByRole('button', { name: 'חזרה' })).toBeDisabled();
    await page.getByLabel('שם המטופל').fill('מטופל חדש');
    await page.getByRole('button', { name: 'המשך' }).click();
    await page.getByLabel('לא, המעסיק הוא אדם אחר').check();
    await page.getByLabel('שם המעסיק').fill('מעסיק חדש');
    await page.getByLabel('מספר תעודת זהות').fill('123456782');
    await page.getByLabel('מספר טלפון').fill('0501111111');
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

    await page.getByLabel('כן, הוספת אדם מסייע').check();
    await page.getByLabel('שם הנציג המורשה').fill('נציג חדש');
    await page.getByLabel('מספר טלפון').fill('0521111111');
    await page.getByRole('button', { name: 'המשך' }).click();

    await page.getByLabel('בחירת תאגיד או לשכה פרטית מורשית').selectOption('513986042');
    await expect(page.getByText('א. גונן שירותי סיעוד', { exact: true })).toBeVisible();
    await expect(page.getByLabel('שם איש הקשר בתאגיד')).toHaveValue('יקי גרנט');
    await expect(page.getByLabel('טלפון איש הקשר בתאגיד')).toHaveValue('050-5219099');
    await expect(page.getByLabel('דוא״ל איש הקשר בתאגיד')).toHaveValue('gonen09@gmail.com');
    await page.getByRole('button', { name: 'המשך' }).click();

    await page.getByLabel('הסכם ההעסקה נחתם ונשמר').check();
    await page.getByLabel('נרכש ביטוח רפואי והוא בתוקף').check();
    await page.getByLabel('תוקף הביטוח הרפואי עד').fill('2027-06-30');
    await page.getByLabel('שכר בסיס חודשי בש״ח').fill('7000');
    await page.getByLabel('מחיר לשבת או ליום מנוחה בש״ח').fill('440');
    await page.getByLabel('מועד חידוש רישיון ההעסקה').fill('2027-01-15');
    await page.getByLabel('מועד חידוש הוויזה').fill('2026-12-31');
    await page.getByRole('button', { name: 'שמירת הרשימה והמשך לאמצעי תשלום' }).click();

    await expect(page).toHaveURL(/\/billing\?from=onboarding$/);
    await expect(page.getByText('שלב ההקמה האחרון: חיבור אמצעי תשלום מאובטח')).toBeVisible();
    await page.goto(clientBase);
    await expect(page).toHaveURL(clientBase);
    await expect(page.getByRole('heading', { name: 'שלום מעסיק חדש' })).toBeVisible();

    await page.goto(`${clientBase}/tasks`);
    await expect(page.getByRole('heading', { name: 'חידוש ביטוח רפואי' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'חידוש רישיון ההעסקה' })).toBeVisible();
    await expect(page.getByText('מועד יעד: 15.01.2027')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'חידוש הוויזה' })).toBeVisible();
    await expect(page.getByText('מועד יעד: 31.12.2026')).toBeVisible();
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
    const { clientHome } = await seedCompletedProfile(page);
    await page.goto(clientHome);

    await expect(page.getByRole('link', { name: 'דלג לתוכן' })).toHaveAttribute(
      'href',
      '#main-content',
    );
    await page.getByRole('button', { name: 'הגדלת טקסט' }).click();
    await expect(page.locator('html')).toHaveCSS('--ui-scale', '1.15');
    await page.getByRole('button', { name: 'הקטנת טקסט' }).click();
    await expect(page.locator('html')).toHaveCSS('--ui-scale', '1');
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
    await page.locator('#settings-employer-id').fill('123');
    await expect(page.getByRole('alert')).toContainText('אינו תקין');
    await expect(page.getByRole('button', { name: 'שמירת השינויים' })).toBeDisabled();
    await page.locator('#settings-employer-id').fill('123456782');
    await page.locator('#settings-employer-phone').fill('0507654321');
    await page.getByLabel(/מספר דרכון של המטפל/).fill('AB1234567');
    await page.getByLabel('שם הנציג המורשה').fill('נציג מעודכן');
    await page.locator('#settings-representative-phone').fill('0527654321');

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
    await expect(page.locator('#settings-employer-phone')).toHaveValue('0507654321');
    await expect(page.getByLabel(/מספר דרכון של המטפל/)).toHaveValue('AB1234567');
    await expect(page.getByLabel('שם הנציג המורשה')).toHaveValue('נציג מעודכן');
    await expect(page.locator('#settings-representative-phone')).toHaveValue('0527654321');
    await expect(page.getByLabel('כמה זמן מראש להזכיר?')).toHaveValue('30');
    await expect(page.getByLabel('תחילת שעות שקטות')).toHaveValue('22:30');
    await expect(page.getByLabel('סיום שעות שקטות')).toHaveValue('07:15');

    await page.getByRole('link', { name: 'פתיחת ההדרכה מחדש' }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test('uses every monthly payroll input and persists the annual record', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-07-15T12:00:00.000Z'));
    const canonical = await seedCompletedProfile(page);
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
    await page.getByRole('button', { name: '＋ הוספת תשלום' }).click();
    await page.getByLabel('תיאור תשלום נוסף 1').fill('בונוס שירות');
    await page.getByLabel('סכום תשלום נוסף 1').fill('175');
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

    const visiblePayrollSummary = page.locator('.wizard-content .pay-summary');
    await expect(visiblePayrollSummary.getByText('תוספות אחרות')).toBeVisible();
    await expect(visiblePayrollSummary.getByText('בונוס שירות')).toBeVisible();
    await expect(visiblePayrollSummary.getByText('סכום לפני קיזוזים')).toBeVisible();
    await expect(visiblePayrollSummary.getByText(/דמי כיס .*100\.00/)).toBeVisible();
    await expect(page.getByText('מתוכם דמי כיס')).toHaveCount(0);
    await page.getByRole('button', { name: 'חזרה' }).click();
    await expect(page.getByLabel('דמי כיס שכבר שולמו')).toHaveValue('100');
    await page.getByRole('button', { name: 'המשך' }).click();
    await page.getByRole('button', { name: 'אישור ושמירה' }).click();

    await expect(page.getByText('השכר נשמר בהצלחה')).toBeVisible();
    await expect(page.getByRole('button', { name: 'שמירה מחדש' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'עלות ההעסקה לאורך זמן' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'תחזית 12 חודשים' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'סגירת 2026-07' })).toBeVisible();
    await page.getByLabel('תאריך תשלום').fill('2026-08-09');
    await page.getByLabel('אמצעי תשלום').selectOption('bank_transfer');
    await page.getByRole('button', { name: 'אישור שהחודש מוכן וסגירה' }).click();
    const closeHistory = page.getByRole('list', { name: 'היסטוריית סגירות קנונית' });
    await expect(closeHistory).toBeVisible();
    await expect(closeHistory).toContainText('2026-07');
    await expect(closeHistory).toContainText('שולם 2026-08-09');
    await expect(
      page.locator('.forecast-strip details').filter({ hasText: '2026-07' }),
    ).toContainText('בפועל');
    expect(canonical.closeMutationCount()).toBe(1);

    const replayRequest = canonical.lastCloseRequest();
    expect(replayRequest).toBeDefined();
    const replayed = await page.evaluate(async (request) => {
      const response = await fetch(request!.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': request!.key },
        body: JSON.stringify(request!.input),
      });
      return response.json() as Promise<{ replayed: boolean }>;
    }, replayRequest);
    expect(replayed.replayed).toBe(true);
    expect(canonical.closeMutationCount()).toBe(1);

    await page.reload();
    const persistedCloseHistory = page.getByRole('list', {
      name: 'היסטוריית סגירות קנונית',
    });
    await expect(persistedCloseHistory).toContainText('2026-07');
    await expect(persistedCloseHistory).toContainText('שולם 2026-08-09');
    await expect(
      page.locator('.forecast-strip details').filter({ hasText: '2026-07' }),
    ).toContainText('בפועל');

    const nationalInsuranceTracking = page
      .locator('.employment-expenses > div')
      .filter({ hasText: 'נוצר אוטומטית משכר 2026-07' });
    await expect(nationalInsuranceTracking).toContainText('ביטוח לאומי');
    await expect(nationalInsuranceTracking).toContainText('יעד 2026-10-15');
    await expect(nationalInsuranceTracking).toContainText('סכום טרם הוזן');
    await nationalInsuranceTracking.getByRole('button', { name: 'עדכון פרטים' }).click();
    await page.getByLabel(/^סכום בש״ח/).fill('720');
    await page.getByRole('button', { name: 'שמירת עדכון' }).click();
    await expect(nationalInsuranceTracking).toContainText('720.00');

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
    await expect(page.getByRole('heading', { name: 'רישום שכר חודשי' })).toBeVisible();
  });

  test('all dashboard and timeline shortcuts lead to their intended screens', async ({ page }) => {
    const { clientHome } = await seedCompletedProfile(page);
    await page.goto(clientHome);

    await page.getByRole('link', { name: 'בדיקת הפרטים' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.goto(clientHome);
    await page.getByRole('link', { name: 'פתיחת המסמכים' }).click();
    await expect(page).toHaveURL(/\/documents$/);

    const timelineTargets = [
      { title: 'חידוש ביטוח רפואי', path: '/documents' },
      { title: 'חידוש רישיון ההעסקה', path: '/tasks' },
      { title: 'חידוש הוויזה', path: '/tasks' },
    ];
    for (const { title, path: expected } of timelineTargets) {
      await page.goto(`${clientHome}/timeline`);
      const eventCard = page
        .getByRole('article')
        .filter({ has: page.getByRole('heading', { name: title }) });
      await eventCard.getByRole('link', { name: 'פתיחת הפעולה' }).click();
      if (expected === '/') {
        await expect(page).toHaveURL(clientHome);
      } else {
        await expect(page).toHaveURL(new RegExp(`${expected}$`));
      }
    }

    await page.goto(`${clientHome}/timeline`);
    await expect(page.getByRole('heading', { name: 'מה קרה בתיק' })).toBeVisible();
  });

  test('unfinished internal API routes cannot expose a broken screen', async ({ page }) => {
    await seedCompletedProfile(page);

    await page.goto('/cases/new');
    await expect(page).toHaveURL('/');
    await page.goto('/cases/not-a-public-route');
    await expect(page).toHaveURL('/');
  });
});
