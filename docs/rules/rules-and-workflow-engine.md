# CareDesk Rules & Workflow Engine

Status: **Authority specification v1.0**
Owner: Product, Compliance, and Domain Engineering
Last updated: 2026-07-23

## 1. Boundary

CareDesk has three distinct decision layers:

1. **Rules Engine** — deterministic, versioned evaluation of facts.
2. **Workflow Engine** — orchestration of steps, tasks, RACI, dependencies,
   communication requirements, and completion.
3. **AI Assistant** — explanation, retrieval, summarization, and draft content.

AI may not create legal truth, activate a rule, approve payroll, bypass a
workflow transition, decide termination, or expand a user's permissions.

## 2. Rule model

Every rule has a stable `RuleDefinition` and immutable `RuleVersion` records.
A version contains:

```text
code
domain
jurisdiction
input_schema
condition_expression
output_schema
action_expression
explanation_template
effective_from
effective_to
status
confidence
source_ids[]
required_approval_roles[]
approved_by[]
approved_at
supersedes_version_id
```

Conditions and actions use a constrained deterministic representation. They
must not execute arbitrary code or call an LLM.

## 3. Rule lifecycle and governance

Canonical statuses:

```text
draft -> under_review -> approved -> active
active -> suspended | superseded | retired
```

Only an `active` version is evaluated in user-facing production behavior.

### Approval matrix

| Rule type | Required approval |
|---|---|
| UI reminder with no legal claim | Product Owner |
| Internal operational workflow | Product + Compliance Administrator |
| Visa, permit, or authority procedure | Compliance + qualified legal/domain reviewer |
| Payroll or employment entitlement | Payroll Reviewer + Legal/Employment Reviewer |
| Employment closure calculation or duty | Payroll Reviewer + Legal/Employment Reviewer |
| Privacy, retention, or data sharing | Privacy/Legal Reviewer |
| AI response or redaction policy | Product + Privacy + Engineering |

The developer and AI coding agent are never rule approvers.

Until named reviewers are appointed, time-based prototype rules may be
`operational`; payroll and legal rules must remain `needs_review` and must not
produce a verified conclusion.

## 4. Source evidence

Source hierarchy:

1. legislation, regulations, extension orders, binding judgments, and official
   binding procedures;
2. official government publications and authoritative agency guidance;
3. explanatory secondary sources such as professional guides;
4. operational practice or family preference.

Each `RuleSource` records:

```text
authority
document_title
url_or_reference
section
published_at
retrieved_at
effective_from
effective_to
jurisdiction
source_level
checksum_or_archive_reference
verification_notes
```

A proposal, draft reform, news report, expired procedure, or secondary guide
cannot be represented as current binding law.

## 5. Evaluation contract

Rule evaluation input must include an `as_of` date and tenant/case context.
Output includes:

```text
rule_definition_id
rule_version_id
evaluated_at
as_of
input_snapshot_hash
result
explanation_key_and_parameters
source_references
confidence
review_required
generated_actions[]
```

Requirements:

- deterministic result for identical inputs and active version;
- no hidden dependence on current time;
- no mutation during evaluation;
- currency and decimal arithmetic use explicit precision and rounding policy;
- historical payroll stores the input and rule-set snapshots;
- an override creates a reasoned AuditEvent and never rewrites the original
  evaluation.

## 6. Rule failure modes

| Condition | Required behavior |
|---|---|
| No applicable active rule | show “professional review required”; do not guess |
| Conflicting active rules | block material output and alert Compliance |
| Missing source or approval | treat as unverified |
| Input missing | return structured missing fields, not a partial final amount |
| Version outside effective dates | exclude from evaluation |
| Service unavailable | preserve user input and offer retry; do not use stale legal values silently |

## 7. Workflow model

A `WorkflowTemplateVersion` defines:

- trigger;
- eligibility;
- ordered or graph-based steps;
- required inputs and documents;
- task templates;
- RACI requirements;
- notification requirements;
- entry and exit criteria;
- exception routes;
- cancellation behavior;
- source references;
- effective dates and version.

A `WorkflowInstance` stores a context snapshot and runtime step state. Updating
a template never mutates an already-running instance without an explicit
migration or restart decision.

## 8. Workflow transition rules

Canonical instance states:

```text
not_started -> active -> blocked -> active -> completed
not_started | active | blocked -> cancelled
```

Transition requirements:

- activation requires eligibility and the required RACI assignments;
- completing a step validates required inputs and documents;
- a blocked step records blocker type, owner, and next review date;
- cancellation requires reason and authorization;
- completion creates Timeline events and Audit events through central services;
- deferred tasks require reason and date;
- exception paths never silently mark required actions complete.

