/* eslint-disable no-restricted-syntax -- assertions verify the rendered Hebrew/RTL experience */
import { expect, test } from '@playwright/test';
import {
  installCaseCollaborationApi,
  installFamilyAccessApi,
} from './fixtures/wave5-collaboration.js';

test.describe('family access management', () => {
  test('owner views members, invites a viewer, changes a role and revokes access', async ({
    page,
  }) => {
    const family = await installFamilyAccessApi(page);
    await page.goto('/family');

    await expect(page.getByRole('heading', { name: 'מי יכול להיכנס לתיק?' })).toBeVisible();
    const ownerRow = page.locator('.family-member-row').filter({ hasText: 'בעל החשבון לבדיקה' });
    await expect(ownerRow.getByText('זה אני')).toBeVisible();
    // The owner row is immutable: no role select and no revocation button.
    await expect(ownerRow.getByRole('button', { name: 'הסרת גישה' })).toHaveCount(0);

    // Invitation: create through the visible form and see the invited member.
    await page.getByLabel('שם מלא').fill('דודה מוזמנת לבדיקה');
    await page.getByLabel('כתובת דוא״ל').fill('aunt@example.test');
    await page.getByRole('radio', { name: 'צופה בלבד' }).check();
    await page.getByRole('button', { name: 'שליחת הזמנה' }).click();

    await expect(page.getByRole('status')).toContainText(
      'ההזמנה נשלחה. המשתמש ייכנס באמצעות הקישור שקיבל.',
    );
    const invitedRow = page.locator('.family-member-row').filter({ hasText: 'דודה מוזמנת לבדיקה' });
    await expect(invitedRow).toContainText('הוזמן — טרם נכנס');
    await expect(invitedRow).toContainText('טרם בוצעה כניסה');
    await expect(invitedRow.locator('select')).toHaveValue('viewer');
    expect(family.members().at(-1)).toMatchObject({ role: 'viewer', status: 'invited' });

    // Role change persists through the authenticated boundary.
    const siblingRow = page.locator('.family-member-row').filter({ hasText: 'אח מנהל לבדיקה' });
    await siblingRow.locator('select').selectOption('viewer');
    await siblingRow.getByRole('button', { name: 'שמירת הרשאה' }).click();
    await expect(siblingRow.locator('select')).toHaveValue('viewer');
    expect(
      family.members().find((member) => member.membershipId === 'membership-sibling')?.role,
    ).toBe('viewer');

    // Revocation asks for explicit confirmation before removing the membership.
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toContain('להסיר את הגישה של');
      void dialog.accept();
    });
    await siblingRow.getByRole('button', { name: 'הסרת גישה' }).click();
    await expect(
      page.locator('.family-member-row').filter({ hasText: 'אח מנהל לבדיקה' }),
    ).toHaveCount(0);
    expect(family.members().some((member) => member.membershipId === 'membership-sibling')).toBe(
      false,
    );

    // Revocation survives a reload: the boundary, not the browser, owns state.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'מי יכול להיכנס לתיק?' })).toBeVisible();
    await expect(
      page.locator('.family-member-row').filter({ hasText: 'אח מנהל לבדיקה' }),
    ).toHaveCount(0);
    await expect(
      page.locator('.family-member-row').filter({ hasText: 'דודה מוזמנת לבדיקה' }),
    ).toHaveCount(1);
  });

  test('duplicate and non-owner invitations surface their exact denial reasons', async ({
    page,
  }) => {
    const family = await installFamilyAccessApi(page);
    family.state.invitationMode = 'duplicate';
    await page.goto('/family');

    await page.getByLabel('שם מלא').fill('כפילות לבדיקה');
    await page.getByLabel('כתובת דוא״ל').fill('sibling@example.test');
    await page.getByRole('button', { name: 'שליחת הזמנה' }).click();
    await expect(page.getByRole('alert')).toContainText('כתובת הדוא״ל הזו כבר מחוברת לתיק.');

    // A non-owner session is refused server-side even when the form renders.
    family.state.invitationMode = 'forbidden';
    await page.getByLabel('שם מלא').fill('מוזמן אסור לבדיקה');
    await page.getByLabel('כתובת דוא״ל').fill('blocked@example.test');
    await page.getByRole('button', { name: 'שליחת הזמנה' }).click();
    await expect(page.getByRole('alert')).toContainText('רק בעל החשבון יכול לשלוח הזמנה.');
    expect(family.members()).toHaveLength(2);
  });

  test('a viewer membership sees the read-only notice without management controls', async ({
    page,
  }) => {
    const family = await installFamilyAccessApi(page);
    family.state.canManage = false;
    await page.goto('/family');

    await expect(page.getByRole('note')).toContainText(
      'רק בעל החשבון יכול להזמין משתמשים, לשנות הרשאה או להסיר גישה.',
    );
    await expect(page.getByRole('button', { name: 'שליחת הזמנה' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'הסרת גישה' })).toHaveCount(0);
  });
});

