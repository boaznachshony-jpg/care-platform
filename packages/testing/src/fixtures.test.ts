import { describe, expect, it } from 'vitest';
import {
  buildSyntheticEmploymentCase,
  buildSyntheticTenant,
  buildSyntheticUser,
} from './fixtures.js';

describe('synthetic fixtures', () => {
  it('never produces a resolvable email domain (Constitution §16/§25)', () => {
    const user = buildSyntheticUser();
    expect(user.email).toMatch(/@example\.invalid$/);
  });

  it('is overridable without losing the synthetic defaults', () => {
    const tenant = buildSyntheticTenant({ timezone: 'UTC' });
    expect(tenant.timezone).toBe('UTC');
    expect(tenant.dataRegion).toBe('synthetic');
  });

  it('produces an internally consistent employment case', () => {
    const employmentCase = buildSyntheticEmploymentCase();
    expect(employmentCase.status).toBe('active');
    expect(employmentCase.endDate).toBeNull();
  });
});
