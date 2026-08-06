/* eslint-disable no-restricted-syntax */
import { expect, test, type Locator, type Page } from '@playwright/test';

const mobileWidths = [320, 360, 375, 390, 430] as const;
const textScales = [1, 1.3] as const;

function continueButton(page: Page): Locator {
  return page.locator('.wizard-actions button[type="submit"]');
}

function backButton(page: Page): Locator {
  return page.locator('.wizard-actions button[type="button"]');
}

async function clearAndStartOnboarding(page: Page): Promise<string> {
  await page.goto('/app');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.reload();

  const openCase = page.getByRole('button', {
    name: /פתיחת תיק(?: העסקה)? חדש|פתיחת תיק ראשון/,
  });
  await expect(openCase.first()).toBeVisible();
  await openCase.first().click();
  await expect(page).toHaveURL(/\/onboarding$/);
  return page.url();
}

async function expectBlocked(page: Page): Promise<void> {
  await expect(continueButton(page)).toBeDisabled();
  await expect(continueButton(page)).toHaveAttribute('aria-describedby', 'onboarding-blocked-help');
  await expect(page.locator('#onboarding-blocked-help')).toBeVisible();
}

async function expectAccessibleFieldError(field: Locator, page: Page): Promise<void> {
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  const describedBy = await field.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  const ids = describedBy!.split(/\s+/);
  const visibleErrors = ids.map((id) => page.locator(`#${id}.field-error-message`));
  expect(visibleErrors.length).toBeGreaterThan(0);
  await expect(visibleErrors.at(-1)!).toBeVisible();
}

