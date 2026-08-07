/* eslint-disable no-restricted-syntax */
import { expect, test } from '@playwright/test';

test('renders every payroll component bilingually on a centered A4 page', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'A single Chromium PDF is sufficient.');

  await page.goto('/app');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      'caredesk.mvp.profile.v1',
      JSON.stringify({
        employerName: 'מעסיק בדיקת הדפסה',
        employerIdNumber: '123456782',
        recipientName: 'מטופל בדיקת הדפסה',
        caregiverName: 'Dilnoza Test',
        employmentStartDate: '2026-01-15',
        onboardingCompleted: true,
        baseSalary: 7200,
        salaryEffectiveDate: '2026-01-15',
        saturdayRate: 450,
      }),
    );
  });
  await page.goto('/payroll');

  await page.getByLabel('חודש שכר').fill('2026-07');
  await page.getByRole('button', { name: 'המשך' }).click();
  for (const [label, value] of [
    ['שכר בסיס', '7200'],
    ['ימי עבודה', '20'],
    ['ימי חופשה שנוצלו', '1.5'],
    ['ימי מחלה', '2'],
    ['ימי היעדרות אחרים', '0.5'],
    ['מספר שבתות או ימי מנוחה שעבדו', '3'],
    ['תעריף לכל שבת או יום מנוחה', '450'],
    ['ימי חג שעבדו', '1'],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  await page.getByRole('button', { name: 'המשך' }).click();

  for (const [label, value] of [
    ['תשלום ימי חג', '450'],
    ['תשלום חופשה', '350'],
    ['תשלום מחלה', '300'],
    ['הפרשות מעסיק: פנסיה ופיצויים', '900'],
    ['תוספת אחרת, אם קיימת', '125'],
  ]) {
    await page.getByLabel(label).fill(value);
  }
  await page.getByRole('button', { name: '＋ הוספת תשלום' }).click();
  await page.getByLabel('תיאור תשלום נוסף 1').fill('בונוס שירות');
  await page.getByLabel('סכום תשלום נוסף 1').fill('175');
  await page.getByRole('button', { name: 'המשך' }).click();

  for (const [label, value] of [
    ['דמי כיס שכבר שולמו', '100'],
    ['ניכוי ביטוח רפואי', '75'],
    ['ניכוי מגורים', '150'],
    ['מקדמות שכבר שולמו', '200'],
    ['ניכוי מוסכם', '50'],
  ]) {
    await page.getByLabel(label).fill(value);
  }
  await page.getByRole('button', { name: 'המשך' }).click();
  await page.getByRole('button', { name: 'תצוגה מקדימה להדפסה' }).click();

  const slip = page.getByLabel('ריכוז שכר חודשי להדפסה');
  for (const bilingualLabel of [
    'שכר בסיס',
    'Base salary',
    'שבתות וימי מנוחה',
    'Saturdays and rest days',
    'תשלום ימי חג',
    'Holiday pay',
    'תשלום חופשה',
    'Vacation pay',
    'תשלום מחלה',
    'Sick pay',
    'הפרשות מעסיק',
    'Employer contributions',
    'תוספת אחרת',
    'Other addition',
    'תשלום נוסף',
    'Additional payment',
    'מקדמות וקיזוזים',
    'Advances and deductions',
    'סה״כ לתשלום',
    'Net amount payable',
  ]) {
    await expect(slip).toContainText(bilingualLabel);
  }
  await expect(slip).toContainText('בונוס שירות');

  await page.emulateMedia({ media: 'print' });
  const alignment = await slip.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: window.innerWidth - rect.right,
      width: rect.width,
      viewportWidth: window.innerWidth,
    };
  });
  expect(Math.abs(alignment.left - alignment.right)).toBeLessThanOrEqual(1);
  expect(alignment.width).toBeLessThanOrEqual(alignment.viewportWidth);

  await page.pdf({
    path: testInfo.outputPath('payroll-bilingual-a4.pdf'),
    format: 'A4',
    preferCSSPageSize: true,
    printBackground: true,
  });
});
