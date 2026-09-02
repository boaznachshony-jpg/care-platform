/**
 * Canonical status/enum vocabulary. Source of truth is SYNC_MATRIX.md
 * "Canonical status enums" and "Sensitivity classes" tables — do not add,
 * rename, or reorder a value here without updating that table in the same
 * change (SYNC_MATRIX.md validation gate).
 */

export const EMPLOYMENT_CASE_STATUSES = [
  'draft',
  'active',
  'suspended',
  'ended',
  'cancelled',
  'archived',
] as const;
export type EmploymentCaseStatus = (typeof EMPLOYMENT_CASE_STATUSES)[number];

export const DOCUMENT_VERSION_STATUSES = [
  'uploaded',
  'pending_verification',
  'verified',
  'rejected',
  'superseded',
] as const;
export type DocumentVersionStatus = (typeof DOCUMENT_VERSION_STATUSES)[number];

export const DOCUMENT_COMPLIANCE_STATUSES = [
  'missing',
  'valid',
  'expiring',
  'expired',
  'not_applicable',
] as const;
export type DocumentComplianceStatus = (typeof DOCUMENT_COMPLIANCE_STATUSES)[number];

export const TASK_STATUSES = [
  'open',
  'in_progress',
  'blocked',
  'completed',
  'deferred',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const WORKFLOW_INSTANCE_STATUSES = [
  'not_started',
  'active',
  'blocked',
  'completed',
  'cancelled',
] as const;
export type WorkflowInstanceStatus = (typeof WORKFLOW_INSTANCE_STATUSES)[number];

export const PAYROLL_PERIOD_STATUSES = [
  'draft',
  'review_required',
  'approved',
  'paid',
  'locked',
  'voided',
] as const;
export type PayrollPeriodStatus = (typeof PAYROLL_PERIOD_STATUSES)[number];

export const PAYMENT_RECORD_STATUSES = [
  'planned',
  'recorded',
  'confirmed',
  'failed',
  'cancelled',
  'refunded',
] as const;
export type PaymentRecordStatus = (typeof PAYMENT_RECORD_STATUSES)[number];

/** Lifecycle of the CareDesk product subscription (not caregiver payroll). */
export const PRODUCT_SUBSCRIPTION_STATUSES = [
  'sponsored',
  'payment_method_pending',
  'payment_method_ready',
  'active',
  'past_due',
  'cancelled',
] as const;
export type ProductSubscriptionStatus = (typeof PRODUCT_SUBSCRIPTION_STATUSES)[number];
export const PRODUCT_BILLING_TERMS_VERSION = '2026-08-04';

export const RULE_VERSION_STATUSES = [
  'draft',
  'under_review',
  'approved',
  'active',
  'suspended',
  'superseded',
  'retired',
] as const;
export type RuleVersionStatus = (typeof RULE_VERSION_STATUSES)[number];

export const NOTIFICATION_REQUIREMENT_STATUSES = [
  'pending',
  'in_progress',
  'confirmed',
  'waived',
  'not_applicable',
  'failed',
] as const;
export type NotificationRequirementStatus = (typeof NOTIFICATION_REQUIREMENT_STATUSES)[number];

export const SENSITIVITY_CLASSES = [
  'general',
  'employment_sensitive',
  'financial_sensitive',
  'identity_sensitive',
  'care_sensitive',
] as const;
export type SensitivityClass = (typeof SENSITIVITY_CLASSES)[number];

/** Tenant-wide family access roles used by the closed pilot. */
export type FamilyAccessRole = 'owner' | 'manager' | 'viewer';

export const RACI_ROLES = ['responsible', 'accountable', 'consulted', 'informed'] as const;
export type RaciRole = (typeof RACI_ROLES)[number];

/**
 * Organization types from database-blueprint.md §4.4. Not in SYNC_MATRIX.md's
 * status table — it is a classification, not a lifecycle — but it is still a
 * shared enum, so it belongs here rather than being retyped per feature.
 */
export const ORGANIZATION_TYPES = [
  'nursing_office',
  'licensed_bureau',
  'insurer',
  'payroll_office',
  'legal_office',
  'public_authority',
  'independent_professional',
  'other',
] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const CONTACT_CHANNEL_TYPES = ['phone', 'email', 'whatsapp', 'office', 'portal'] as const;
export type ContactChannelType = (typeof CONTACT_CHANNEL_TYPES)[number];

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/**
 * Document types from database-blueprint.md §4.5. Like ORGANIZATION_TYPES this
 * is a classification rather than a lifecycle, so it is not in SYNC_MATRIX.md's
 * status table — but it is a shared enum, so it belongs here.
 *
 * The lifecycle enums for documents already exist above:
 * DOCUMENT_VERSION_STATUSES and DOCUMENT_COMPLIANCE_STATUSES.
 */
export const DOCUMENT_TYPES = [
  'passport',
  'visa',
  'employment_contract',
  'insurance_policy',
  'medical',
  'payroll',
  'other',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Which party a document is *about*. Never an access grant (Constitution §18). */
export const DOCUMENT_OWNER_TYPES = [
  'employment_case',
  'care_recipient',
  'employer',
  'caregiver',
  'organization',
  'contact',
] as const;
export type DocumentOwnerType = (typeof DOCUMENT_OWNER_TYPES)[number];

export const DOCUMENT_UPLOAD_SOURCES = ['web_upload', 'email_ingest', 'api', 'migration'] as const;
export type DocumentUploadSource = (typeof DOCUMENT_UPLOAD_SOURCES)[number];

/**
 * Medication vocabulary (server-side counterpart of the browser-only
 * `caredesk.mvp.medications.v1` store — see apps/web/src/storage/mvp-storage.ts).
 * Named slots, not clock times: households say "morning and evening", not
 * "08:00 and 20:00", and a slot cannot silently drift the way a specific hour
 * can. Kept identical to the client vocabulary on purpose, so the future UI
 * cutover is a data-shape no-op.
 */
export const MEDICATION_TIMES_OF_DAY = ['morning', 'noon', 'evening', 'night'] as const;
export type MedicationTimeOfDay = (typeof MEDICATION_TIMES_OF_DAY)[number];

/**
 * Sunday-first, matching how the week is spoken and printed in Israel — see
 * the identical ordering rationale in apps/web/src/storage/mvp-storage.ts.
 */
export const MEDICATION_DAYS_OF_WEEK = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;
export type MedicationDayOfWeek = (typeof MEDICATION_DAYS_OF_WEEK)[number];

/**
 * Soft lifecycle only — there is no `delete` verb on tenant health data in
 * this codebase (Constitution + migration 0037's DELETE-hole closure). A
 * medication that is no longer taken is archived, never removed, so an
 * emergency binder printed from history remains truthful about what a
 * caregiver was told at the time.
 */
export const MEDICATION_STATUSES = ['active', 'archived'] as const;
export type MedicationStatus = (typeof MEDICATION_STATUSES)[number];
