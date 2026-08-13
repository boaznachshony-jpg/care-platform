import { describe, expect, it } from 'vitest';
import { startVisaRenewalRequestSchema } from './visa-renewal.js';

describe('visa renewal API contracts', () => {
  it('requires version identifiers, an as-of date and RACI assignments', () => {
    expect(startVisaRenewalRequestSchema.safeParse({}).success).toBe(false);
    expect(
      startVisaRenewalRequestSchema.safeParse({
        templateVersionId: '00000000-0000-4000-8000-000000000001',
        currentAuthorizationId: '00000000-0000-4000-8000-000000000002',
        asOf: '2026-09-01',
        assignments: [
          {
            stepKey: 'prepare',
            raciRole: 'accountable',
            assigneeType: 'user',
            assigneeId: '00000000-0000-4000-8000-000000000003',
          },
          {
            stepKey: 'prepare',
            raciRole: 'responsible',
            assigneeType: 'contact',
            assigneeId: '00000000-0000-4000-8000-000000000004',
          },
        ],
      }).success,
    ).toBe(true);
  });
});
