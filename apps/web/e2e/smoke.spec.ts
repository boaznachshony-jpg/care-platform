/* eslint-disable no-restricted-syntax */
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/app');
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
  licensedBureauName: 'תאגיד בדיקה',
  licensedBureauRegistrationNumber: 'LB-1001',
  licensedBureauContactName: 'איש קשר תאגיד',
  licensedBureauContactPhone: '0531234567',
  licensedBureauContactEmail: 'bureau@example.test',
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

async function seedCompletedProfile(page: import('@playwright/test').Page) {
  await page.evaluate((profile) => {
    localStorage.setItem('caredesk.mvp.profile.v1', JSON.stringify(profile));
  }, completedProfile);
}

async function completeClientOnboarding(
  page: import('@playwright/test').Page,
  employerName: string,
  recipientName: string,
  caregiverName: string,
) {
  const clientBase = page.url().replace(/\/onboarding$/, '');
  await page.getByLabel('שם המטופל').fill(recipientName);
  await page.getByRole('button', { name: 'המשך' }).click();
  await page.getByLabel('לא, המעסיק הוא אדם אחר').check();
  await page.getByLabel('שם המעסיק').fill(employerName);
  await page.getByLabel('מספר תעודת זהות').fill('123456782');
  await page.getByLabel('מספר טלפון').fill('0501234567');
  await page.getByRole('button', { name: 'המשך' }).click();
  await page.getByLabel('שם המטפל או המטפלת').fill(caregiverName);
  await page.getByLabel('ארץ מוצא').selectOption('אוזבקיסטן');
  await page.getByLabel('שפה מועדפת').selectOption('אוזבקית');
  await page.getByLabel('תאריך תחילת ההעסקה').fill('2026-01-15');
  await page.getByRole('button', { name: 'המשך' }).click();
  await page.getByLabel('כן, הוספת אדם מסייע').check();
  await page.getByLabel('שם הנציג המורשה').fill('נציג בדיקה');
  await page.getByLabel('מספר טלפון').fill('0521234567');
  await page.getByRole('button', { name: 'המשך' }).click();
  await page.getByLabel('בחירת תאגיד או לשכה פרטית מורשית').selectOption('513986042');
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
}

test('creates and switches between two isolated client records', async ({ page }) => {
  await page.getByRole('button', { name: 'פתיחת תיק ראשון' }).click();
  await completeClientOnboarding(page, 'מעסיק ראשון', 'מטופל ראשון', 'Caregiver One');
  const firstClientUrl = page.url();
  await page.locator('a.top-client-switch').click();
  await expect(page.getByRole('heading', { name: 'תיקי ההעסקה שלי' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'מטופל ראשון' })).toBeVisible();

  await page.getByRole('button', { name: /פתיחת תיק חדש/ }).click();
  await completeClientOnboarding(page, 'מעסיק שני', 'מטופל שני', 'Caregiver Two');
  const secondClientUrl = page.url();
  expect(secondClientUrl).not.toBe(firstClientUrl);

  await page.locator('a.top-client-switch').click();
  await expect(page.getByRole('heading', { name: 'מטופל ראשון' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'מטופל שני' })).toBeVisible();
  await page.goto(firstClientUrl);
  await expect(page.getByRole('heading', { name: 'שלום מעסיק ראשון' })).toBeVisible();
  await expect(page.getByText('Caregiver One')).toBeVisible();
  await page.goto(secondClientUrl);
  await expect(page.getByRole('heading', { name: 'שלום מעסיק שני' })).toBeVisible();
  await expect(page.getByText('Caregiver Two')).toBeVisible();
});

