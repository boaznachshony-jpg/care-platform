import type {
  CareRecipientId,
  CaregiverId,
  CaseContactRoleId,
  ContactId,
  DocumentId,
  DocumentVersionId,
  EmployerId,
  EmploymentCaseId,
  OrganizationId,
  TaskId,
  TenantId,
  TenantMembershipId,
  TimelineEventId,
  UserId,
} from './ids.js';
import type {
  DocumentComplianceStatus,
  DocumentOwnerType,
  DocumentType,
  DocumentUploadSource,
  DocumentVersionStatus,
  EmploymentCaseStatus,
  OrganizationType,
  SensitivityClass,
  TaskPriority,
  TaskStatus,
} from './status.js';

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

export interface Organization {
  id: OrganizationId;
  tenantId: TenantId;
  name: string;
  organizationType: OrganizationType;
  phone: string | null;
  email: string | null;
  status: 'active' | 'inactive';
}

/** A person in the case ecosystem — never a system user by itself (Constitution §18). */
export interface Contact {
  id: ContactId;
  tenantId: TenantId;
  organizationId: OrganizationId | null;
  fullName: string;
  title: string | null;
  preferredChannel: string | null;
  status: 'active' | 'inactive';
}

export interface CaseContactRole {
  id: CaseContactRoleId;
  tenantId: TenantId;
  employmentCaseId: EmploymentCaseId;
  contactId: ContactId;
  roleType: string;
  isPrimary: boolean;
  isBackup: boolean;
  isEmergency: boolean;
  status: 'active' | 'ended';
}

/**
 * Exactly one of `title` (user-entered) or `titleKey` (workflow-generated,
 * from Milestone 2) is set — enforced by a database check constraint.
 */
export interface Task {
  id: TaskId;
  tenantId: TenantId;
  employmentCaseId: EmploymentCaseId;
  title: string | null;
  titleKey: string | null;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  completedAt: string | null;
  sourceType: 'manual' | 'rule' | 'workflow';
}

/**
 * Logical document container (blueprint §4.5). Holds no file — the bytes live
 * in private object storage, reachable only through a short-lived signed link
 * issued after an authorization check.
 */
export interface Document {
  id: DocumentId;
  tenantId: TenantId;
  employmentCaseId: EmploymentCaseId;
  documentType: DocumentType;
  ownerType: DocumentOwnerType;
  ownerId: string | null;
  sensitivity: SensitivityClass;
  complianceStatus: DocumentComplianceStatus;
  currentVersionId: DocumentVersionId | null;
  expiresAt: string | null;
  status: 'active' | 'archived';
}

/**
 * One immutable uploaded file. Replacing a file adds a version, never edits
 * one — the database grants no update or delete on this table.
 *
 * `storageKey` is a private object-storage key, not a URL, and must never be
 * logged or returned to a client (Constitution §16).
 */
export interface DocumentVersion {
  id: DocumentVersionId;
  tenantId: TenantId;
  documentId: DocumentId;
  versionNumber: number;
  storageKey: string;
  mediaType: string;
  sizeBytes: number;
  checksum: string | null;
  uploadSource: DocumentUploadSource;
  verificationStatus: DocumentVersionStatus;
  verifiedBy: string | null;
  verifiedAt: string | null;
  supersedesVersionId: DocumentVersionId | null;
  createdAt: string;
}

/** User-facing case history — translation keys only, never raw sensitive values. */
export interface TimelineEvent {
  id: TimelineEventId;
  tenantId: TenantId;
  employmentCaseId: EmploymentCaseId;
  eventTypeKey: string;
  summaryKey: string;
  occurredAt: string;
  actorDisplay: string | null;
  sensitivity: SensitivityClass;
}
