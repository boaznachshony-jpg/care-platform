# CareDesk User Stories & Acceptance Criteria

Status: **MVP baseline v1.0**
Last updated: 2026-07-23

## How to use this document

Stories clarify the Product Specification; they do not expand it. Each
implementation issue must link the relevant story IDs, identify permissions
and sensitivity, and satisfy the global criteria below.

Priority:

- P0 — required for the named milestone;
- P1 — required before pilot;
- Future — explicitly outside MVP.

## Global acceptance criteria

Every delivered story:

- uses Hebrew RTL and translation keys;
- works at 320 px and desktop width;
- includes applicable loading, empty, validation, error, success, denied, and
  retry states;
- meets WCAG 2.1 AA and 44 × 44 px touch targets;
- enforces authorization server-side and, later, through RLS;
- masks sensitive values by default;
- creates Timeline and Audit records only through central services;
- preserves recoverable form input;
- has unit/component/integration tests proportional to risk;
- uses synthetic test data;
- does not hard-code legal, payroll, or regulatory values.

## Epic F0 — Repository foundation

### CD-F0-01 — Reproducible workspace (P0)

As an AI coding agent, I want one documented workspace command so that I can
install and validate the repository consistently.

Acceptance:

- pnpm workspace installs from a lockfile;
- root scripts run format check, lint, typecheck, tests, and build;
- supported runtime versions are pinned;
- clean checkout instructions are verified;
- no product feature code is included.

### CD-F0-02 — Web and API shells (P0)

As a contributor, I want minimal web and API applications so architectural
boundaries can be tested before feature work.

Acceptance:

- web renders an RTL accessible shell and health state;
- API exposes health/readiness without personal data;
- shared packages can be imported through declared boundaries;
- no direct UI-to-database or UI-to-provider call exists.

### CD-F0-03 — Quality gates (P0)

As the product owner, I want automated checks on every pull request so AI
changes cannot bypass the constitution.

Acceptance:

- CI runs install, formatting, lint, typecheck, unit tests, build, and a basic
  accessibility check;
- failure blocks merge once branch protection is enabled;
- logs contain no secrets;
- checks are documented locally.

### CD-F0-04 — Mock adapters (P0)

As a developer, I want mock Auth, AI, Storage, Audit, and Timeline ports so
foundation work is independent of proposed vendors.

Acceptance:

- interfaces live outside infrastructure adapters;
- deterministic mocks are available in tests and local demo;
- external AI and real personal data are impossible by default;
- each adapter has a contract test.

## Epic F1 — Employment Case Foundation

### CD-F1-01 — Create family tenant and membership (P0)

As a primary family manager, I want a family account so authorized relatives
can collaborate.

Acceptance:

- creates Tenant, FamilyAccount, User, and TenantMembership as separate records;
- primary manager is active and accountable;
- duplicate active membership is rejected;
- creation produces AuditEvent without sensitive values.

### CD-F1-02 — Create an employment case (P0)

As a family manager, I want to connect recipient, employer, and caregiver in
one case so all work has a consistent context.

Acceptance:

- all parties belong to the same tenant;
- start date is required;
- draft case may be incomplete; activation reports missing prerequisites;
- successful activation creates Timeline and Audit events;
- case uses canonical statuses.

### CD-F1-03 — Capture caregiver identity safely (P0)

As a family manager, I want to record caregiver details and a passport
document so I can manage permits without exposing identity data.

Acceptance:

- collection explains purpose and visibility;
- passport number is encrypted/protected and masked in normal views;
- file upload creates Document and immutable DocumentVersion;
- prototype blocks or warns against real data;
- reveal requires permission and an audited action.

### CD-F1-04 — Record bank details safely (P0)

As a family manager, I want to record payment destination details so salary
records are accurate.

Acceptance:

- full values are never shown in lists, logs, URLs, analytics, or AI requests;
- purpose and visibility are explained;
- default view is masked;
- edit and reveal are separately authorized and audited;
- no payment is executed.

### CD-F1-05 — Add organizations and contacts (P0)

As a family manager, I want to record the nursing office, licensed bureau,
insurance agent, social worker, accountant, private social worker, nurse, and
other advisers so I know whom to contact.

Acceptance:

