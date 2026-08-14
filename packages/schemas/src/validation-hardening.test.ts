import { describe, expect, it } from 'vitest';
import { uploadDocumentRequestSchema } from './case-documents.js';
import { createTaskRequestSchema } from './case-tasks.js';
import { openEmploymentCaseRequestSchema } from './employment-case.js';
import { inviteFamilyMemberRequestSchema } from './family-access.js';
import {
  linkRenewedAuthorizationRequestSchema,
  visaRenewalContactActivityRequestSchema,
} from './visa-renewal.js';

const uuid = (last: string) => `00000000-0000-4000-8000-${last.padStart(12, '0')}`;

describe('API boundary validation hardening', () => {
  it.each(['', ' ', 'a', 'x'.repeat(161)])('rejects invalid task title %j', (title) => {
    expect(createTaskRequestSchema.safeParse({ title }).success).toBe(false);
  });

  it.each(['2026-02-29', '2025-04-31', '2026-00-10', '2026-13-01', '2026-01-00'])(
    'rejects impossible calendar date %s everywhere dates enter mutations',
    (date) => {
      expect(
        createTaskRequestSchema.safeParse({ title: 'Synthetic task', dueDate: date }).success,
      ).toBe(false);
      expect(
        uploadDocumentRequestSchema.safeParse({
          documentType: 'visa',
          mediaType: 'application/pdf',
          content: 'c3ludGhldGlj',
          expiresOn: date,
        }).success,
      ).toBe(false);
      expect(
        openEmploymentCaseRequestSchema.safeParse({
          careRecipient: { fullName: 'Synthetic Recipient' },
          employer: { fullName: 'Synthetic Employer', relationshipToRecipient: 'child' },
          caregiver: { legalName: 'Synthetic Caregiver', nationality: 'Synthetic' },
          startDate: date,
        }).success,
      ).toBe(false);
    },
  );

  it.each(['2024-02-29', '2000-02-29', '2099-12-31'])(
    'accepts real leap and boundary calendar date %s',
    (dueDate) => {
      expect(createTaskRequestSchema.safeParse({ title: 'Synthetic task', dueDate }).success).toBe(
        true,
      );
    },
  );

  it('rejects reversed authorization dates', () => {
    expect(
      linkRenewedAuthorizationRequestSchema.safeParse({
        documentVersionId: uuid('1'),
        validFrom: '2027-01-01',
        validTo: '2026-12-31',
      }).success,
    ).toBe(false);
  });

  it('rejects a follow-up earlier than its contact activity', () => {
    expect(
      visaRenewalContactActivityRequestSchema.safeParse({
        organizationId: uuid('1'),
        channel: 'email',
        occurredAt: '2026-08-14T12:00:00.000Z',
        followUpAt: '2026-08-14T11:59:59.000Z',
        purpose: 'Synthetic renewal check',
        outcome: 'Synthetic response',
      }).success,
    ).toBe(false);
  });

  it.each([
    ['missing at', 'owner.example.test'],
    ['missing domain', 'owner@'],
    ['multiple at', 'owner@@example.test'],
    ['whitespace', 'owner @example.test'],
    ['overlong', `${'a'.repeat(245)}@example.test`],
  ])('rejects %s family invitation email', (_case, email) => {
    expect(
      inviteFamilyMemberRequestSchema.safeParse({
        displayName: 'Synthetic User',
        email,
        role: 'viewer',
      }).success,
    ).toBe(false);
  });

  it('trims mixed Hebrew/English plain text and preserves it without interpreting markup', () => {
    const title = '  בדיקה QA <script>alert(1)</script>  ';
    const result = createTaskRequestSchema.safeParse({ title });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.title).toBe('בדיקה QA <script>alert(1)</script>');
  });
});