## 9. RACI

Stored roles: `responsible`, `accountable`, `consulted`, `informed`.

- Exactly one accountable assignment per active step.
- At least one responsible assignment for an actionable step.
- Informed contacts receive no system access merely because they are informed.
- A Contact may be assigned operationally; only a User with valid membership
  and permission may perform an in-system action.

## 10. Notification requirements

The system distinguishes:

- legal or operational requirement to inform;
- recommended communication;
- conditional communication;
- actual delivery attempt;
- confirmed receipt.

Each requirement includes recipient, reason, source, level, channel preference,
owner, due date, status, and whether confirmation is required.

MVP records or simulates communication. It does not send WhatsApp, SMS, email,
or official submissions.

## 11. MVP workflow: Visa Renewal

### Trigger

An active ImmigrationAuthorization approaches its `valid_to` threshold under
an active rule version.

### Steps

1. Validate active case, current authorization, and expiry date.
2. Create renewal task and set priority from the rule output.
3. Identify primary licensed-bureau/corporation contact; if absent, create a
   blocker and a task to assign one.
4. Present approved required-document guidance with source and retrieval date.
5. Record contact attempt and response.
6. Upload a new DocumentVersion and manually verify extracted fields in MVP.
7. Create or update the new ImmigrationAuthorization record.
8. Mark old supporting document/version as superseded where appropriate.
9. Complete the workflow only after validity and linkage checks pass.
10. Create user-facing Timeline events and append-only Audit events.

### Acceptance

- no task is created from an expired or unapproved rule version;
- new authorization does not overwrite historical validity;
- two overlapping active authorizations trigger review;
- missing contact blocks only contact-dependent steps, not document preparation;
- user can see why the task exists and which source supports it.

## 12. MVP workflow: Medical Insurance Renewal

Steps:

1. detect approaching policy expiry;
2. show current policy and designated insurance contact;
3. record continuity, quote, and document checks;
4. record communication and response;
5. upload and verify the new policy document;
6. create new MedicalInsurancePolicy rather than overwrite history;
7. close tasks and update Timeline/Audit.

Edge cases include coverage gaps, overlapping policies, missing agent, changed
insurer, unverified document, and premium dispute. The product does not decide
whether a policy is legally sufficient without a verified rule and review.

## 13. MVP workflow: Employment Closure

### Inputs

Closure reason, proposed end date, worker and recipient state, contract,
payroll periods, benefit ledger, open tasks, documents, contacts, and applicable
approved rule versions.

### Steps

1. create closure instance and freeze the input snapshot;
2. identify missing payroll and benefit data;
3. require professional review for unverified calculations;
4. build a case-specific notification matrix;
5. assign owner, channel, due date, requirement level, and reason;
6. record attempts and confirmation where required;
7. attach closure documents and final payment evidence;
8. resolve or explicitly carry forward open tasks;
9. produce closure summary;
10. change case to `ended`, then `archived` only after the archive gate.

No global statement that “all listed parties must be notified” is allowed.
Every required item needs an applicable verified rule; otherwise it is labeled
recommended, conditional, or review required.

## 14. Task, Timeline, and Audit side effects

Side effects pass through application services:

```text
Rule evaluation -> proposed domain action
Workflow command -> authorized state transition
Task service -> task mutation
Timeline service -> user-facing history
Audit service -> security/change evidence
```

UI components never create rule, timeline, or audit records directly.

## 15. AI interaction

AI receives only authorized, minimized, purpose-specific projections. It may:

- explain an already evaluated rule;
- summarize open workflow steps;
- identify the configured contact for a task;
- draft a message for user approval;
- retrieve approved source passages.

It must show source, confidence, disclaimer, and recommended next action. When
rules are unverified or conflict, it must say so and escalate.

## 16. Testing

Every rule version requires:

- happy-path examples;
- boundary dates;
- before/after effective dates;
- missing-input behavior;
- conflicting-rule behavior;
- deterministic repeatability;
- source and approval validation;
- historical reproduction.

Every workflow version requires:

- permitted and denied transitions;
- RACI validation;
- dependency and blocker behavior;
- cancellation and retry;
- Timeline and Audit side effects;
- permission tests;
- end-to-end test for the three critical MVP workflows.

## 17. Definition of done

A rule or workflow is not done until its schema, sources, approvals, fixtures,
tests, user explanation, permission behavior, Timeline/Audit behavior, and
sync-matrix impact are reviewed.
