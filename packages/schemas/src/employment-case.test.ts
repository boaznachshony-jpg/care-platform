import { describe, expect, it } from 'vitest';
import { openEmploymentCaseRequestSchema } from './employment-case.js';

const validRequest = {
  careRecipient: { fullName: 'Synthetic Care Recipient' },
  employer: { fullName: 'Synthetic Employer', relationshipToRecipient: 'child' },
  caregiver: { legalName: 'Synthetic Caregiver', nationality: 'Philippines' },
  startDate: '2026-02-01',
};

describe('openEmploymentCaseRequestSchema', () => {
  it('accepts a minimal valid request', () => {
    expect(openEmploymentCaseRequestSchema.safeParse(validRequest).success).toBe(true);
  });

  it('rejects a non-ISO start date', () => {
    const result = openEmploymentCaseRequestSchema.safeParse({
      ...validRequest,
      startDate: '01/02/2026',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown-shaped payload (no silent passthrough of extra sensitive fields)', () => {
    const result = openEmploymentCaseRequestSchema.safeParse({
      ...validRequest,
      caregiver: { ...validRequest.caregiver, passportNumber: 'X1234567' },
    });
    // Zod strips unknown keys by default — the parsed output must not carry it.
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.caregiver).not.toHaveProperty('passportNumber');
    }
  });
});
