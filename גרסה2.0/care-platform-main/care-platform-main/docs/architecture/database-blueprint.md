# CareDesk Database Blueprint

Status: **Draft v1.0 — pending Product Owner approval**
Owner: Data and Domain Architecture
Approved by: _(unassigned)_
Approved at: _(pending)_
Last reconciled: 2026-07-23

## 1. Purpose

This document resolves the conflicting Stage 1 and Product Specification data
models and defines the canonical vocabulary for schema, domain types, APIs,
rules, workflows, permissions, audit, fixtures, and tests.

It is a logical blueprint, not executable SQL. Physical schema work begins only
after ADR-002 is accepted.

## 2. Explicit reconciliation decision

### 2.1 Account and FamilyAccount

Historical Stage 1 used `Account`; the Product Specification used
`FamilyAccount`. They represented both billing/business context and a data
isolation boundary.

Canonical resolution:

- `Tenant` is the technical security and isolation boundary.
- `FamilyAccount` is the household/business profile, one-to-one with `Tenant`.
- `User` is a global authenticated person.
- `TenantMembership` grants a User a role in a Tenant.

Neither `Account` nor `FamilyAccount` may be used as a hidden substitute for
authorization context.

### 2.2 CareWorker and Caregiver

`Caregiver` is canonical. `CareWorker` is a deprecated historical alias.

### 2.3 EmploymentCase remains central

`EmploymentCase` is the aggregate that joins one CareRecipient, one Employer,
and one Caregiver for a bounded employment period. The MVP UI supports one
active case per family, while the database supports historical and future
cases.

### 2.4 Documents versus regulatory records

The Stage 1 `PermitVisa` and `InsurancePolicy` entities carry business facts,
while Product v1.0 models documents and versions. Both are needed:

- `Document` is a logical document container.
- `DocumentVersion` is an immutable uploaded file and verification record.
- `ImmigrationAuthorization` stores permit/visa type, number, issuer, and
  effective dates, and links to supporting DocumentVersions.
- `MedicalInsurancePolicy` stores insurer, policy period, premium metadata,
  and links to supporting DocumentVersions.

Business rules query typed records, not OCR text or file names.

### 2.5 Workflow and notification ambiguity

- `WorkflowTemplate` defines a versioned process.
- `WorkflowInstance` is one running process for one case.
- `NotificationRequirement` says who must or may be informed and why.
- `NotificationDelivery` records a simulated or real attempt.

### 2.6 Benefits and payments

- `BenefitLedgerEntry` is append-only. Balances are derived, never silently
  overwritten.
- `PaymentRecord` is the canonical actual-payment record. Historical `Payment`
  maps to it.

### 2.7 Rules

- `RuleDefinition` is the stable identity and domain.
- `RuleVersion` contains the effective condition, action, source set, status,
  and approvals.
- `RuleSource` stores evidence and retrieval metadata.

## 3. Tenancy and ownership

Every tenant-owned row includes:

```text
id UUID
tenant_id UUID NOT NULL
created_at timestamptz NOT NULL
created_by UUID or service-principal identifier
updated_at timestamptz NOT NULL
updated_by UUID or service-principal identifier
version integer NOT NULL
```

Rules:

- `tenant_id` is immutable.
- Cross-tenant foreign keys are prohibited.
- API input never supplies an unrestricted tenant id; tenant context is derived
  from the authenticated request and authorized membership.
- Soft deletion is permitted only where retention policy allows it. Audit,
  payroll snapshots, rule versions, and ledger entries are not silently
  deleted.
- Global reference data and system rules must be clearly separated from
  tenant-owned records.

## 4. Canonical aggregates and entities

### 4.1 Identity and tenancy

#### Tenant

Security boundary and subscription container.

Key fields: `id`, `status`, `timezone`, `default_locale`, `data_region`,
`created_at`.

#### FamilyAccount

Household profile.

Key fields: `tenant_id` (PK/FK), `display_name`, `account_type`,
`primary_contact_membership_id`, `lifecycle_status`.