- Organization and Contact are separate;
- a Contact may have multiple time-bounded CaseContactRoles;
- primary, backup, emergency, valid-from/to, and active status are supported;
- creating a Contact does not create a User or grant access;
- no active contact produces a clear empty/blocker state.

### CD-F1-06 — Assign RACI (P0)

As a case manager, I want responsibility assigned to tasks so execution and
accountability are explicit.

Acceptance:

- active task/step has exactly one accountable and at least one responsible;
- consulted and informed are optional;
- inactive or expired assignments cannot satisfy activation;
- contact assignment does not grant system permission.

### CD-F1-07 — Upload and version documents (P0)

As a case manager, I want new document versions without losing history.

Acceptance:

- replacing a file creates a new immutable DocumentVersion;
- previous version becomes superseded, not deleted;
- checksum, media type, size, uploader, and verification status are stored;
- private storage and authorized signed access are required;
- Timeline shows user-relevant change and Audit records the mutation.

### CD-F1-08 — Manage tasks (P0)

As a family manager, I want to see urgent, upcoming, open, blocked, and
completed tasks so I know what to do next.

Acceptance:

- filters use canonical statuses;
- defer requires reason and date;
- blocker records owner and next review date;
- completion checks required inputs;
- completion updates Timeline and Audit.

### CD-F1-09 — View Care Timeline (P0)

As a family member, I want one chronological case history so handover is easy.

Acceptance:

- events can be filtered by document, task, workflow, payroll, communication,
  and contact;
- events link to the authorized source record;
- sensitive events respect current viewer permissions;
- Timeline is not presented as a security audit log.

### CD-F1-10 — Permission denial (P0)

As a restricted family member, I must not see passport, bank, payroll, or care
information beyond my grant.

Acceptance:

- unauthorized API request is denied even if UI is bypassed;
- denied UI reveals no sensitive metadata;
- cross-tenant access is denied and tested;
- denial is audited according to security policy.

## Epic F2 — Visa Renewal

### CD-F2-01 — Detect approaching expiry (P0)

As a family manager, I want an authorized visa-renewal task before expiry.

Acceptance:

- only an active applicable RuleVersion is evaluated;
- output records rule version, source, as-of date, and explanation;
- missing or conflicting rule blocks verified guidance;
- task due date and priority come from rule output, not UI constants.

### CD-F2-02 — Start renewal workflow (P0)

As a family manager, I want a guided visa-renewal workflow so I do not miss
steps.

Acceptance:

- instance pins a WorkflowTemplateVersion;
- required RACI is valid;
- current authorization and document are linked;
- missing licensed-bureau contact creates a blocker and assignment task;
- UI shows why the workflow exists.

### CD-F2-03 — Record contact activity (P0)

As a family manager, I want to document contact with the bureau/social worker
so the case history is complete.

Acceptance:

- supports phone, email, WhatsApp, meeting, letter, SMS, or portal as recorded
  channels;
- MVP clearly labels sending as simulated/not performed;
- outcome, follow-up, confirmation, sensitivity, and visibility are stored;
- entry appears in Timeline.

### CD-F2-04 — Add renewed authorization (P0)

As a family manager, I want to upload and verify the renewed authorization so
the expiry state updates correctly.

Acceptance:

- new authorization is a new record with a new DocumentVersion;
- manual verification is required in MVP;
- historical authorization remains;
- overlaps trigger review;
- workflow cannot complete if validity or linkage is invalid.

### CD-F2-05 — Complete renewal (P0)

As a family manager, I want completion to close related work consistently.

Acceptance:

- required steps and document verification are complete;
- task status, workflow status, dashboard projection, Timeline, and Audit agree;
- no unrelated task is closed;
- user receives a calm success confirmation.

## Epic F3 — Medical Insurance Renewal

### CD-F3-01 — Identify insurance contact and policy (P0)

As a family manager, I want the relevant policy and agent shown together.

Acceptance:

- current valid policy is selected by date and status;
- configured primary/backup insurance contacts are shown;
- policy number is masked;
- no contact produces a guided assignment action.

### CD-F3-02 — Renew without losing history (P0)

As a family manager, I want a new policy period recorded while preserving the
old policy.

Acceptance:

