/* eslint-disable no-restricted-syntax -- assertions verify the rendered Hebrew/RTL experience */
import { expect, test } from '@playwright/test';
import { installWorkerPortalApi } from './fixtures/wave5-collaboration.js';

// The worker portal is a mobile-first shell; the phone project is the
// canonical evidence surface (the payroll-print-visual single-project pattern).
const MOBILE_ONLY = 'Worker portal evidence runs on the mobile project.';

const workerNav = (page: import('@playwright/test').Page) =>
  page.getByRole('navigation', { name: 'ניווט באזור המטפל' });

test('worker sees only the worker-safe projection of the employment file', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', MOBILE_ONLY);
  await installWorkerPortalApi(page);
  await page.goto('/worker');

  await expect(page.getByRole('heading', { name: 'האזור שלי' })).toBeVisible();
  // exact: true — 'שלום' is a substring of the 'התשלום האחרון' heading below.
  await expect(page.getByRole('heading', { name: 'שלום', exact: true })).toBeVisible();

  // Latest payment: month is visible, but no amount is invented while the
  // canonical payroll aggregate withholds it.
  await expect(page.getByRole('heading', { name: 'התשלום האחרון' })).toBeVisible();
  await expect(page.getByText('2026-07 — הסכום טרם זמין במקור השכר')).toBeVisible();

  // Leave: no governed balance means no fabricated entitlement.
  await expect(page.getByText('אין עדיין יתרה מאושרת להצגה')).toBeVisible();
  await workerNav(page).getByRole('button', { name: 'חופשה' }).click();
  await expect(page.getByText('נוצלו: 2 · מתוכננים: 3')).toBeVisible();

  // Employer-side vocabulary must not leak into the worker projection.
  await expect(page.getByText('שכר בסיס')).toHaveCount(0);
  await expect(page.getByText('ניכוי')).toHaveCount(0);
});

test('worker submits a request and sees its acknowledged submission', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', MOBILE_ONLY);
  const portal = await installWorkerPortalApi(page);
  await page.goto('/worker');

  await workerNav(page).getByRole('button', { name: 'בקשות' }).click();
  await page.getByLabel('מה ברצונך לבקש?').fill('בקשה סינתטית מהמטפלת לבדיקה');
  await page.getByRole('button', { name: 'שליחת בקשה' }).click();

  // The submission is acknowledged: it reappears from the server projection
  // with its lifecycle status, and the input clears for the next request.
  const requestCard = page
    .locator('.worker-card')
    .filter({ hasText: 'בקשה סינתטית מהמטפלת לבדיקה' });
  await expect(requestCard).toBeVisible();
  await expect(requestCard).toContainText('submitted');
  await expect(page.getByLabel('מה ברצונך לבקש?')).toHaveValue('');

  expect(portal.requests()).toEqual([
    expect.objectContaining({ request_type: 'general', status: 'submitted' }),
  ]);
  const keys = portal.idempotencyKeys();
  expect(keys).toHaveLength(1);
  expect(keys[0]!.length).toBeGreaterThanOrEqual(8);

  // The request survives a reload because the boundary owns it.
  await page.reload();
  await workerNav(page).getByRole('button', { name: 'בקשות' }).click();
  await expect(
    page.locator('.worker-card').filter({ hasText: 'בקשה סינתטית מהמטפלת לבדיקה' }),
  ).toBeVisible();
});

test('worker acknowledges a payment under the explicit non-waiver disclaimer', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', MOBILE_ONLY);
  const portal = await installWorkerPortalApi(page);
  await page.goto('/worker');

  await workerNav(page).getByRole('button', { name: 'תשלומים' }).click();
  await expect(page.getByRole('heading', { name: 'התשלומים שלי' })).toBeVisible();
  const paymentCard = page.locator('.worker-card').filter({ hasText: '2026-07' });
  await expect(paymentCard).toContainText(
    'האישור מעיד רק שראית או קיבלת את רישום התשלום. הוא אינו אישור לנכונות החישוב, ויתור על זכויות או סילוק סופי.',
  );

  await paymentCard.getByRole('button', { name: 'ראיתי / קיבלתי את רישום התשלום' }).click();
  await expect(paymentCard).toContainText('אושר על ידך בתאריך');
  await expect(
    paymentCard.getByRole('button', { name: 'ראיתי / קיבלתי את רישום התשלום' }),
  ).toHaveCount(0);
  expect(portal.payments()[0]).toMatchObject({ acknowledgement: 'acknowledged' });

  // Acknowledged state is durable across a reload.
  await page.reload();
  await workerNav(page).getByRole('button', { name: 'תשלומים' }).click();
  await expect(page.locator('.worker-card').filter({ hasText: '2026-07' })).toContainText(
    'אושר על ידך בתאריך',
  );
});

test('worker sees only explicitly shared documents and downloads through a signed hand-off', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', MOBILE_ONLY);
  const portal = await installWorkerPortalApi(page);
  await page.goto('/worker');

  await workerNav(page).getByRole('button', { name: 'מסמכים' }).click();

  // Allow: the shared document is listed with its secure download action.
  const sharedCard = page.locator('.worker-card').filter({ hasText: 'work_permit' });
  await expect(sharedCard).toBeVisible();
  await sharedCard.getByRole('button', { name: 'הורדה מאובטחת' }).click();
  await expect(page).toHaveURL(/#signed-document-shared-1$/);

  // Deny: the withheld document never enters the worker payload or the DOM,
  // and asking for it directly is refused by the boundary.
  await expect(
    page.locator('.worker-card').filter({ hasText: portal.withheldDocumentId }),
  ).toHaveCount(0);
  await expect(page.getByText('salary_slip_full')).toHaveCount(0);
  const denied = await page.evaluate(async (documentId) => {
    const response = await fetch(`http://127.0.0.1:4000/worker/documents/${documentId}/download`, {
      headers: { authorization: 'Bearer dev-local-token' },
    });
    return response.status;
  }, portal.withheldDocumentId);
  expect(denied).toBe(404);
});

test('revoked or foreign access is refused with the explicit no-access message', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', MOBILE_ONLY);
  const portal = await installWorkerPortalApi(page);
  portal.state.forbidden = true;
  await page.goto('/worker');

  await expect(page.getByRole('heading', { name: 'האזור שלי' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(
    'אין גישה פעילה לאזור המטפל. ייתכן שההזמנה פגה או שהגישה בוטלה.',
  );
  // Nothing from the projection leaks into the refused state.
  await expect(page.getByText('2026-07')).toHaveCount(0);
  await expect(page.getByText('work_permit')).toHaveCount(0);
});
