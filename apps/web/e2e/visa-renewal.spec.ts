/* eslint-disable no-restricted-syntax -- assertions verify the rendered Hebrew/RTL experience */
import { expect, test } from '@playwright/test';

const workflow = {
  id: 'wf-1',
  employmentCaseId: 'case-1',
  templateVersionId: 'template-1',
  currentAuthorizationId: 'authorization-1',
  status: 'active',
  evaluation: {
    status: 'active',
    asOf: '2026-08-13',
    dueDate: null,
    priority: 'normal',
    explanationKey: 'rule',
    sourceReferences: ['government-source'],
    reviewRequired: false,
  },
  assignments: [
    { stepKey: 'prepare', raciRole: 'responsible', assigneeType: 'user', assigneeId: 'user-1' },
    { stepKey: 'prepare', raciRole: 'accountable', assigneeType: 'user', assigneeId: 'user-2' },
  ],
  blockers: [],
  linkedRenewedAuthorizationId: 'renewed-1',
  linkedDocumentVersionId: 'document-1',
  completedAt: null,
};

const apiUrl = (path: string): string => `http://127.0.0.1:4000${path}`;

test.beforeEach(async ({ page }) => {
  await page.route(apiUrl('/cases/case-1'), (route) =>
    route.fulfill({
      json: {
        id: 'case-1',
        status: 'active',
        startDate: '2026-01-01',
        endDate: null,
        careRecipient: {
          id: 'recipient-1',
          fullName: 'בדיקת מקבל שירות',
          careLevel: null,
          city: null,
        },
        employer: {
          id: 'employer-1',
          fullName: 'בדיקת מעסיק',
          relationshipToRecipient: 'משפחה',
          city: null,
        },
        caregiver: {
          id: 'caregiver-1',
          legalName: 'Test Caregiver',
          preferredName: null,
          nationality: 'Testland',
          primaryLanguage: null,
        },
      },
    }),
  );
  await page.route(
    /^http:\/\/127\.0\.0\.1:4000\/cases\/case-1\/(tasks|documents|contacts|timeline)$/,
    (route) => route.fulfill({ json: [] }),
  );
});

test('visa renewal happy path shows governed workflow detail', async ({ page }) => {
  await page.route(apiUrl('/cases/case-1/visa-renewals'), (route) =>
    route.fulfill({ json: [workflow] }),
  );
  await page.goto('/cases/case-1');
  await expect(page.getByRole('heading', { name: 'חידוש אשרת עבודה' })).toBeVisible();
  await expect(page.getByText('פעיל ומגובה במקור')).toBeVisible();
  await expect(page.getByText('renewed-1')).toBeVisible();
});

test('visa renewal blocked path exposes unverified evidence', async ({ page }) => {
  await page.route(apiUrl('/cases/case-1/visa-renewals'), (route) =>
    route.fulfill({
      json: [
        {
          ...workflow,
          status: 'blocked',
          evaluation: {
            ...workflow.evaluation,
            status: 'unverified',
            sourceReferences: [],
            reviewRequired: true,
          },
          blockers: [
            {
              code: 'unverified_evidence',
              stepKey: 'verify',
              ownerAssignmentId: null,
              nextReviewAt: null,
            },
          ],
        },
      ],
    }),
  );
  await page.goto('/cases/case-1');
  await expect(page.getByText('לא מאומת')).toBeVisible();
  await expect(page.getByText(/הראיות טרם אומתו/)).toBeVisible();
});
