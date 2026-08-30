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
 * Run: `pnpm --filter @caredesk/web test:e2e --project=layout-matrix`
 */
import { expect, test, type Page } from '@playwright/test';
import { installCanonicalProductIntelligence } from './fixtures/canonical-product-intelligence.js';
import { enterSeededClient } from './fixtures/seeded-client.js';
import {
  MATRIX_WIDTHS,
  MIN_TOUCH_TARGET_PX,
  collectLayoutSnapshot,
  findLayoutViolations,
  formatViolationReport,
  type LayoutSnapshot,
} from './fixtures/layout-matrix.js';

/** The width below which `.sidebar` is display:none (global.css `@media (max-width: 760px)`). */
const SIDEBAR_BREAKPOINT_PX = 760;

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
      expect(
        listSnapshot.actionRows.length,
        `מטריצת רוחבים — לא זוהתה אף שורת פעולה ב-/app ברוחב ${width}px`,
      ).toBeGreaterThan(0);

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
        { selector: 'summary.client-more-actions', text: 'עוד', width: 60, height: 28 },
      ],
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
});