#### User

Global human identity, linked to the authentication provider.

Key fields: `id`, `auth_subject`, `display_name`, `email`, `phone`,
`preferred_locale`, `status`, `last_authenticated_at`.

Sensitive authentication credentials are never stored here.

#### TenantMembership

Key fields: `id`, `tenant_id`, `user_id`, `role`, `status`, `valid_from`,
`valid_to`, `mfa_required`, `invited_by`.

Unique active membership: `(tenant_id, user_id)`.

#### PermissionGrant

Explicit narrowing or time-bounded access.

Key fields: `id`, `tenant_id`, `membership_id`, `case_id`, `resource_type`,
`resource_id`, `permission`, `sensitivity_ceiling`, `valid_from`, `valid_to`,
`granted_by`, `reason`, `revoked_at`.

### 4.2 Care and employment

#### CareRecipient

Key fields: `id`, `tenant_id`, names, contact/address fields, care eligibility
metadata, and sensitivity labels. Store only care data needed for employment
management.

#### Employer

Legal direct employer.

Key fields: `id`, `tenant_id`, names, relationship to CareRecipient, address,
official identifiers (encrypted/masked), National Insurance operational
reference where justified.

#### Caregiver

Key fields: `id`, `tenant_id`, legal name, preferred name, nationality,
language, contact details, arrival metadata, bank-information reference,
status.

Full passport and bank values use protected fields or separate encrypted
records; lists and dashboards use masked projections.

#### EmploymentCase

Key fields: `id`, `tenant_id`, `care_recipient_id`, `employer_id`,
`caregiver_id`, `start_date`, `end_date`, `status`, `closure_reason`,
`primary_manager_membership_id`.

Invariants:

- referenced parties belong to the same tenant;
- `end_date >= start_date`;
- only one active case for the same recipient/caregiver combination unless an
  approved exception is recorded;
- `archived` requires completed closure review or an authorized override.

#### EmploymentContract

Versioned contractual record.

Key fields: `id`, `tenant_id`, `employment_case_id`, `contract_version`,
`signed_at`, `effective_from`, `effective_to`, `base_salary`,
`weekly_rest_day`, `living_arrangement`, `status`,
`supporting_document_version_id`.

At most one active contract per case and date.

### 4.3 Regulatory and insurance records

#### ImmigrationAuthorization

Canonical record for permit, visa, or stay authorization.

Key fields: `id`, `tenant_id`, `employment_case_id`, `authorization_type`,
`document_number_encrypted`, `issuer`, `valid_from`, `valid_to`, `status`,
`verification_status`, `current_document_version_id`.

#### MedicalInsurancePolicy

Key fields: `id`, `tenant_id`, `employment_case_id`, `organization_id`,
`policy_number_encrypted`, `valid_from`, `valid_to`, `premium_amount`,
`currency`, `status`, `current_document_version_id`.

### 4.4 Contacts and organizations

#### Organization

Key fields: `id`, `tenant_id`, `name`, `organization_type`, service channels,
hours, emergency channel, status.

Types include nursing office, licensed bureau/corporation, insurer, payroll
office, legal office, public authority, and independent professional.

#### Contact

A person in the case ecosystem. A Contact is not a User by default.

Key fields: `id`, `tenant_id`, `organization_id`, name, title, languages,
preferred channel, availability, `status`.

#### ContactChannel

Typed and optionally sensitive phone, email, WhatsApp, office, or portal
address with verification and validity metadata.

#### CaseContactRole

Key fields: `id`, `tenant_id`, `employment_case_id`, `contact_id`, `role_type`,
responsibility domains, `is_primary`, `is_backup`, `is_emergency`,
`valid_from`, `valid_to`, `status`.

One contact may hold several roles; each role is separately time-bounded.

### 4.5 Documents

#### Document

Logical container.

Key fields: `id`, `tenant_id`, `employment_case_id`, `document_type`,
`owner_type`, `owner_id`, `sensitivity`, `compliance_status`,
`current_version_id`, `expires_at`, `status`.