test.describe('ATM onboarding field validation', () => {
  test('validates every field type and preserves data during backward navigation', async ({
    page,
  }) => {
    await clearAndStartOnboarding(page);

    const recipientName = page.getByLabel('שם המטופל');
    await recipientName.fill('123456');
    await recipientName.blur();
    await expectAccessibleFieldError(recipientName, page);
    await expectBlocked(page);

    await recipientName.fill("שרה-לי O'Connor");
    await recipientName.blur();
    await expect(recipientName).not.toHaveAttribute('aria-invalid', 'true');
    await expect(continueButton(page)).toBeEnabled();
    await continueButton(page).click();

    const samePersonChoices = page.locator('.onboarding-choice-group input[name="same-person"]');
    await expect(samePersonChoices).toHaveCount(2);
    await samePersonChoices.last().check();

    const employerName = page.getByLabel('שם המעסיק');
    await employerName.fill('987654');
    await employerName.blur();
    await expectAccessibleFieldError(employerName, page);

    await employerName.fill('דור כהן');
    const employerId = page.getByLabel(/מספר תעודת זהות/);
    await employerId.fill('038-852 566');
    await employerId.blur();
    await expect(employerId).toHaveValue('038852566');
    await expectAccessibleFieldError(employerId, page);
    await expect(page.locator('#employer-id-count')).toContainText('9');
    await expectBlocked(page);

    await employerId.fill('038-852 562');
    await employerId.blur();
    await expect(employerId).toHaveValue('038852562');
    await expect(employerId).not.toHaveAttribute('aria-invalid', 'true');

    const employerPhone = page.getByLabel('מספר טלפון');
    await employerPhone.fill('12345');
    await employerPhone.blur();
    await expectAccessibleFieldError(employerPhone, page);
    await expectBlocked(page);
    await employerPhone.fill('052-123-4567');
    await employerPhone.blur();
    await expect(employerPhone).not.toHaveAttribute('aria-invalid', 'true');
    await expect(continueButton(page)).toBeEnabled();
    await continueButton(page).click();

    const caregiverName = page.getByLabel('שם המטפל או המטפלת');
    await caregiverName.fill('María-José');
    await page.getByLabel('ארץ מוצא').selectOption({ label: 'אוזבקיסטן' });
    await expect(page.getByLabel('שפה מועדפת')).toHaveValue('אוזבקית');
    await page.getByLabel('שפה מועדפת').selectOption({ label: 'רוסית' });
    const employmentStart = page.getByLabel('תאריך תחילת ההעסקה');
    await employmentStart.fill('2026-07-12');
    await expect(employmentStart).toHaveValue('2026-07-12');

    await backButton(page).click();
    await expect(employerName).toHaveValue('דור כהן');
    await expect(employerId).toHaveValue('038852562');
    await expect(employerPhone).toHaveValue('052-123-4567');
    await continueButton(page).click();
    await expect(caregiverName).toHaveValue('María-José');
    await expect(page.getByLabel('שפה מועדפת')).toHaveValue('רוסית');
    await continueButton(page).click();

    const helperChoices = page.locator('.onboarding-choice-group input[name="helper"]');
    await expect(helperChoices).toHaveCount(2);
    await helperChoices.first().check();
    const representativeName = page.getByLabel('שם הנציג המורשה');
    const representativePhone = page.getByLabel('מספר טלפון');
    await representativeName.fill('נועה לוי');
    await representativePhone.fill('+972 52 765 4321');
    await representativePhone.blur();
    await expect(continueButton(page)).toBeEnabled();
    await continueButton(page).click();

    const bureauSelect = page.getByLabel(/בחירת תאגיד|לשכה פרטית מורשית/);
    await bureauSelect.selectOption('__manual__');
    await page.getByLabel('שם התאגיד המורשה').fill('Care 24 בע״מ');
    await page.getByLabel('מספר הרישום או הרישיון של התאגיד').fill('LB-2026/07');
    const bureauMainPhone = page.getByLabel('טלפון ראשי של הלשכה');
    await bureauMainPhone.fill('03-555-1234');
    await page.getByLabel('כתובות הלשכה').fill('רחוב הרצל 24, תל אביב');
    await page.getByLabel('שם איש הקשר בתאגיד').fill("Ya'el כהן");
    await page.getByLabel('טלפון איש הקשר בתאגיד').fill('050-123-4567');

    const bureauEmail = page.getByLabel('דוא״ל איש הקשר בתאגיד');
    await bureauEmail.fill('contact@invalid');
    await bureauEmail.blur();
    await expectAccessibleFieldError(bureauEmail, page);
    await expectBlocked(page);
    await bureauEmail.fill('contact+care24@example.com');
    await bureauEmail.blur();
    await expect(bureauEmail).not.toHaveAttribute('aria-invalid', 'true');
    await expect(continueButton(page)).toBeEnabled();
    await continueButton(page).click();

    await page.getByLabel('הסכם ההעסקה נחתם ונשמר').check();
    await page.getByLabel('נרכש ביטוח רפואי והוא בתוקף').check();
    const insuranceExpiry = page.getByLabel('תוקף הביטוח הרפואי עד');
    await insuranceExpiry.fill('2027-07-12');

    const baseSalary = page.getByLabel('שכר בסיס חודשי בש״ח');
    const saturdayRate = page.getByLabel('מחיר לשבת או ליום מנוחה בש״ח');
    await baseSalary.fill('0');
    await saturdayRate.fill('-1');
    await expectBlocked(page);
    expect(await baseSalary.evaluate((element: HTMLInputElement) => element.checkValidity())).toBe(
      false,
    );
    expect(
      await saturdayRate.evaluate((element: HTMLInputElement) => element.checkValidity()),
    ).toBe(false);

    await baseSalary.fill('6450.50');
    await saturdayRate.fill('440.25');
    await page.getByLabel('מועד חידוש רישיון ההעסקה').fill('2027-07-12');
    await page.getByLabel('מועד תשלום אגרת ההעסקה').fill('2026-08-15');
    await expect(baseSalary).toHaveValue('6450.50');
    await expect(saturdayRate).toHaveValue('440.25');
    await expect(continueButton(page)).toBeEnabled();
  });

  test('autosaves a partial draft and resumes the exact step after reload', async ({ page }) => {
    const onboardingUrl = await clearAndStartOnboarding(page);
    const recipientName = page.getByLabel('שם המטופל');
    await recipientName.fill('רחל בן־דוד');
    await recipientName.blur();
    await expect(page.locator('.onboarding-save-status')).toBeVisible();
    await expect(continueButton(page)).toBeEnabled();
    await continueButton(page).click();

    const samePersonChoices = page.locator('.onboarding-choice-group input[name="same-person"]');
    await samePersonChoices.first().check();
    await expect(page.locator('.info-box').getByText(/רחל בן־דוד/)).toBeVisible();
    await page.reload();

    await expect(page).toHaveURL(onboardingUrl);
    await expect(page.locator('.progress-label')).toContainText('2');
    await expect(samePersonChoices.first()).toBeChecked();
    await backButton(page).click();
    await expect(recipientName).toHaveValue('רחל בן־דוד');
  });
});