test('completes onboarding, persists data and updates settings', async ({ page }) => {
  await page.getByRole('button', { name: 'פתיחת תיק ראשון' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  const clientBase = page.url().replace(/\/onboarding$/, '');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  await page.getByLabel('שם המטופל').fill('מטופל בדיקה');
  await page.getByRole('button', { name: 'המשך' }).click();
  await page.getByLabel('לא, המעסיק הוא אדם אחר').check();
  await page.getByLabel('שם המעסיק').fill('בועז בדיקה');
  await page.getByLabel('מספר תעודת זהות').fill('123456782');
  await page.getByLabel('מספר טלפון').fill('0501234567');
  await page.getByRole('button', { name: 'המשך' }).click();

  await page.getByLabel('שם המטפל או המטפלת').fill('Caregiver Test');
  await page.getByLabel('ארץ מוצא').selectOption('אוזבקיסטן');
  await page.getByLabel('שפה מועדפת').selectOption('אוזבקית');
  await page.getByLabel('תאריך תחילת ההעסקה').fill('2026-01-15');
  await page.getByRole('button', { name: 'המשך' }).click();

  await page.getByLabel('כן, הוספת אדם מסייע').check();
  await page.getByLabel('שם הנציג המורשה').fill('נציג בדיקה');
  await page.getByLabel('מספר טלפון').fill('0521234567');
  await page.getByRole('button', { name: 'המשך' }).click();
  await page.getByLabel('בחירת תאגיד או לשכה פרטית מורשית').selectOption('513986042');
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
  await expect(page.getByRole('heading', { name: 'שלום בועז בדיקה' })).toBeVisible();
  await expect(page.getByText('מטופל בדיקה')).toBeVisible();
  await expect(page.getByText('Caregiver Test')).toBeVisible();
  await expect(page.getByText('דורש טיפול', { exact: true })).toBeVisible();
  await page.goto(`${clientBase}/tasks`);
  const insuranceTask = page.locator('.list-task').filter({ hasText: 'חידוש ביטוח רפואי' });
  await expect(insuranceTask).toContainText('30.06.2027');
  await expect(insuranceTask).toContainText('נוצרה אוטומטית');

  await page.goto(`${clientBase}/settings`);
  await page.getByLabel('שם המעסיק').fill('בועז מעודכן');
  await page.getByLabel('כמה זמן מראש להזכיר?').selectOption('21');
  await page.getByRole('button', { name: 'שמירת השינויים' }).click();
  await expect(page.getByText('השינויים נשמרו בהצלחה')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('שם המעסיק')).toHaveValue('בועז מעודכן');
  await expect(page.getByLabel('כמה זמן מראש להזכיר?')).toHaveValue('21');

  await page.goto(clientBase);
  await expect(page.getByRole('heading', { name: 'שלום בועז מעודכן' })).toBeVisible();
});

test('mobile controls remain readable and touch friendly', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'פתיחת תיק ראשון' }).click();
  await expect(page.getByRole('heading', { name: 'בואו נכין את תיק ההעסקה' })).toBeVisible();
  const continueButton = page.getByRole('button', { name: 'המשך' });
  await expect(continueButton).toBeVisible();
  const box = await continueButton.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(48);
});

test('mobile layouts stay symmetrical at the largest text size', async ({ page }) => {
  await seedCompletedProfile(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem('caredesk.ui.font-scale.v1', '1.3'));
  await page.goto('/app');
  const clientHome = page.url();
  const routes = [
    '',
    '/tasks',
    '/employee',
    '/trust',
    '/glossary',
    '/documents',
    '/timeline',
    '/payroll',
    '/settings',
  ];

  for (const route of routes) {
    await page.goto(`${clientHome}${route}`);
    const layout = await page.evaluate(() => {
      const controls = Array.from(
        document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
          "input:not([type='checkbox']):not([type='radio']):not([type='file']), select",
        ),
      ).map((element) => {
        const rect = element.getBoundingClientRect();
        return { height: Math.round(rect.height), left: rect.left, right: rect.right };
      });
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        controls,
      };
    });

    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    for (const control of layout.controls) {
      expect(control.height).toBe(60);
      expect(control.left).toBeGreaterThanOrEqual(0);
      expect(control.right).toBeLessThanOrEqual(layout.clientWidth);
    }
  }
});

