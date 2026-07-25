declare const brand: unique symbol;

/** Nominal-typing helper so e.g. a UserId can't be passed where a TenantId is expected. */
export type Branded<Value, Tag extends string> = Value & { readonly [brand]: Tag };

export function brandId<Tag extends string>(value: string): Branded<string, Tag> {
  return value as Branded<string, Tag>;
}

// Milestone 0 scope only — Tenant/FamilyAccount/User/TenantMembership and the
// EmploymentCase aggregate's direct references. The full identifier set from
// docs/architecture/database-blueprint.md §4 is added entity-by-entity as
// each aggregate is actually implemented, starting with Milestone 1.
export type TenantId = Branded<string, 'TenantId'>;
export type UserId = Branded<string, 'UserId'>;
export type TenantMembershipId = Branded<string, 'TenantMembershipId'>;
export type CareRecipientId = Branded<string, 'CareRecipientId'>;
export type EmployerId = Branded<string, 'EmployerId'>;
export type CaregiverId = Branded<string, 'CaregiverId'>;
export type EmploymentCaseId = Branded<string, 'EmploymentCaseId'>;
export type CorrelationId = Branded<string, 'CorrelationId'>;
export type OrganizationId = Branded<string, 'OrganizationId'>;
export type ContactId = Branded<string, 'ContactId'>;
export type CaseContactRoleId = Branded<string, 'CaseContactRoleId'>;
export type TaskId = Branded<string, 'TaskId'>;
export type TimelineEventId = Branded<string, 'TimelineEventId'>;
export type DocumentId = Branded<string, 'DocumentId'>;
export type DocumentVersionId = Branded<string, 'DocumentVersionId'>;