test.describe('case collaboration panel', () => {
  test('assigns a responsibility and a task, then approves and declines worker requests', async ({
    page,
  }) => {
    const collaboration = await installCaseCollaborationApi(page);
    await page.goto('/cases/case-1');

    await expect(page.getByRole('heading', { name: 'תיק העסקה' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'שיתוף פעולה משפחתי' })).toBeVisible();

    // Responsibility assignment to an active family member. The panel's labels
    // now come from the `collaboration.*` namespace rather than being English
    // literals interpolated with a raw enum, so a responsibility reads as its
    // Hebrew name: `assigneeLabel` is "אחראי/ת על {{subject}}".
    const payrollAssignee = page.getByLabel('אחראי/ת על שכר ותשלומים');
    await payrollAssignee.selectOption('membership-1');
    await expect(payrollAssignee).toHaveValue('membership-1');
    expect(collaboration.responsibilities()).toEqual([
      { responsibility: 'payroll', assignee_membership_id: 'membership-1' },
    ]);

    // Supported task assignment to a different member.
    const taskAssignee = page.getByLabel('אחראי/ת על חידוש ביטוח רפואי');
    await taskAssignee.selectOption('membership-2');
    await expect(taskAssignee).toHaveValue('membership-2');
    expect(collaboration.tasks()[0]).toMatchObject({ assignee_membership_id: 'membership-2' });

    // Worker request handling: the approve and decline paths are both visible.
    const vacationCard = page.locator('.worker-card').filter({ hasText: 'בקשת חופשה סינתטית' });
    // Still the raw enum: this fixture's `vacation` and `general` are not among
    // the request types the `collaboration.requestType.*` map names, and
    // enumLabel falls back to the value it was given rather than printing a
    // missing key. The handler label below interpolates that same fallback.
    await expect(vacationCard).toContainText('vacation');
    const vacationHandler = page.getByLabel('טיפול בפנייה: vacation');
    await expect(vacationHandler.locator('option', { hasText: 'אושרה' })).toHaveCount(1);
    await expect(vacationHandler.locator('option', { hasText: 'נדחתה' })).toHaveCount(1);
    await vacationHandler.selectOption('approved');
    await expect(page.getByLabel('טיפול בפנייה: vacation')).toHaveValue('approved');

    await page.getByLabel('טיפול בפנייה: general').selectOption('rejected');
    await expect(page.getByLabel('טיפול בפנייה: general')).toHaveValue('rejected');

    expect(collaboration.requests()).toEqual([
      expect.objectContaining({ id: 'request-vacation-1', status: 'approved' }),
      expect.objectContaining({ id: 'request-general-1', status: 'rejected' }),
    ]);

    // Every mutation carried its own idempotency key.
    const keys = collaboration.idempotencyKeys();
    expect(keys).toHaveLength(4);
    for (const key of keys) expect(key.length).toBeGreaterThanOrEqual(8);
    expect(new Set(keys).size).toBe(4);

    // The handled state is server-owned and survives a reload.
    await page.reload();
    await expect(page.getByLabel('אחראי/ת על שכר ותשלומים')).toHaveValue('membership-1');
    await expect(page.getByLabel('טיפול בפנייה: vacation')).toHaveValue('approved');
  });

  test('a collaboration authorization denial shows the failure state, never foreign data', async ({
    page,
  }) => {
    const collaboration = await installCaseCollaborationApi(page);
    collaboration.state.forbidden = true;
    await page.goto('/cases/case-1');

    await expect(page.getByRole('heading', { name: 'שיתוף פעולה משפחתי' })).toBeVisible();
    await expect(
      page.getByRole('alert').filter({ hasText: 'לא הצלחנו לטעון את חלוקת האחריות' }),
    ).toBeVisible();
    await expect(page.getByText('אח מנהל לבדיקה')).toHaveCount(0);
    await expect(page.getByText('בקשת חופשה סינתטית לבדיקה')).toHaveCount(0);
  });
});
