import { brandId, type EmploymentCase, type Tenant, type User } from '@caredesk/domain';

/**
 * Synthetic fixtures only (Constitution §16, §25: no real personal data in
 * fixtures, ever). Names are deliberately fictitious and labeled as such.
 */
export function buildSyntheticTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: brandId('tenant-synthetic-1'),
    status: 'active',
    timezone: 'Asia/Jerusalem',
    defaultLocale: 'he',
    dataRegion: 'synthetic',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function buildSyntheticUser(overrides: Partial<User> = {}): User {
  return {
    id: brandId('user-synthetic-1'),
    authSubject: 'synthetic-auth-subject-1',
    displayName: 'Synthetic Family Member',
    email: 'synthetic.family@example.invalid',
    preferredLocale: 'he',
    status: 'active',
    ...overrides,
  };
}

export function buildSyntheticEmploymentCase(
  overrides: Partial<EmploymentCase> = {},
): EmploymentCase {
  return {
    id: brandId('case-synthetic-1'),
    tenantId: brandId('tenant-synthetic-1'),
    careRecipientId: brandId('care-recipient-synthetic-1'),
    employerId: brandId('employer-synthetic-1'),
    caregiverId: brandId('caregiver-synthetic-1'),
    startDate: '2026-01-15',
    endDate: null,
    status: 'active',
    // A synthetic case is opened directly in the canonical product, so it has
    // no legacy client behind it. Spelled out rather than left to `overrides`:
    // the field is required and nullable, and omitting it here would let the
    // optional override be its only source.
    legacyClientId: null,
    ...overrides,
  };
}
