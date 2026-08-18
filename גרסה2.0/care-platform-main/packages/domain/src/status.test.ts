import { describe, expect, it } from 'vitest';
import {
  EMPLOYMENT_CASE_STATUSES,
  RACI_ROLES,
  RULE_VERSION_STATUSES,
  SENSITIVITY_CLASSES,
  type EmploymentCaseStatus,
} from './status.js';

describe('canonical status vocabulary', () => {
  it('matches SYNC_MATRIX.md EmploymentCase statuses', () => {
    expect(EMPLOYMENT_CASE_STATUSES).toEqual([
      'draft',
      'active',
      'suspended',
      'ended',
      'cancelled',
      'archived',
    ]);
  });

  it('matches SYNC_MATRIX.md RuleVersion 7-state lifecycle', () => {
    expect(RULE_VERSION_STATUSES).toHaveLength(7);
    expect(RULE_VERSION_STATUSES).toContain('under_review');
    expect(RULE_VERSION_STATUSES).toContain('retired');
  });

  it('matches SYNC_MATRIX.md sensitivity classes', () => {
    expect(SENSITIVITY_CLASSES).toContain('identity_sensitive');
    expect(SENSITIVITY_CLASSES).toContain('financial_sensitive');
  });

  it('matches SYNC_MATRIX.md RACI vocabulary', () => {
    expect(RACI_ROLES).toEqual(['responsible', 'accountable', 'consulted', 'informed']);
  });

  it('supports an exhaustive switch (Constitution §6)', () => {
    function label(status: EmploymentCaseStatus): string {
      switch (status) {
        case 'draft':
          return 'Draft';
        case 'active':
          return 'Active';
        case 'suspended':
          return 'Suspended';
        case 'ended':
          return 'Ended';
        case 'cancelled':
          return 'Cancelled';
        case 'archived':
          return 'Archived';
        default: {
          const exhaustive: never = status;
          throw new Error(`Unhandled status: ${String(exhaustive)}`);
        }
      }
    }

    expect(label('active')).toBe('Active');
  });
});