test('mobile navigation keeps payroll accessible', async ({ page }) => {
  await seedCompletedProfile(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app');
  await expect(page.getByRole('navigation', { name: 'ניווט תחתון' })).toContainText('שכר');
  await page
    .getByRole('navigation', { name: 'ניווט תחתון' })
    .getByRole('link', { name: '₪ שכר' })
    .click();
  await expect(page).toHaveURL(/\/payroll$/);
  await expect(page.getByRole('heading', { name: 'הכנת שכר חודשי' })).toBeVisible();
});

const productRoutes = [
  ['/app', 'שלום בועז בדיקה'],
  ['/tasks', 'מה צריך לבצע'],
  ['/employee', 'Caregiver Test'],
  ['/trust', 'מסרים לבניית אמון'],
  ['/glossary', 'מושגים חשובים'],
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

test('connects every primary screen through visible navigation and action links', async ({
  page,
}, testInfo) => {
  await seedCompletedProfile(page);
  await page.goto('/app');
  await expect(page).toHaveURL(/\/clients\/[^/]+$/);
  const clientHome = page.url();

  if (testInfo.project.name === 'mobile-chromium') {
    const directConnections = [
      ['משימות', '/tasks', 'מה צריך לבצע'],
      ['שכר', '/payroll', 'הכנת שכר חודשי'],
      ['מסמכים', '/documents', 'כל המסמכים במקום אחד'],
    ] as const;
    for (const [linkName, route, expectedText] of directConnections) {
      await page.goto(clientHome);
      await page
        .getByRole('navigation', { name: 'ניווט תחתון' })
        .getByRole('link', { name: new RegExp(linkName) })
        .click();
      await expect(page).toHaveURL(new RegExp(`${route.replace('/', '\\/')}$`));
      await expect(page.getByRole('main')).toContainText(expectedText);
    }

    const moreConnections = [
      ['פרטי המטפל', '/employee', 'Caregiver Test'],
      ['מסרים לבניית אמון', '/trust', 'מסרים לבניית אמון'],
      ['מושגים חשובים', '/glossary', 'מושגים חשובים'],
      ['ציר זמן', '/timeline', 'המועדים הבאים'],
      ['הגדרות', '/settings', 'פרטים והעדפות'],
    ] as const;
    for (const [linkName, route, expectedText] of moreConnections) {
      await page.goto(clientHome);
      await page.getByRole('button', { name: 'עוד' }).click();
      await page
        .getByRole('navigation', { name: 'ניווט נוסף' })
        .getByRole('link', { name: new RegExp(linkName) })
        .click();
      await expect(page).toHaveURL(new RegExp(`${route.replace('/', '\\/')}$`));
      await expect(page.getByRole('main')).toContainText(expectedText);
    }
  } else {
    const connections = [
      ['משימות', '/tasks', 'מה צריך לבצע'],
      ['עובד', '/employee', 'Caregiver Test'],
      ['מושגים', '/glossary', 'מושגים חשובים'],
      ['מסמכים', '/documents', 'כל המסמכים במקום אחד'],
      ['ציר זמן', '/timeline', 'המועדים הבאים'],
      ['שכר', '/payroll', 'הכנת שכר חודשי'],
      ['הגדרות', '/settings', 'פרטים והעדפות'],
    ] as const;
    for (const [linkName, route, expectedText] of connections) {
      await page.goto(clientHome);
      await page
        .getByRole('complementary', { name: 'ניווט ראשי' })
        .getByRole('link', { name: new RegExp(linkName) })
        .click();
      await expect(page).toHaveURL(new RegExp(`${route.replace('/', '\\/')}$`));
      await expect(page.getByRole('main')).toContainText(expectedText);
    }
  }

  await page.goto(`${clientHome}/employee`);
  await page.getByRole('link', { name: 'מסרים לבניית אמון' }).click();
  await expect(page).toHaveURL(/\/trust$/);
  await page.getByRole('link', { name: 'לפרטי המטפל' }).click();
  await expect(page).toHaveURL(/\/employee$/);
});

test('connects trust tips and the general glossary in both directions', async ({ page }) => {
  await seedCompletedProfile(page);
  await page.goto('/trust');
  await page.getByRole('link', { name: 'למושגים חשובים' }).click();
  await expect(page).toHaveURL(/\/glossary$/);
  await expect(page.getByRole('heading', { name: 'מעסיק' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'מטפל או מטפלת' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'מורשה', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'מורשה נוסף' })).toBeVisible();
  await expect(page.getByText(/אינה מעניקה הרשאת כניסה/)).toBeVisible();
  await page.getByRole('link', { name: 'לטיפים לבניית אמון' }).click();
  await expect(page).toHaveURL(/\/trust$/);
});

test('creates, persists, completes and restores a task', async ({ page }) => {
  await seedCompletedProfile(page);
  await page.goto('/tasks');
  await page.getByRole('button', { name: /משימה חדשה/ }).click();
  await page.getByLabel('מה צריך לבצע?').fill('בדיקת ביטוח רפואי');
  await page.getByLabel('מועד יעד').fill('2026-08-03');
  await page.getByLabel('עדיפות').selectOption('important');
  await page.getByRole('button', { name: 'שמירת המשימה' }).click();
  await page.reload();

  const task = page.getByRole('article').filter({ hasText: 'בדיקת ביטוח רפואי' });
  const checkbox = task.getByRole('button', { name: 'השלמת בדיקת ביטוח רפואי' });
  await checkbox.click();
  await expect(task).not.toBeVisible();
  await page.getByRole('button', { name: 'הושלמו' }).click();
  await expect(page.getByText('בדיקת ביטוח רפואי')).toBeVisible();
  await page.getByRole('button', { name: 'החזרת בדיקת ביטוח רפואי' }).click();
  await page.getByRole('button', { name: 'פתוחות' }).click();
  await expect(page.getByText('בדיקת ביטוח רפואי')).toBeVisible();

  await task.getByRole('button', { name: 'עריכה' }).click();
  await page.getByLabel('מה צריך לבצע?').fill('בדיקת ביטוח רפואי מעודכנת');
  await page.getByRole('button', { name: 'שמירת המשימה' }).click();
  await page.reload();
  const updatedTask = page.getByRole('article').filter({ hasText: 'בדיקת ביטוח רפואי מעודכנת' });
  await expect(updatedTask).toBeVisible();
  page.once('dialog', (dialog) => dialog.dismiss());
  await updatedTask.getByRole('button', { name: 'מחיקה' }).click();
  await expect(updatedTask).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await updatedTask.getByRole('button', { name: 'מחיקה' }).click();
  await expect(updatedTask).not.toBeVisible();
});

test('opens the relevant workflow from timeline details', async ({ page }) => {
  await seedCompletedProfile(page);
  await page.goto('/timeline');

  await page
    .getByRole('article')
    .filter({ hasText: 'בדיקת ביטוח רפואי' })
    .getByRole('link', { name: 'פרטים' })
    .click();

  await expect(page).toHaveURL(/\/documents$/);
  await expect(page.getByRole('heading', { name: 'כל המסמכים במקום אחד' })).toBeVisible();
});

test('shows the quarterly national insurance payment window and deadline', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-10T12:00:00'));
  await seedCompletedProfile(page);
  await page.goto('/tasks');

  const card = page.getByRole('region', { name: 'משימת ביטוח לאומי רבעונית' });
  await expect(card).toContainText('תשלום ביטוח לאומי לרבעון יולי–ספטמבר');
  await expect(card).toContainText('תקופת דיווח: 1.7–30.9');
  await expect(card).toContainText('ניתן לשלם בין 1.10 ל־15.10');
  await expect(card).toContainText('מועד אחרון: 15 באוקטובר');
  await expect(card).toContainText('דורש טיפול');
  await expect(card).not.toContainText('מועד אחרון: 30 בספטמבר');
  await expect(
    card.getByRole('link', { name: 'מעבר לאתר הביטוח הלאומי לדיווח ולתשלום' }),
  ).toHaveAttribute('href', 'https://b2b.btl.gov.il/BTL.ILG.Payments/MeshekBaitInfoShort.aspx');
});

test('enlarges text globally and preserves the preference after reload', async ({ page }) => {
  await seedCompletedProfile(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'הגדלת טקסט' }).click();
  await expect(page.locator('html')).toHaveCSS('--ui-scale', '1.15');
  await page.reload();
  await expect(page.locator('html')).toHaveCSS('--ui-scale', '1.15');
});

