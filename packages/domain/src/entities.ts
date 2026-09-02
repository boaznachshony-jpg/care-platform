import type {
  CareRecipientId,
  CaregiverId,
  CaseContactRoleId,
  ContactId,
  DocumentId,
  DocumentVersionId,
  EmployerId,
  EmploymentCaseId,
  MedicationId,
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
  MedicationDayOfWeek,
  MedicationStatus,
  MedicationTimeOfDay,
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
  /**
   * Provenance marker, not domain data: the identifier of the legacy browser
   * client (`caredesk.mvp.clients.v1`) this case was opened from, or null for a
   * case opened directly in the canonical product.
   *
   * ADR-006 makes the normalized aggregate canonical and the browser snapshot a
   * transitional compatibility mechanism. The map between the two therefore
   * lives on the canonical row - see
   * database/migrations/0042_employment_case_legacy_client_link.sql - so that
   * clearing a browser cannot orphan a case, and so the snapshot never becomes
   * load-bearing for its own migration. Written once, at creation, and never
   * updated (ADR-006 clause 6: one write authority per field).
   */
  legacyClientId: string | null;
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
  /**
   * Opaque id of the browser-only task (`caredesk.mvp.tasks.v1`) this row was
   * imported from, or null for a task created directly on the server. Same
   * provenance-marker role as EmploymentCase.legacyClientId (ADR-006) — it is
   * what makes replaying an import from a device idempotent.
   */
  legacyLocalId: string | null;
  /**
   * Deterministic idempotency key for a task the server generated on its own
   * (migration 0047), e.g. `case_health:passport` for the case-open
   * compliance seeding. Null for a manually created or imported task. Same
   * provenance-marker role as legacyLocalId, but for rows no browser store
   * ever held.
   */
  sourceKey: string | null;
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
  /** Same provenance-marker role as Task.legacyLocalId — see there for why. */
  legacyLocalId: string | null;
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

/**
 * A standing medication the care recipient takes — a transcription of what the
 * family already knows, not a prescription and not medical advice (mirrors the
 * stance the browser-only version took; see MvpMedication in
 * apps/web/src/storage/mvp-storage.ts). Modelled as plain, typed columns with
 * `sensitivity` fixed to `care_sensitive` — the same treatment already given to
 * `care_recipient` (migration 0003) — rather than as the encrypted-credential
 * records that database/migrations/sensitive-record-migration-requirements.md
 * gates. That document targets identity credentials and banking details; a
 * medication name/dosage/notes is a descriptive care fact of the same kind as
 * `care_recipient.care_level`, not a secret to be crypto-shredded.
 */
export interface Medication {
  id: MedicationId;
  tenantId: TenantId;
  employmentCaseId: EmploymentCaseId;
  name: string;
  /** Free text ("1 tablet", "5ml") — never parsed, never calculated on. */
  dosage: string;
  /** Empty means "as needed" rather than "unknown". */
  timesOfDay: MedicationTimeOfDay[];
  daily: boolean;
  /** Meaningful only when `daily` is false; absent/[] distinction mirrors the client (see mvp-storage.ts). */
  daysOfWeek: MedicationDayOfWeek[] | null;
  prescribingDoctor: string;
  notes: string;
  status: MedicationStatus;
  sensitivity: SensitivityClass;
  /** Same provenance-marker role as Task.legacyLocalId — see there for why. */
  legacyLocalId: string | null;
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