interface MobileAudit {
  innerWidth: number;
  scrollWidth: number;
  undersizedTargets: string[];
}

async function auditMobileLayout(page: Page): Promise<MobileAudit> {
  return page.evaluate(() => {
    const visible = (element: HTMLElement) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const selector = [
      'button',
      '[role="button"]',
      'summary',
      'a',
      'input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"])',
      'select',
      'textarea',
    ].join(',');
    const undersizedTargets = [...document.querySelectorAll<HTMLElement>(selector)]
      .filter(visible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width < 47.5 || rect.height < 47.5;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const label =
          element.getAttribute('aria-label') ||
          element.textContent?.trim().slice(0, 40) ||
          element.tagName.toLowerCase();
        return `${element.tagName.toLowerCase()} "${label}" ${Math.round(rect.width)}x${Math.round(rect.height)}`;
      });

    return {
      innerWidth: window.innerWidth,
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      undersizedTargets,
    };
  });
}

async function expectMobileAuditPasses(page: Page): Promise<void> {
  const audit = await auditMobileLayout(page);
  expect(audit.scrollWidth).toBeLessThanOrEqual(audit.innerWidth + 1);
  expect(audit.undersizedTargets).toEqual([]);
}

async function installAuthFixture(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('#root');
    if (!root) throw new Error('Missing application root');
    root.innerHTML = `
      <main class="auth-page" dir="rtl">
        <section class="auth-card" aria-label="כניסה מאובטחת">
          <div class="auth-brand" aria-hidden="true">C</div>
          <h1>כניסה מאובטחת</h1>
          <p>הכניסו את כתובת הדוא״ל והסיסמה.</p>
          <div class="auth-mode-switch">
            <button class="active" type="button">כבר יש לי חשבון</button>
            <button type="button">פתיחת חשבון</button>
          </div>
          <form>
            <label>כתובת דוא״ל<input type="email" value="older-adult@example.com" /></label>
            <label>סיסמה<input type="password" value="strong-password" /></label>
            <button class="primary-button" type="button">כניסה למערכת</button>
          </form>
          <button class="auth-secondary-button" type="button">שכחתם את הסיסמה?</button>
        </section>
      </main>`;
  });
}

test.describe('ATM mobile layout', () => {
  test('has no horizontal overflow and keeps touch targets at least 48px', async ({ page }) => {
    test.setTimeout(120_000);
    const onboardingUrl = await clearAndStartOnboarding(page);

    for (const width of mobileWidths) {
      for (const scale of textScales) {
        await page.setViewportSize({ width, height: 844 });

        await installAuthFixture(page);
        await page.evaluate((nextScale) => {
          document.documentElement.style.setProperty('--ui-scale', String(nextScale));
        }, scale);
        await expectMobileAuditPasses(page);

        await page.goto('/app');
        await page.evaluate((nextScale) => {
          document.documentElement.style.setProperty('--ui-scale', String(nextScale));
        }, scale);
        await expectMobileAuditPasses(page);

        await page.goto(onboardingUrl);
        await page.evaluate((nextScale) => {
          document.documentElement.style.setProperty('--ui-scale', String(nextScale));
        }, scale);
        await expectMobileAuditPasses(page);
      }
    }
  });
});
