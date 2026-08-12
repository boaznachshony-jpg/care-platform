# Wave 2: Visa Renewal Workflow — Definition of Done

Status: **In progress**
Started: **2026-08-12**
Tracking issue: [#30 — Wave 2: full Visa Renewal Workflow](https://github.com/boaznachshony-jpg/care-platform/issues/30)

## Outcome

Wave 2 delivers the first complete governed business workflow: Visa Renewal.
It converts the existing renewal date and generated follow-up tasks into a
persisted, auditable workflow with version provenance, dependencies, RACI,
contact activity, evidence, completion policy, and synchronized Timeline/Audit
effects.

## Authority and guardrails

- Follow `docs/SOURCE_OF_TRUTH.md`, accepted ADRs, and `SYNC_MATRIX.md`.
- `EmploymentCase` remains the central employment aggregate.
- Use `WorkflowTemplate`, `WorkflowTemplateVersion`, and
  `WorkflowInstance`; do not add product data to transitional workspace or
  `MvpProfile` structures.
- Every active step has exactly one accountable assignment and at least one
  responsible assignment.
- Do not invent legal deadlines, required documents, or authority procedures.
- A visa/permit rule cannot become approved or active without versioned source
  evidence and the required compliance plus qualified legal/domain review.
- Unapproved behavior is limited to synthetic fixtures and clearly labelled
  simulated or unverified guidance.
- External messages and official submissions are out of scope; the MVP records
  or simulates contact activity.
- Real personal data and production promotion remain blocked by the gates in
  `docs/product/gap-analysis.md`.

## P0 product scope

Wave 2 covers CD-F2-01 through CD-F2-05:

1. Detect approaching expiry through a versioned rule contract.
2. Start a guided renewal workflow that pins a template version.
3. Record licensed-bureau/corporation contact activity and follow-up.
4. Add and verify the renewed authorization without overwriting history.
5. Complete renewal only when required steps, evidence, and linkage are valid.

## Delivery sequence

1. **Governance and contracts** — reconcile repository status; define workflow,
   rule, transition, RACI, evidence, permission, and test contracts.
2. **Persistence and RLS** — add canonical workflow persistence,
   tenant-consistent constraints, least privilege, forced RLS, audit protection,
   and migration verification.
3. **Application and API** — implement authorized, idempotent commands and
   queries, blockers, document/authorization linkage, and Timeline/Audit side
   effects.
4. **Web experience** — deliver the guided mobile/desktop RTL flow with clear
   ownership, blockers, evidence, calm completion, accessibility, and i18n.
5. **Verification and closeout** — cover critical and exception paths with
   synthetic tests, reconcile synchronization impacts, and record green CI.

Each engineering slice must be a separately reviewable PR from the latest
protected `main`.

## Acceptance criteria

- Rule output records version, source, as-of date, explanation, due date, and
  priority.
- Missing, expired, conflicting, or unapproved evidence cannot produce verified
  legal guidance.
- Starting a workflow validates authorization, tenancy, eligibility, RACI, and
  linkage to the current authorization and document.
- A missing licensed-bureau/corporation contact creates a blocker and assignment
  task without blocking unrelated document preparation.
- Contact attempts and outcomes persist follow-up, confirmation, sensitivity,
  and visibility metadata.
- A renewed authorization preserves historical validity; overlaps trigger
  review.
- Completion validates required steps, evidence, and linkage.
- Completion synchronizes the related task, workflow, dashboard projection,
  Timeline, and append-only Audit without closing unrelated tasks.
- API authorization and database tenant isolation cover every new operation.
- Desktop/mobile RTL behavior is accessible and explains why each action exists.
- Unit, integration, PostgreSQL/RLS, accessibility, and end-to-end tests cover
  the critical path and exception paths.
- Required CI and post-merge verification are green.

## Out of scope

- WhatsApp, SMS, email, portal, or government submission.
- AI-generated legal truth or rule approval.
- Authoritative payroll calculations.
- Real personal data or production promotion.
- Destructive legacy removal or undefined dual writes.

## Exit decision

Wave 2 is complete only when CD-F2-01 through CD-F2-05 work end to end, every
synchronization impact is reconciled, required review and test evidence is
recorded, protected `main` CI is green, and the delivery status is closed out
in repository governance.
