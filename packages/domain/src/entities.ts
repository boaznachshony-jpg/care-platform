import type {
  CareRecipientId,
  CaregiverId,
  EmployerId,
  EmploymentCaseId,
  TenantId,
  TenantMembershipId,
  UserId,
} from './ids.js';
import type { EmploymentCaseStatus } from './status.js';

/**
 * Entity shapes below carry only the Milestone 0 fields needed to prove the
 * layering and RLS mechanism — see docs/architecture/database-blueprint.md
 * §4.1/§4.2 for the full field list each aggregate grows into from
 * Milestone 1 onward.
 */

export interface Tenant {
  id: TenantId;
  status: 'active' | 'suspended' | 'closed';
  timezone: string;
  defaultLocale: string;
  dataRegion: string;
  createdAt: string;
}

export interface FamilyAccount {
  /** One-to-one with Tenant — this IS the tenant's business profile, not a second boundary. */
  tenantId: TenantId;
  displayName: string;
  accountType: string;
  lifecycleStatus: string;
}

export interface User {
  id: UserId;
  authSubject: string;
  displayName: string;
  email: string;
  preferredLocale: string;
  status: 'active' | 'invited' | 'disabled';
}

export interface TenantMembership {
  id: TenantMembershipId;
  tenantId: TenantId;
  userId: UserId;
  /**
   * Canonical role vocabulary is not yet defined — the Constitution's
   * example roles (family member, payroll accountant, social-worker
   * contact) exist, but the enum itself is a Milestone 1 permission-model
   * decision, not one to invent here.
   */
  role: string;
  status: 'active' | 'revoked';
  validFrom: string;
  validTo: string | null;
  mfaRequired: boolean;
}

export interface CareRecipient {
  id: CareRecipientId;
  tenantId: TenantId;
  fullName: string;
  careLevel: string | null;
  city: string | null;
}

export interface Employer {
  id: EmployerId;
  tenantId: TenantId;
  fullName: string;
  relationshipToRecipient: string;
  city: string | null;
}

export interface Caregiver {
  id: CaregiverId;
  tenantId: TenantId;
  legalName: string;
  preferredName: string | null;
  nationality: string;
  primaryLanguage: string | null;
  status: 'active' | 'inactive';
}

export interface EmploymentCase {
  id: EmploymentCaseId;
  tenantId: TenantId;
  careRecipientId: CareRecipientId;
  employerId: EmployerId;
  caregiverId: CaregiverId;
  startDate: string;
  endDate: string | null;
  status: EmploymentCaseStatus;
}
