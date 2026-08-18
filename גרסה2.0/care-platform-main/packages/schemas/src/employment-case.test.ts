import { describe, expect, it } from 'vitest';
import { createTaskRequestSchema } from './case-tasks.js';
import { openEmploymentCaseRequestSchema } from './employment-case.js';

describe('createTaskRequestSchema', () => {
  it('treats an untouched date input ("") as no due date, not as invalid', () => {
    // An <input type="date"> left blank submits "", which previously failed the
    // regex and blocked the form with no visible error.
    const result = createTaskRequestSchema.safeParse({ title: 'Renew visa', dueDate: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dueDate).toBeUndefined();
    }
  });

  it('still rejects a genuinely malformed date', () => {
    const result = createTaskRequestSchema.safeParse({
      title: 'Renew visa',
      dueDate: '15/10/2026',
    });
    expect(result.success).toBe(false);
  });

  it('defaults priority to normal', () => {
    const result = createTaskRequestSchema.safeParse({ title: 'Renew visa' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe('normal');
    }
  });
});

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
