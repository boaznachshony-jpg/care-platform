/* eslint-disable no-restricted-syntax -- E2E locators and gate messages use the Hebrew product contract */
/**
 * Release gate §2 — "מטריצת רוחבים ויזואלית".
 *
 * Three layout defects reached production on 22.8.2026 and only the customer found
 * them: the banner slid under the sidebar, "יציאה" spilled out of its button, and
 * four buttons stacked on top of each other on a wide screen. 764 logic tests were
 * green the whole time, because none of them measured a pixel.
 *
 * This spec measures pixels. It takes no screenshots and compares no images: every
 * assertion is a number read out of the live layout, so a failure says
 * "חופף ב-208px", never "נראה חתוך".
 *
 * R4-04 (01.09.2026): the matrix covered six screens and none of them was a
 * money screen. The payroll wizard, the national-insurance table, the annual
 * report, documents, medications, settings, open issues and family access are
 * added below. The gap was never the widths — those were already the seven the
 * release gate names — it was the screens.
 *
 * Run: `pnpm --filter @caredesk/web test:e2e --project=layout-matrix`
 */
import { expect, test, type Page } from '@playwright/test';
import { installCanonicalProductIntelligence } from './fixtures/canonical-product-intelligence.js';
import { enterSeededClient } from './fixtures/seeded-client.js';
import { installFamilyAccessApi } from './fixtures/wave5-collaboration.js';
import {
  MATRIX_WIDTHS,
  MIN_TOUCH_TARGET_PX,
  MOBILE_TOUCH_TARGET_PX,
  collectLayoutSnapshot,
  findLayoutViolations,
  formatViolationReport,
  type LayoutSnapshot,
} from './fixtures/layout-matrix.js';

/** The width below which `.sidebar` is display:none (global.css `@media (max-width: 760px)`). */
const SIDEBAR_BREAKPOINT_PX = 760;

/**
 * Below this, the hero actions are supposed to wrap: four buttons at
 * `flex: 1 1 170px` plus gaps need roughly 700px before they fit on one line.
 * The equal-size rule is only meaningful once they actually share a row.
 */
const ACTION_ROW_MIN_WIDTH_PX = 768;