test('notification bell opens the list of open tasks', async ({ page }) => {
  await seedCompletedProfile(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      'caredesk.mvp.tasks.v1',
      JSON.stringify([
        {
          id: 'notification-task',
          title: 'טיפול בביטוח רפואי',
          dueDate: new Date().toISOString().slice(0, 10),
          priority: 'urgent',
          status: 'open',
          createdAt: new Date().toISOString(),
        },
      ]),
    );
  });
  await page.goto('/app');

  await page
    .getByRole('link', {
      name: /^מעבר למשימות פתוחות, \d+ נושאים לטיפול$/,
    })
    .click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByText('טיפול בביטוח רפואי')).toBeVisible();
});

test('walks through all payroll steps', async ({ page }) => {
  await seedCompletedProfile(page);
  await page.goto('/payroll');
  const next = page.getByRole('button', { name: 'המשך' });
  const payrollMonth = await page.getByLabel('חודש שכר').inputValue();
  await next.click();
  await expect(page.getByRole('heading', { name: 'שכר בסיס ושבתות' })).toBeVisible();
  const payrollYear = Number(payrollMonth.slice(0, 4));
  const payrollMonthNumber = Number(payrollMonth.slice(5, 7));
  const daysInPayrollMonth = new Date(payrollYear, payrollMonthNumber, 0).getDate();
  const baseDays = Array.from({ length: daysInPayrollMonth }, (_, index) => index + 1).filter(
    (day) => new Date(payrollYear, payrollMonthNumber - 1, day).getDay() !== 6,
  );
  const paidBaseDays = baseDays.filter((day) => day >= 16).length;
  await page.getByLabel('תאריך תחילת עבודה בחודש, לחישוב יחסי').fill(`${payrollMonth}-16`);
  await expect(page.getByText(`${paidBaseDays} מתוך ${baseDays.length} ימי בסיס`)).toBeVisible();
  await expect(page.getByText(/מהמכנה הוצאו .* שבתות/)).toBeVisible();
  await page.getByLabel('מספר שבתות או ימי מנוחה שעבדו').fill('3');
  await page.getByLabel('תעריף לכל שבת או יום מנוחה').fill('400');
  await expect(page.getByText(/3 ×/)).toBeVisible();
  await next.click();
  await expect(page.getByRole('heading', { name: 'תוספות נוספות' })).toBeVisible();
  await page.getByLabel('תוספת אחרת, אם קיימת').fill('250');
  await next.click();
  await expect(page.getByRole('heading', { name: 'מקדמות וקיזוזים' })).toBeVisible();
  await page.getByLabel('מקדמות שכבר שולמו').fill('500');
  await next.click();
  await expect(page.getByRole('heading', { name: 'סיכום ואישור' })).toBeVisible();
  await expect(page.getByText('נתוני העסקה', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.print = () => {
      document.body.dataset.printInvoked = 'true';
    };
  });
  await expect(page.getByRole('button', { name: 'הדפסה / שמירה כ־PDF' })).toHaveCount(0);
  await page.getByRole('button', { name: 'תצוגה מקדימה להדפסה' }).click();
  await expect(page.getByText('תצוגה מקדימה לפני הדפסה')).toBeVisible();
  await expect(page.getByText('Monthly pay summary')).toBeVisible();
  await page.getByRole('button', { name: 'הדפסה / שמירה כ־PDF' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-print-invoked', 'true');
  await page.getByRole('button', { name: 'אישור ושמירה' }).click();
  await expect(page.getByText('השכר נשמר בהצלחה')).toBeVisible();
  await expect(page.getByRole('button', { name: 'שמירה מחדש' })).toBeVisible();
  await expect(
    page.getByText('חישוב השכר החודשי נשמר. מעקב התשלום לביטוח לאומי הופעל לרבעון גם ללא סכום.'),
  ).toBeVisible();
  await expect(page.locator('.employment-expenses').getByText('סכום טרם הוזן')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'שכר מצטבר והיסטוריה שנתית' })).toBeVisible();
  await expect(page.getByText(/סה״כ לתשלום בשנת/)).toBeVisible();
});