#### DocumentVersion

Immutable file version.

Key fields: `id`, `tenant_id`, `document_id`, `version_number`, private storage
key, media type, size, checksum, upload source, `verification_status`,
`verified_by`, `verified_at`, `supersedes_version_id`, `created_at`.

Files are private. Signed links are short-lived and created only after a
permission check. Replacing a file creates a new version.

### 4.6 Tasks, workflows, and responsibility

#### Task

Key fields: `id`, `tenant_id`, `employment_case_id`, `workflow_instance_id`,
`workflow_step_id`, title key, description key, `status`, `priority`,
`due_at`, `deferred_until`, `defer_reason`, `source_type`, `source_id`,
`completed_at`.

#### TaskDependency

Directed dependency with cycle prevention.

#### WorkflowTemplate

Stable template identity: domain, name, lifecycle.

#### WorkflowTemplateVersion

Immutable definition with version, effective dates, trigger configuration,
step graph, required inputs, completion rules, source references, status.

#### WorkflowInstance

Key fields: `id`, `tenant_id`, `employment_case_id`, `template_version_id`,
`status`, `started_at`, `completed_at`, `cancelled_reason`, `context_snapshot`.

#### WorkflowStep

Runtime step state, timestamps, inputs, outputs, exception reason, and linked
task.

#### ResponsibilityAssignment

Key fields: target type/id, `raci_role`, assignee type/id, validity, source,
reason. Activated steps require one accountable and one or more responsible
assignments.

#### NotificationRequirement

Process obligation or recommendation.

Key fields: `id`, `tenant_id`, `workflow_instance_id`, `step_id`, recipient
type/id, `requirement_level` (`required`, `recommended`, `conditional`),
reason, channel preference, owner, due date, status, confirmation requirement,
source rule version.

#### NotificationDelivery

One attempted communication, with channel, attempted time, result, simulated
flag, confirmation, error category, and linked CommunicationEntry.

### 4.7 Communication

#### CommunicationEntry

Key fields: `id`, `tenant_id`, `employment_case_id`, initiator, recipient,
channel, occurred_at, purpose, summary, outcome, follow-up task, sensitivity,
visibility scope, confirmation status, attachment references.

In MVP it records or simulates communication; it does not send external
messages.

### 4.8 Payroll and benefits

#### PayrollPeriod

Key fields: `id`, `tenant_id`, `employment_case_id`, period start/end,
`status`, contract snapshot, input snapshot, rule-set snapshot, totals,
approved by/at, locked at.

#### PayrollItem

Key fields: `id`, `tenant_id`, `payroll_period_id`, component type, quantity,
unit, rate, amount, formula explanation, rule version, source reference,
override flag, override reason, overridden by/at.

#### PaymentRecord

Key fields: `id`, `tenant_id`, `employment_case_id`, `payroll_period_id`,
payee type/id, amount, currency, payment date, method, masked reference,
supporting document, status, confirmed by/at.

CareDesk records payment but does not execute it in MVP.

#### BenefitLedgerEntry

Append-only movement.

Key fields: `id`, `tenant_id`, `employment_case_id`, benefit type, effective
date, quantity, unit, direction, source type/id, rule version, correction-of
entry, explanation.

Balance equals the sum of valid entries. Corrections create new entries.

### 4.9 Rules and evidence

#### RuleDefinition

Stable identity, domain, code, title key, owner role, and lifecycle.

#### RuleVersion

Immutable versioned condition/action representation, jurisdiction, effective
dates, status, confidence, approval metadata, input/output schema, and
explanation template.

#### RuleSource

Authority, title, URL/reference, section, publication date, retrieval date,
effective dates, jurisdiction, source level, checksum or archived reference.

#### RuleApproval

Reviewer role, reviewer identity, decision, date, rationale, and scope.

### 4.10 Timeline and audit

#### TimelineEvent

User-facing case history. It links to a source entity and contains a translated
event type, occurred time, actor display projection, summary, and sensitivity.
It is not the security audit.

#### AuditEvent