const completedProfile = {
  employerName: 'מעסיק מטריצת רוחבים',
  employerIdNumber: '123456782',
  employerPhone: '0501234567',
  recipientName: 'מטופל מטריצת רוחבים',
  caregiverName: 'Dilnoza',
  caregiverCountry: 'אוזבקיסטן',
  caregiverLanguage: 'אוזבקית',
  employmentStartDate: '2026-01-15',
  representativeName: 'נציג מטריצת רוחבים',
  representativePhone: '0521234567',
  licensedBureauName: 'תאגיד מטריצת רוחבים',
  licensedBureauRegistrationNumber: 'LB-3001',
  licensedBureauContactName: 'איש קשר תאגיד',
  licensedBureauContactPhone: '0531234567',
  licensedBureauContactEmail: 'matrix-bureau@example.test',
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

function viewportHeightFor(width: number): number {
  if (width <= 430) return 844;
  if (width <= 768) return 1024;
  return 900;
}

/**
 * Measures the screen that is currently open and fails with the numbers.
 * Returns the snapshot so callers can add screen-specific assertions.
 */
async function auditScreen(page: Page, width: number, screen: string): Promise<LayoutSnapshot> {
  await page.waitForLoadState('load');
  // Font swapping changes text extents, and text extents are half of what this
  // gate measures. Wait for the final metrics rather than the first paint.
  await page.evaluate(() => document.fonts.ready.then(() => true));

  const snapshot = await page.evaluate(collectLayoutSnapshot);
  const violations = findLayoutViolations(snapshot);
  expect(violations, formatViolationReport(width, screen, violations)).toEqual([]);

  // A green matrix on an empty page proves nothing. Every audited screen must have
  // actually rendered controls for the measurements above to mean anything.
  expect(
    snapshot.buttons.length + snapshot.touchTargets.length,
    `מטריצת רוחבים — מסך ${screen} ברוחב ${width}px לא הציג אף פקד, אין מה למדוד`,
  ).toBeGreaterThan(0);

  return snapshot;
}

test.describe('מטריצת רוחבים ויזואלית (שער שחרור §2)', () => {
  for (const width of MATRIX_WIDTHS) {
    test(`רוחב ${width}px — אין גלישה, חפיפה, גלישת טקסט או מטרת מגע קטנה`, async ({ page }) => {
      test.slow();
      await installCanonicalProductIntelligence(page);
      await page.setViewportSize({ width, height: viewportHeightFor(width) });

      // --- public pages: the landing page is where new customers arrive.
      const publicRoutes: [string, string][] = [
        ['/', 'דף נחיתה'],
        ['/guide/direct-caregiver-employment', 'מדריך העסקה ישירה'],
        ['/contact-us', 'יצירת קשר ציבורי'],
      ];
      for (const [route, screen] of publicRoutes) {
        await page.goto(route);
        await auditScreen(page, width, screen);
      }

      // --- the main app list screen, empty and populated.
      await page.goto('/app');
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await auditScreen(page, width, '/app — רשימת תיקים ריקה');

      const clientHome = await enterSeededClient(page, completedProfile, { clearStorage: true });
      await page.goto('/app');
      await expect(page.getByRole('heading', { name: 'תיקי ההעסקה שלי' })).toBeVisible();
      const listSnapshot = await auditScreen(page, width, '/app — רשימת תיקים מאוכלסת');
      // The four hero buttons that stacked on a 3127px screen in production live here.
      //
      // Only asserted from 768px up. The defect this guards against is buttons
      // stacking where they had room to sit side by side; below that width they
      // are meant to stack, `flex: 1 1 170px` wraps them, and "no action row"
      // is the correct outcome rather than a finding. Demanding a row at 360px
      // would make the matrix red for doing its job properly.
      if (width >= ACTION_ROW_MIN_WIDTH_PX) {
        expect(
          listSnapshot.actionRows.length,
          `מטריצת רוחבים — לא זוהתה אף שורת פעולה ב-/app ברוחב ${width}px`,
        ).toBeGreaterThan(0);
      }

      // --- an authenticated screen, which is the only place the fixed sidebar exists.
      await page.goto(clientHome);
      await expect(page.getByRole('heading', { name: /שלום/ })).toBeVisible();
      const dashboard = await auditScreen(page, width, 'דשבורד תיק העסקה');
      if (width >= SIDEBAR_BREAKPOINT_PX) {
        expect(
          dashboard.sidebar,
          `מטריצת רוחבים — הסייד-בר לא נמדד ברוחב ${width}px, בדיקת החפיפה לא רצה`,
        ).not.toBeNull();
      }

      await page.goto(`${clientHome}/tasks`);
      await auditScreen(page, width, 'מסך משימות');
    });
  }

  /**
   * R4-04 — the money screens.
   *
   * Until now the matrix measured six screens and none of them was the payroll
   * wizard: the longest form in the product, the only place an amount is
   * entered, and the screen a 50-60-year-old owner fills in on a phone. PR #114
   * then put a `ValueOrigin` provenance badge beside every figure in the
   * wizard, the national-insurance table and the annual report — an extra line
   * next to each amount, on exactly the screens no width test covered.
   *
   * Every step is audited, not only the first: steps 2-5 are where the badges
   * are, step 5 is the printable summary, and the annual report only exists
   * once a month has been saved. The national-insurance card is on the same
   * route below the wizard, so it is measured at every step.
   *
   * Kept as its own test rather than appended to the one above so the two run
   * in parallel workers instead of doubling one test's wall clock.
   */
  for (const width of MATRIX_WIDTHS) {
    test(`רוחב ${width}px — אשף השכר על חמשת שלביו, טבלת הביטוח הלאומי והדוח השנתי`, async ({
      page,
    }) => {
      test.slow();
      await installCanonicalProductIntelligence(page);
      await page.setViewportSize({ width, height: viewportHeightFor(width) });

      const clientHome = await enterSeededClient(page, completedProfile, { clearStorage: true });
      await page.goto(`${clientHome}/payroll`);
      await expect(page.getByRole('heading', { level: 1, name: 'רישום שכר חודשי' })).toBeVisible();

      // The Institute's monthly table renders from the default quarterly
      // period, so it is on screen from the first audit. Asserted rather than
      // assumed: a matrix that measured an absent table would be green for the
      // wrong reason.
      await expect(page.locator('.ni-month-list > li').first()).toBeVisible();
      await auditScreen(page, width, 'שכר — שלב 1/5 בחירת חודש + טבלת ביטוח לאומי');

      const wizardSteps: [string, string][] = [
        ['שכר בסיס ושבתות', 'שכר — שלב 2/5 שכר בסיס ושבתות'],
        ['תוספות נוספות', 'שכר — שלב 3/5 תוספות נוספות'],
        ['מקדמות וקיזוזים', 'שכר — שלב 4/5 מקדמות וקיזוזים'],
        ['סיכום ואישור', 'שכר — שלב 5/5 סיכום ואישור'],
      ];
      for (const [heading, screen] of wizardSteps) {
        await page
          .locator('.wizard-actions')
          .getByRole('button', { name: 'המשך', exact: true })
          .click();
        await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
        // From step 2 the wizard renders the provenance legend and the badges.
        // If they were absent the audit would be measuring the pre-#114 layout
        // and proving nothing about the change that made this urgent.
        await expect(page.locator('[data-value-origin]').first()).toBeVisible();
        await auditScreen(page, width, screen);
      }

      // The printable summary is the artefact the employer hands to the
      // caregiver, and it is a fixed-layout table — the single most likely
      // thing on this route to spill at 360px.
      await page.getByRole('button', { name: 'תצוגה מקדימה להדפסה' }).click();
      await expect(page.locator('.payroll-print-preview')).toBeVisible();
      await auditScreen(page, width, 'שכר — תצוגה מקדימה להדפסה');
      await page.getByRole('button', { name: 'הסתרת תצוגה מקדימה' }).click();

      await page.getByRole('button', { name: 'אישור ושמירה' }).click();
      await expect(page.getByText('השכר נשמר בהצלחה')).toBeVisible();
      // The annual report is rendered only once a record exists, which is why
      // this audit comes after the save and not instead of it.
      await expect(
        page.getByRole('heading', { level: 2, name: 'שכר מצטבר והיסטוריה שנתית' }),
      ).toBeVisible();
      await auditScreen(page, width, 'שכר — חודש שמור, דוח שנתי ותשלומים תקופתיים');
    });
  }

  /**
   * R4-03 / R4-05 / R4-06 / R4-07 / R4-08 — the remaining authenticated screens.
   *
   * All of these are localStorage-driven except `/family`, which reuses the
   * existing `installFamilyAccessApi` fixture rather than growing a new one.
   * The document upload FORM is audited and not only the document list: the
   * form is behind a button, so a route-level audit would never have reached
   * the screen R4-03 is actually about.
   */
  for (const width of MATRIX_WIDTHS) {
    test(`רוחב ${width}px — מסמכים, תרופות, הגדרות, נושאים פתוחים ובני משפחה`, async ({ page }) => {
      test.slow();
      await installCanonicalProductIntelligence(page);
      await installFamilyAccessApi(page);
      await page.setViewportSize({ width, height: viewportHeightFor(width) });

      const clientHome = await enterSeededClient(page, completedProfile, { clearStorage: true });

      await page.goto(`${clientHome}/documents`);
      await expect(
        page.getByRole('heading', { level: 1, name: 'כל המסמכים במקום אחד' }),
      ).toBeVisible();
      await auditScreen(page, width, 'מסמכים — רשימה');

      await page.getByRole('button', { name: '↑ הוספת מסמך' }).click();
      await expect(page.getByRole('heading', { level: 2, name: 'הוספת מסמך' })).toBeVisible();
      await auditScreen(page, width, 'מסמכים — טופס הוספה והעלאה');

      await page.goto(`${clientHome}/medications`);
      await expect(page.getByRole('heading', { level: 1, name: 'תרופות קבועות' })).toBeVisible();
      await auditScreen(page, width, 'תרופות קבועות');

      await page.goto(`${clientHome}/settings`);
      await expect(page.getByRole('heading', { level: 1, name: 'פרטים והעדפות' })).toBeVisible();
      await auditScreen(page, width, 'הגדרות התיק');

      // R4-05. The visa renewal date is entered in onboarding and surfaced
      // here and on the dashboard; the governed renewal WORKFLOW lives on
      // /cases/:caseId behind the canonical case API and is deliberately not
      // pulled into this gate — see the item's notes in the backlog.
      await page.goto(`${clientHome}/overview`);
      await expect(
        page.getByRole('heading', { level: 1, name: 'נושאים פתוחים במבט אחד' }),
      ).toBeVisible();
      await auditScreen(page, width, 'נושאים פתוחים — כולל תוקף אשרת העבודה');

      await page.goto('/family');
      await expect(
        page.getByRole('heading', { level: 1, name: 'מי יכול להיכנס לתיק?' }),
      ).toBeVisible();
      await auditScreen(page, width, 'בני משפחה והרשאות');
    });
  }

  /**
   * The gate is only worth its runtime if it can fail. This locks that in: a snapshot
   * carrying one instance of each of the five failure conditions must produce exactly
   * five violations, each quoting its measurement.
   */
  test('חוקי המטריצה מזהים כל אחד מחמשת הכשלים', () => {
    const broken: LayoutSnapshot = {
      url: '/synthetic',
      viewportWidth: 1440,
      innerWidth: 1440,
      documentScrollWidth: 1648,
      sidebar: { x: 1180, y: 0, width: 260, height: 900 },
      overflowOffenders: [
        { selector: 'div.wide-table', overflowPx: 208, side: 'end', width: 1648 },
      ],
      sidebarOverlaps: [
        {
          selector: 'div.environment-banner',
          text: 'סביבת בדיקות',
          overlapWidth: 260,
          overlapHeight: 34,
          samples: 9,
          occludedSamples: 9,
        },
      ],
      buttons: [
        {
          selector: 'button.sign-out-button',
          text: 'יציאה',
          width: 44,
          height: 44,
          scrollWidth: 68,
          clientWidth: 44,
          contentWidth: 12,
          textWidth: 36,
          isTextButton: false,
        },
      ],
      actionRows: [
        {
          container: 'div.clients-hero-actions',
          top: 210,
          equalWidthContract: true,
          buttons: [
            {
              selector: 'button.primary-button',
              text: 'פתיחת תיק חדש',
              width: 188,
              height: 58,
              scrollWidth: 188,
              clientWidth: 188,
              contentWidth: 152,
              textWidth: 120,
              isTextButton: true,
            },
            {
              selector: 'button.secondary-button',
              text: 'בני משפחה',
              width: 340,
              height: 58,
              scrollWidth: 340,
              clientWidth: 340,
              contentWidth: 304,
              textWidth: 96,
              isTextButton: true,
            },
          ],
        },
      ],
      touchTargets: [
        {
          selector: 'summary.client-more-actions',
          text: 'עוד',
          width: 60,
          height: 28,
          mobileStandard: true,
        },
      ],
      clippedTexts: [],
      occludedTexts: [],
      formControls: [],
    };

    const violations = findLayoutViolations(broken);
    expect(violations).toHaveLength(5);
    expect(violations[0]).toContain('גלישה אופקית');
    expect(violations[0]).toContain('208px');
    expect(violations[1]).toContain('חופף לסייד-בר');
    expect(violations[2]).toContain('טקסט גולש מגבולות הכפתור');
    expect(violations[3]).toContain('ברוחבים שונים');
    expect(violations[4]).toContain(`קטנה מ-${MIN_TOUCH_TARGET_PX}px`);

    const clean: LayoutSnapshot = {
      ...broken,
      documentScrollWidth: 1440,
      overflowOffenders: [],
      sidebarOverlaps: [{ ...broken.sidebarOverlaps[0]!, occludedSamples: 0 }],
      buttons: [
        { ...broken.buttons[0]!, width: 76, scrollWidth: 76, clientWidth: 76, contentWidth: 44 },
      ],
      actionRows: [
        {
          ...broken.actionRows[0]!,
          buttons: broken.actionRows[0]!.buttons.map((button) => ({ ...button, width: 188 })),
        },
      ],
      touchTargets: [{ ...broken.touchTargets[0]!, height: 48 }],
    };
    expect(findLayoutViolations(clean)).toEqual([]);
  });

  /**
   * R4-04 — the same proof for the four rules added for the money screens.
   *
   * The first of them matters most: below 761px `global.css` sets
   * `overflow-x: clip` on html/body/#root, so `documentScrollWidth` can never
   * exceed `innerWidth` and the original overflow rule was structurally unable
   * to fail at 360, 390 and 430 — the three widths the item is about.
   */
  test('חוקי המטריצה מזהים גם את כשלי 360px', () => {
    const mobile: LayoutSnapshot = {
      url: '/clients/x/payroll',
      viewportWidth: 360,
      innerWidth: 360,
      // Equal on purpose: this is what `overflow-x: clip` produces.
      documentScrollWidth: 360,
      sidebar: null,
      overflowOffenders: [
        { selector: 'div.pay-summary > div', overflowPx: 42, side: 'end', width: 402 },
      ],
      sidebarOverlaps: [],
      buttons: [],
      actionRows: [],
      touchTargets: [
        {
          selector: 'div.wizard-actions > button.link-button',
          text: 'מחיקת הטיוטה',
          width: 120,
          height: 46,
          mobileStandard: true,
        },
        // Not a control the stylesheet promises 48 for, so 46 is fine for it.
        { selector: 'nav a', text: 'משימות', width: 64, height: 46, mobileStandard: false },
      ],
      clippedTexts: [
        {
          selector: 'span.value-origin-provenance',
          text: 'מקור: הזנת המשתמש',
          clippedPx: 37,
          clientWidth: 118,
          scrollWidth: 155,
        },
      ],
      occludedTexts: [
        {
          selector: 'div.pay-summary > div > strong',
          text: '₪7,000.00',
          samples: 9,
          occludedSamples: 9,
          occluder: 'span.value-origin',
        },
      ],
      formControls: [
        {
          selector: 'div.form-grid > label > input',
          accessibleName: 'שכר בסיס',
          hasLabelElement: true,
          labelText: 'שכר בסיס',
          labelSelector: 'div.form-grid > label',
          labelOverflowPx: 24,
          labelSide: 'end',
        },
        {
          selector: 'div.ni-month-field > input',
          accessibleName: '',
          hasLabelElement: false,
          labelText: '',
          labelSelector: '',
          labelOverflowPx: 0,
          labelSide: 'none',
        },
      ],
    };

    const violations = findLayoutViolations(mobile);
    expect(violations).toHaveLength(6);
    expect(violations[0]).toContain('overflow-x: clip');
    expect(violations[0]).toContain('42px');
    expect(violations[1]).toContain(`קטנה מ-${MOBILE_TOUCH_TARGET_PX}px`);
    expect(violations[1]).toContain('מחיקת הטיוטה');
    expect(violations[2]).toContain('טקסט נחתך');
    expect(violations[2]).toContain('37px');
    expect(violations[3]).toContain('טקסט מוסתר מאחורי רכיב אחר');
    expect(violations[4]).toContain('תווית של פקד טופס יוצאת מגבולות המסך');
    expect(violations[4]).toContain('24px');
    expect(violations[5]).toContain('פקד טופס ללא תווית נגישה');

    // The same 46px control at a desktop width is not a finding: the 48px
    // promise is made by a `max-width: 760px` media query and nowhere else.
    const desktop: LayoutSnapshot = { ...mobile, viewportWidth: 1440, innerWidth: 1440 };
    expect(findLayoutViolations(desktop).some((line) => line.includes('מטרת מגע'))).toBe(false);

    const repaired: LayoutSnapshot = {
      ...mobile,
      overflowOffenders: [],
      touchTargets: mobile.touchTargets.map((target) => ({ ...target, height: 48 })),
      clippedTexts: [],
      occludedTexts: [],
      formControls: [
        { ...mobile.formControls[0]!, labelOverflowPx: 0, labelSide: 'none' },
        { ...mobile.formControls[1]!, accessibleName: 'שכר החודש', hasLabelElement: true },
      ],
    };
    expect(findLayoutViolations(repaired)).toEqual([]);
  });
});