test('returns from the first payroll step to the dashboard', async ({ page }) => {
  await seedCompletedProfile(page);
  await page.goto('/payroll');

  await page.getByRole('link', { name: 'חזרה לדף הבית' }).click();

  await expect(page).toHaveURL(/\/clients\/[^/]+$/);
  await expect(page.getByRole('heading', { name: /שלום/ })).toBeVisible();
});

test('tracks quarterly and annual employment expenses', async ({ page }) => {
  await seedCompletedProfile(page);
  await page.goto('/payroll');
  await expect(page.getByRole('heading', { name: 'תשלומים תקופתיים של ההעסקה' })).toBeVisible();
  await page.getByLabel('סוג התשלום').selectOption({ label: 'ביטוח לאומי' });
  await page.getByLabel('תדירות').selectOption('quarterly');
  await page.getByLabel('סכום בש״ח').fill('1840');
  await page.getByLabel('תאריך יעד').fill('2026-10-20');
  await page.getByLabel('הערה או אסמכתה').fill('רבעון שלישי');
  await page.getByRole('button', { name: 'הוספת תשלום למעקב' }).click();
  await expect(page.getByText('התשלום התקופתי נשמר בלוח עלויות ההעסקה.')).toBeVisible();
  await expect(page.getByText('רבעוני · יעד 2026-10-20 · רבעון שלישי')).toBeVisible();
  await page.reload();
  await expect(page.locator('.employment-expenses strong').getByText('ביטוח לאומי')).toBeVisible();
  const expense = page.locator('.employment-expenses > div').filter({ hasText: 'ביטוח לאומי' });
  await expense.getByRole('button', { name: 'סימון כשולם' }).click();
  await page.reload();
  await expect(
    page
      .locator('.employment-expenses > div')
      .filter({ hasText: 'ביטוח לאומי' })
      .getByRole('button', { name: 'שולם ✓' }),
  ).toBeVisible();

  page.once('dialog', (dialog) => dialog.dismiss());
  await expense.getByRole('button', { name: 'מחיקה' }).click();
  await expect(expense).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await expense.getByRole('button', { name: 'מחיקה' }).click();
  await expect(expense).not.toBeVisible();
});

test('adds, opens, edits and persists a realistic image document', async ({ page }) => {
  await seedCompletedProfile(page);
  await page.goto('/documents');
  await expect(page.getByText('עדיין לא נוספו מסמכים')).toBeVisible();
  await page.getByRole('button', { name: '↑ הוספת מסמך' }).click();
  await page.getByLabel('שם המסמך').fill('דרכון בדיקה');
  await page.getByLabel('סוג').selectOption('דרכון');
  await page.getByLabel('תוקף המסמך').fill('2028-12-31');
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

  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'מחיקה' }).click();
  await expect(page.getByRole('heading', { name: 'דרכון מעודכן' })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'מחיקה' }).click();
  await expect(page.getByText('עדיין לא נוספו מסמכים')).toBeVisible();
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