Append-only security and change record. Fields include tenant, actor, action,
resource, timestamp, request/correlation id, purpose, before/after metadata
where appropriate, permission decision, sensitivity, and reason.

Secrets, full sensitive values, files, and AI prompt contents are excluded.

## 5. Relationship summary

```text
Tenant 1--1 FamilyAccount
Tenant 1--* TenantMembership *--1 User
Tenant 1--* EmploymentCase
EmploymentCase *--1 CareRecipient
EmploymentCase *--1 Employer
EmploymentCase *--1 Caregiver
EmploymentCase 1--* EmploymentContract
EmploymentCase 1--* ImmigrationAuthorization
EmploymentCase 1--* MedicalInsurancePolicy
EmploymentCase 1--* Document 1--* DocumentVersion
EmploymentCase 1--* Task
EmploymentCase 1--* WorkflowInstance *--1 WorkflowTemplateVersion
WorkflowInstance 1--* WorkflowStep
WorkflowStep 1--* ResponsibilityAssignment
WorkflowStep 1--* NotificationRequirement 1--* NotificationDelivery
EmploymentCase 1--* PayrollPeriod 1--* PayrollItem
EmploymentCase 1--* BenefitLedgerEntry
EmploymentCase 1--* CommunicationEntry
EmploymentCase 1--* TimelineEvent
Tenant 1--* AuditEvent
```

## 6. Status and lifecycle

Use the exact enums in `SYNC_MATRIX.md`. UI labels are translations, not stored
database values. Deprecated Stage 1 statuses map as follows:

| Historical | Canonical |
|---|---|
| case `frozen` | `suspended` |
| case `finished` | `ended`, then `archived` after closure |
| document `uploaded` as compliance state | version `uploaded`; compliance derived separately |
| task `postponed` | `deferred` with reason and date |
| payroll `waiting_for_review` | `review_required` |
| payment `performed` | `recorded` or `confirmed` |
| rule `replaced` | old version `superseded` |

## 7. Derived projections

The following are projections, not sources of truth:

- dashboard status and Next Best Action;
- current document compliance status;
- benefit balances;
- case readiness score;
- masked caregiver and bank summaries;
- monthly cost summary;
- expiring-document queues.

Projection rebuild must be deterministic from canonical data and rule versions.

## 8. Indexing guidance

Required indexing candidates:

- every tenant table: `(tenant_id, id)`;
- active cases: `(tenant_id, status)`;
- due tasks: `(tenant_id, status, due_at)`;
- expiring authorizations and policies: `(tenant_id, valid_to, status)`;
- documents: `(tenant_id, employment_case_id, document_type)`;
- timeline: `(tenant_id, employment_case_id, occurred_at desc)`;
- audit: `(tenant_id, occurred_at desc)`, `(resource_type, resource_id)`;
- workflow instances: `(tenant_id, employment_case_id, status)`;
- rule versions: `(rule_definition_id, effective_from, effective_to, status)`.

Indexes must not include unnecessary plaintext sensitive values.

## 9. Retention and deletion

Retention periods remain an open legal/privacy decision. The model must support:

- per-class retention policy;
- legal hold;
- tenant export;
- deletion/anonymization workflow;
- cryptographic or storage-object deletion where required;
- preserving minimal audit evidence without retaining unnecessary content.

No developer may invent retention periods.

## 10. Migration order

1. identity and tenancy;
2. care/employment core;
3. organizations and contacts;
4. documents and typed regulatory records;
5. tasks and workflow definitions;
6. communications and notification requirements;
7. payroll and benefits;
8. rules and evidence;
9. timeline and audit;
10. RLS, indexes, fixtures, and cross-tenant tests.

## 11. Schema readiness gate

Executable schema work may start only when:

- ADR-002 is accepted for the target environment;
- canonical names are used without aliases;
- sensitivity and ownership are assigned to every field;
- status transitions are defined;
- RLS test cases exist;
- retention-unknown fields are explicitly marked;
- no legal or payroll constant is hard-coded into migrations.