- new MedicalInsurancePolicy and DocumentVersion are created;
- gaps and overlaps trigger review;
- communication and premium metadata are recorded;
- no claim of legal sufficiency is made without a verified rule.

## Epic F4 — Basic Payroll

### CD-F4-01 — Open monthly payroll (P0)

As a family manager, I want a monthly draft based on the active contract.

Acceptance:

- period is unique per case and month;
- input and contract snapshots are stored;
- unverified rule set produces review-required state;
- no amount is silently carried from mutable current settings.

### CD-F4-02 — Explain every component (P0)

As a family manager, I want each payroll item explained so I can review it.

Acceptance:

- quantity, unit, rate, formula, amount, RuleVersion, and sources are shown;
- missing input prevents final approval;
- decimals and rounding follow explicit policy;
- AI is not used for arithmetic.

### CD-F4-03 — Override with accountability (P0)

As an authorized reviewer, I want to correct a component with a reason.

Acceptance:

- permission and, where configured, step-up authentication are required;
- original result remains reproducible;
- reason and actor are mandatory;
- Audit and UI clearly show the override;
- locked period cannot be changed without a controlled correction flow.

### CD-F4-04 — Record payment (P0)

As a family manager, I want to record that salary was transferred.

Acceptance:

- records amount, date, method, masked reference, and evidence;
- does not execute payment;
- “recorded” and “confirmed” are distinct;
- missing evidence can be reported without inventing completion.

## Epic F5 — Employment Closure

### CD-F5-01 — Start case-specific closure (P0)

As a family manager, I want a closure wizard tailored to the reason and dates.

Acceptance:

- captures closure reason, end date, worker and recipient state;
- freezes an input snapshot;
- lists missing payroll, benefit, document, and contact data;
- unverified calculations require professional review.

### CD-F5-02 — Build “who to update” matrix (P0)

As a family manager, I want to know whom to update, why, and who owns it.

Acceptance:

- each row has recipient, reason, level, source, owner, channel, due date,
  status, and confirmation requirement;
- required status needs an applicable verified rule;
- otherwise item is recommended, conditional, or review required;
- worker, bureau/corporation, social worker, insurance agent, payroll
  professional, family, and advisers are included only when case context
  supports them.

### CD-F5-03 — Archive safely (P0)

As a family manager, I want the ended case archived without losing evidence.

Acceptance:

- open required steps block archive or require authorized reasoned override;
- final payroll/payment/document status is summarized;
- case moves to `ended` before `archived`;
- archive is read-only except controlled corrections;
- Timeline and Audit reflect the transition.

## Epic F6 — AI Assistant

### CD-F6-01 — Mock assistant with sources (P0)

As a family manager, I want safe operational answers during prototype testing.

Acceptance:

- uses MockAIProvider and synthetic case projection;
- answer includes explanation, next action, contact, source, confidence, and
  disclaimer;
- unsupported legal/payroll/medical question escalates;
- no provider network call occurs.

### CD-F6-02 — Draft communication (P1)

As a family manager, I want a draft message to a configured contact.

Acceptance:

- draft is based only on authorized minimized context;
- user must review and copy/approve it;
- system does not send in MVP;
- draft never claims a legal duty without verified source.

## Epic F7 — Reporting and operational quality

### CD-F7-01 — Monthly summary (P1)

As a family manager, I want a summary of tasks, documents, payroll, and open
work for handover.

Acceptance:

- projection is generated from canonical records;
- sensitive sections follow permissions;
- report states data-as-of time;
- missing/unverified items are explicit.

### CD-F7-02 — Recover from failed save (P0)

As a user, I want my entered data preserved if saving fails.

Acceptance:

- form input remains available;
- error distinguishes offline, validation, authorization, and server failure;
- retry is idempotent;
- duplicate records are not created.

## Critical end-to-end scenarios

1. Create tenant and employment case, contacts, document, and task; verify
   permission, Timeline, and Audit behavior.
2. Complete Visa Renewal from expiry detection through verified new
   authorization.
3. Complete Medical Insurance Renewal with a new policy and preserved history.
4. Prepare payroll, explain components, apply authorized override, and record
   payment.
5. Complete Employment Closure with case-specific notification matrix and
   archive gate.
6. Attempt cross-tenant, expired-permission, and sensitive-data access and
   verify denial.
