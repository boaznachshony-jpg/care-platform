# CareDesk Synchronization Matrix

Status: **Architecture vocabulary approved for Sprint 0**
Approved by: Product Owner and Data and Domain Architecture
Approved at: 2026-08-12
Last updated: 2026-08-12

This matrix prevents product, database, UI, rules, workflows, API contracts,
permissions, and tests from drifting apart.

## Change-impact matrix

| Change | Required synchronized artifacts |
|---|---|
| Product scope or module | Product Spec, user stories, navigation, roadmap, tests |
| Canonical entity or relationship | Database Blueprint, schema, API types, fixtures, permissions, audit, tests |
| Shared enum or status | Database Blueprint, domain types, translations, UI badges, rules, workflows, tests |
| Sensitive-data classification | Database Blueprint, permissions, masking, audit, retention, AI minimization, tests |
| Design token | Design System, UI package, visual tests, accessibility evidence |
| Component contract | Component Catalog, implementation, Storybook/examples, tests |
| Rule input/output | Rules spec, rule schema, source metadata, workflow consumers, explanations, tests |
| Workflow step or transition | Workflow spec, RACI, tasks, notifications, timeline, audit, UI, tests |
| Permission | Product Spec, Database Blueprint, authorization policy, RLS, UI affordance, tests |
| AI capability | Product Spec, ADR-003, AI guardrails, redaction policy, review checklist, tests |
| ADR acceptance | Source-of-truth index, affected specifications, bootstrap plan, implementation issue |
| Persistence authority or migration phase | ADR-006, Strangler Migration, data inventory, API/repository boundary, reconciliation evidence, rollback plan, BUILD_STATUS |
| Legacy workspace field | Data inventory, canonical aggregate mapping, sensitivity classification, transformation/version, sunset impact |

## Canonical shared vocabulary

| Concept | Canonical term | Deprecated or ambiguous terms |
|---|---|---|
| Isolation boundary | `Tenant` | `Account` used as both identity and family |
| Family business profile | `FamilyAccount` | Family tenant without explicit technical boundary |
| Human login identity | `User` | Contact used as a user |
| User-to-tenant access | `TenantMembership` | Role stored directly on User |
| Foreign care worker | `Caregiver` | `CareWorker`, employee as aggregate root |
| Central business unit | `EmploymentCase` | Worker-only case |
| Process definition | `WorkflowTemplate` | Generic Workflow |
| Running process | `WorkflowInstance` | Workflow used for both definition and instance |
| Update duty in a process | `NotificationRequirement` | `NotificationItem` |
| Actual attempted delivery | `NotificationDelivery` | Requirement conflated with a sent message |
| Communication history | `CommunicationEntry` | Contact log without typed result |
| Benefit movement | `BenefitLedgerEntry` | Mutable `SocialBenefitLedger` balance |
| Actual payment record | `PaymentRecord` | Generic `Payment` |
| Rule identity | `RuleDefinition` | Rule containing mutable effective values |
| Effective rule content | `RuleVersion` | Overwriting a Rule |
| Canonical employment persistence | Normalized PostgreSQL aggregate rooted at `EmploymentCase` | `tenant_workspace`, `MvpProfile`, MVP client as aggregate root |
| Canonical document persistence | `Document` and immutable `DocumentVersion` | `workspace_file`, file embedded in workspace snapshot |

## Transitional compatibility rule

`MvpProfile`, `MvpClient`, `tenant_workspace`, and `workspace_file` are legacy
compatibility surfaces. New product fields must not be added to `MvpProfile` or
the workspace payload. New domain data must be designed in its normalized
aggregate with ownership, tenancy, sensitivity, lifecycle, and migration rules.

A compatibility-only exception requires an accepted amendment to ADR-006 that
names the exact field, reason, write authority, canonical destination, and
removal condition. An exception cannot make the legacy snapshot the sole
source for a new product capability.

Undefined dual writes are prohibited. Every migration PR must name exactly one
write authority per datum and phase, plus its read authority, reconciliation
method, rollback boundary, and cutover evidence.

## Canonical status enums

| Aggregate | Values |
|---|---|
| EmploymentCase | `draft`, `active`, `suspended`, `ended`, `cancelled`, `archived` |
| DocumentVersion | `uploaded`, `pending_verification`, `verified`, `rejected`, `superseded` |
| Document compliance | `missing`, `valid`, `expiring`, `expired`, `not_applicable` |
| Task | `open`, `in_progress`, `blocked`, `completed`, `deferred`, `cancelled` |
| WorkflowInstance | `not_started`, `active`, `blocked`, `completed`, `cancelled` |
| PayrollPeriod | `draft`, `review_required`, `approved`, `paid`, `locked`, `voided` |
| PaymentRecord | `planned`, `recorded`, `confirmed`, `failed`, `cancelled`, `refunded` |
| ProductSubscription | `sponsored`, `payment_method_pending`, `payment_method_ready`, `active`, `past_due`, `cancelled` |
| RuleVersion | `draft`, `under_review`, `approved`, `active`, `suspended`, `superseded`, `retired` |
| NotificationRequirement | `pending`, `in_progress`, `confirmed`, `waived`, `not_applicable`, `failed` |

## Canonical classification enums

Not lifecycles, but still shared vocabulary — changing one requires the same
synchronisation as a status enum. All are implemented in
`packages/domain/src/status.ts`.

| Concept | Values |
|---|---|
| Organization type | `nursing_office`, `licensed_bureau`, `insurer`, `payroll_office`, `legal_office`, `public_authority`, `independent_professional`, `other` |
| Contact channel type | `phone`, `email`, `whatsapp`, `office`, `portal` |
| Task priority | `low`, `normal`, `high`, `urgent` |
| Task source | `manual`, `rule`, `workflow` |
| Family access role | `owner`, `manager`, `viewer` (`family_member` is a legacy read-only alias) |

## Sensitivity classes

| Code | Meaning | Examples |
|---|---|---|
| `general` | Ordinary case information | task title, organization name |
| `employment_sensitive` | Employment details | contract terms, case notes |
| `financial_sensitive` | Financial information | bank details, payroll, payment proof |
| `identity_sensitive` | Identity credentials | passport, ID number, visa number |
| `care_sensitive` | Care or medical context | care-level or medical note |

## RACI vocabulary

`responsible`, `accountable`, `consulted`, and `informed` are the stored values.
Every actionable task or workflow step must have exactly one `accountable`
assignment and at least one `responsible` assignment before activation.

## Validation gate

A pull request that changes a shared concept must state:

1. which row of this matrix applies;
2. which artifacts were updated;
3. which artifacts are intentionally unchanged and why;
4. the tests or review evidence that prove synchronization.
