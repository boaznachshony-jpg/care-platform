# Wave 2: Visa Renewal Workflow — Definition of Done

Status: **Complete**
Started: **2026-08-12**
Completed: **2026-08-14**
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

## Delivery sequence and evidence

1. **Governance and contracts** — merged through PRs #31 and #32.
2. **Persistence and RLS** — canonical workflow persistence and forced tenant
   isolation merged through PRs #33 and #36, including additive migrations 0021
   and 0022.
3. **Application and API** — authenticated/idempotent start/list/read and final
   progress/completion mutations merged through PRs #34 and #37.
4. **Web experience** — guided accessible RTL experience merged through PR #35.
5. **Verification and closeout** — required CI on the final application/API slice
   completed green, including live PostgreSQL RLS integration and Playwright E2E.

Each engineering slice was delivered as a separately reviewable PR from the
protected `main` baseline.

## Acceptance criteria — verified complete

- [x] Rule output records version, source, as-of date, explanation, due date, and
  priority.
- [x] Missing, expired, conflicting, or unapproved evidence cannot produce
  verified legal guidance.
- [x] Starting a workflow validates authorization, tenancy, eligibility, RACI,
  and linkage to the current authorization and document.
- [x] A missing licensed-bureau/corporation contact creates a blocker and
  assignment task without blocking unrelated document preparation.
- [x] Contact attempts and outcomes persist follow-up, confirmation, sensitivity,
  and visibility metadata.
- [x] A renewed authorization preserves historical validity; overlaps trigger
  explicit review.
- [x] Completion validates required steps, evidence, linkage, blockers, and
  unresolved overlap review state.
- [x] Completion synchronizes the relevant task/workflow state and writes
  Timeline plus append-only Audit effects without closing unrelated tasks.
- [x] API authorization and database tenant isolation cover every new operation.
- [x] Desktop/mobile RTL behavior is accessible and explains why each action
  exists.
- [x] Unit, integration, PostgreSQL/RLS, accessibility, and end-to-end tests cover
  the critical path and exception paths.
- [x] Required CI is green on the final Wave 2 application/API PR.

## Final verification evidence

The final PR #37 CI run completed successfully with all required gates green:

- Migration and architecture guardrails.
- Unit, integration, and accessibility tests.
- Build and typecheck.
- Format and lint.
- Secret scan.
- PostgreSQL RLS integration using the CI PostgreSQL service.
- Playwright end-to-end tests.
- Aggregate required quality gate.

This clears the environment limitation noted in individual Codex workspaces,
where a local PostgreSQL connection was unavailable: runtime RLS enforcement was
executed successfully in GitHub CI before merge.

The merged PR chain (#31 through #37) provides the recovery and audit trail for
Wave 2; the completed delivery is not dependent on unpushed local-only work.

## Out of scope

- WhatsApp, SMS, email, portal, or government submission.
- AI-generated legal truth or rule approval.
- Authoritative payroll calculations.
- Real personal data or production promotion.
- Destructive legacy removal or undefined dual writes.

## Exit decision

**Wave 2 is complete.** CD-F2-01 through CD-F2-05 are implemented end to end,
the required synchronization impacts are represented in the application and
persistence layers, required test evidence is green, and repository governance
records the completed delivery.
