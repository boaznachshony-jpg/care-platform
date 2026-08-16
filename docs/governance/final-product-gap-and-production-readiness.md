# Final product gap and production-readiness assessment

Status: **VERIFIED CLOSURE PLAN — final development wave not started**  
Assessment timestamp: **2026-08-16 13:48 UTC**

This assessment applies the strict capability definition in the task: `COMPLETE` means the
applicable domain/application, persistence, authenticated API, authorization, tenant isolation,
UI, validation, idempotency, Timeline/Audit, automated-test, browser-E2E and external-provider
layers are evidenced. Code and tests at the baseline below take precedence over older GREEN labels.

## A. Baseline and CI evidence

- Authoritative baseline: `origin/main` at
  `a97f61fa7286d01b2a124a6cceb07ae29f01a733` (merged PR #48, **Wave 3 closure: canonical
  Timeline, Dashboard and Monthly Close**, at 2026-08-16 10:29:48 UTC).
- Latest post-merge `CI` run: GitHub Actions run
  [31941817077](https://github.com/boaznachshony-jpg/care-platform/actions/runs/31941817077),
  `success` for that exact SHA (completed 2026-08-16 10:32:29 UTC).
- The companion `Push on main` run
  [31941816856](https://github.com/boaznachshony-jpg/care-platform/actions/runs/31941816856)
  also succeeded for the same SHA.
- There is no open feature/development PR. The only open PRs at assessment time are automated
  dependency upgrades #8, #9 and #11; they must not be folded into this governance branch.
- GitHub has no Issue specifically assigning this assessment. Open Issue #30 describes the already
  delivered Wave 2 Visa Renewal scope and is not ownership authority for this task.

## B. Strict 15-capability matrix

| # | Capability | Classification | Verified evidence | Exact remaining layer(s) |
|---:|---|---|---|---|
| 1 | Compliance Timeline | **COMPLETE** | Authenticated case Timeline API, canonical persistence, server-derived tenant/case authorization, forced RLS, translated visible UI, validation/tests and post-merge canonical Playwright navigation/synchronization evidence | None for the defined visible case Timeline path. New capabilities must still add their own human events where policy requires them. |
| 2 | Decision Dashboard | **COMPLETE** | The visible case attention/health path uses one authenticated canonical contract with deterministic provenance, authorization, UI/component/route tests and canonical Playwright evidence | Transitional profile summary cards are presentation outside this capability and must not become an alternate decision engine. |
| 3 | CareDesk Score | **COMPLETE** | Bounded deterministic file-health score and factors share the authenticated case-health API, canonical facts, authorization, validation, unit/route/UI and browser evidence | No legal-approval claim is made; that limitation is intentional. |
| 4 | Smart Document AI | **PARTIAL** | Canonical private documents/versions, extraction and review contracts, date/identity validation, forced-RLS review metadata, authenticated UI/API tests and manual fallback exist | No approved production OCR/AI adapter; browser confirmation through canonical document/task/Timeline/Audit is not proven; provider privacy/configuration and provider E2E are absent. |
| 5 | Case-aware Action AI | **PARTIAL** | Least-privilege case context, grounded structured validation, authenticated/rate-limited API, confirmation UI and deterministic fallback exist | No approved AI provider; approved rule context is empty; checklist idempotency is process-memory only; no full browser mutation/evidence test. |
| 6 | Monthly Close | **COMPLETE** | Manager-authorized PostgreSQL close, immutable actual snapshot, durable tenant-scoped replay receipt, coupled Timeline/Audit transaction, canonical UI/API validation, service/route tests and Playwright close/replay evidence | Worker acknowledgement is a separate collaboration feature and does not alter close completion. |
| 7 | Family Collaboration | **PARTIAL** | Canonical memberships/invitations, responsibility and supported task assignment, worker-request handling, manager authorization, durable replay and Timeline/Audit effects exist in API/UI/service tests | No focused Playwright invitation/revocation/assignment/request journey; hosted browser evidence therefore does not verify the complete collaboration loop. |
| 8 | Worker Portal | **PARTIAL** | Server-derived active worker access, mobile shell, worker-safe projection, request/acknowledgement/preferences, explicit document visibility and five-minute signed downloads; raw keys are withheld; route/service/RLS contracts exist | No worker Playwright journey; production Supabase invitation redirect/email and object-storage deployment are external; no governed leave ledger or canonical payroll-entry amount exists. |
| 9 | Event Wizards | **PARTIAL** | Typed eight-event catalog, deterministic questions/validation, durable forced-RLS `event_action_plan` foundation and component/application tests exist | Current browser panel is chiefly a local/static planner; authenticated idempotent commit through canonical Task/Workflow/Timeline/Audit adapters and browser E2E are absent. |
| 10 | Audit / Evidence Trail | **PARTIAL** | Append-only tenant-scoped `audit_event`, least-privilege insertion, forced RLS, denial audit and PostgreSQL/unit/integration coverage exist; several canonical mutations synchronize minimal audit evidence | Coverage is not universal: document-AI confirmation, wizard execution, escalation lifecycle and Binder export lack complete receipts; no unified evidence export/verification journey exists. |
| 11 | Regulation Engine | **PARTIAL** | Versioned/effective-date/approved-source deterministic rule contracts and persistence with forced RLS and application tests exist | Reviewed content is narrow, assistant rule context is empty, authoring/approval lifecycle UI/API is incomplete, and evaluation-to-action/Timeline/Audit browser evidence is absent. |
| 12 | Future Cost | **PARTIAL** | Validated deterministic 12-month projection, actual/forecast/unknown provenance, canonical closed snapshots, inspectable components, totals and planning-only reserve guidance have unit/UI coverage | Draft payroll entries and scenario expenses remain in compatibility storage; no canonical payroll-entry aggregate/API or Playwright path proves forecast inputs, closed-actual replacement and tenant isolation end to end. |
| 13 | WhatsApp-first Engagement | **FOUNDATION ONLY** | Consent/preference, notification intent/attempt, orchestration and disabled adapters exist with forced-RLS tables and fail-closed tests | No approved provider, verified webhook, retry/reconciliation operations, production credentials, phone preference enablement or provider E2E. |
| 14 | Human Escalation | **PARTIAL** | Authenticated/rate-limited, tenant-owned, idempotent request create/list, forced RLS, creation audit, UI and route tests exist | No durable status/assignment/resolution APIs/UI, review-package manifest, full Timeline/Audit lifecycle, provider/commercial integration or Playwright journey; local fallback is test/development only. |
| 15 | Emergency Binder | **PARTIAL** | Authenticated employer-only browser route, presets, explicit selection, missing-value labels, RTL A4 print and component tests exist | It reads compatibility data and produces client print only; authenticated server manifest/PDF, durable export audit, secure sharing/access audit, rate limiting, RLS and Playwright export evidence are absent. |

**Totals: 4 COMPLETE; 10 PARTIAL; 1 FOUNDATION ONLY; 0 NOT IMPLEMENTED.** Historical
capability-wide GREEN labels are delivery-slice shorthand and do not override this matrix.

## C. Remaining product completion gaps

The gaps below are deliberately de-duplicated. A row may affect several capabilities.

| Gap | Affected capabilities | Missing product layer(s) | Blocks production? | External provider/infrastructure? | Repository-only closure? | Complexity |
|---|---|---|---|---|---|---|
| Canonical payroll-entry aggregate and cutover | Future Cost; also payroll inputs used by Binder | Normalized draft/record persistence, authenticated API, validation/authorization/RLS, UI cutover, reconciliation and E2E | **Yes** for authoritative financial planning and removal of sensitive split truth | No provider; deployed PostgreSQL is an operations gate | **Yes** for implementation | **LARGE** |
| Evidence-bearing automation execution | Smart Document AI, Action AI, Event Wizards, Audit | Durable idempotency for checklist/plan confirmation, canonical Task/Workflow/Timeline/Audit adapters and Playwright paths | **Yes** before those capabilities are sold as completed automation; manual launch can remain fail-closed | Production AI/OCR additionally needs external approval/provider | Partly: deterministic/manual execution can close in repo; provider-backed extraction/generation cannot | **LARGE** |
| Reviewed regulation lifecycle/content | Action AI, Event Wizards, Regulation Engine | Approved content set, authoring/review/activation lifecycle, authenticated UI/API and evaluation-to-evidence E2E | **Yes** for regulated guidance claims; manual professional-review fallback may launch | Legal/professional validation is external | Partly | **LARGE** |
| Collaboration/worker browser proof and missing governed facts | Family Collaboration, Worker Portal | Focused employer/worker Playwright paths; governed leave ledger and canonical payment amount depend on payroll aggregate | **Yes** if worker portal is launch scope | Invitation email/redirect and storage configuration are external | Browser tests and ledger code: yes; delivery configuration: no | **MEDIUM** |
| Provider-backed communications | WhatsApp-first Engagement | Approved adapter, consent enablement, signed webhook, delivery/retry reconciliation and E2E | **No** if phone channels stay visibly disabled; **yes** for a WhatsApp-first launch claim | **Yes** | No | **LARGE** |
| Professional review lifecycle | Human Escalation | Status transitions, assignment/resolution, explicit package manifest, complete evidence and E2E | **Yes** if CareDesk promises managed escalation; request-only/manual handoff must be labelled | Provider/commercial assignment is external | Lifecycle/package code partly; provider fulfilment no | **MEDIUM** |
| Secure server Binder export | Emergency Binder, Audit | Authorized server manifest/render, immutable export receipt/hash, rate limiting, secure share/revocation/access audit, RLS and E2E | **Yes** for production Binder export/sharing; browser print alone can remain an interim labelled tool | Render/object storage deployment is infrastructure | Product path can be coded in repo; deployed storage/rendering remains external | **LARGE** |

## D. Production and operations gates (not product gaps)

These gates must not be counted as missing product features:

1. Configure production Supabase authentication, verified email/redirect domains, MFA policy and
   recovery flows; verify owner, manager, family and worker identities in the deployed environment.
2. Provision managed PostgreSQL with the least-privilege `caredesk_app` role, apply migrations,
   verify `ENABLE`/`FORCE RLS`, same-tenant constraints and live cross-tenant denial.
3. Provision private encrypted object/document storage, key management, lifecycle/retention,
   signed-link expiry and deletion/revocation controls.
4. Establish encrypted backups and perform documented database/object restore and tenant-count/
   evidence reconciliation drills.
5. Configure Web/API deployment, CORS, environment validation, server-only secrets/rotation,
   domain/TLS and preview-to-production promotion controls.
6. Deploy shared/distributed rate limiting and monitoring/alerting for authentication, API errors,
   storage, notification/provider attempts, database saturation and security anomalies.
7. Preserve CI, secret scanning, dependency review and CodeQL as required checks, and run live
   PostgreSQL RLS plus desktop/mobile Playwright against release candidates.
8. Obtain Israeli payroll/legal/privacy professional validation, approved disclaimers and data-
   processing/retention decisions before authoritative calculations or provider-backed AI/OCR.
9. Complete incident response, access review, audit retention, support ownership, uptime objectives
   and operational runbooks; verify Vercel Web/API deployment health on the launch SHA.

## E. Legacy and transitional storage matrix

`mvp-storage` remains active. Values under the `caredesk.mvp.*` prefix are encrypted on-device with
an ephemeral session key and synchronized as a versioned authenticated workspace snapshot. That is
safer than plaintext local storage but remains a compatibility blob, not normalized canonical
persistence or database-enforced row-level isolation.

| Data/dependency | Active use | Classification | Production decision and plaintext risk |
|---|---|---|---|
| Employer / care-recipient profile and client roster | Onboarding, settings, clients, shell summaries and reminders | **MUST MIGRATE BEFORE PRODUCTION** | Contains names, identifiers, dates and employment facts. Business payload is encrypted in local storage, but the remotely synchronized compatibility snapshot and browser memory remain sensitive; migrate to canonical case parties/profile and remove legacy plaintext-read compatibility. |
| Caregiver data embedded in profile | Onboarding, employee/payroll presentation and reports | **MUST MIGRATE BEFORE PRODUCTION** | Sensitive identity/employment data; same encryption caveat. Canonical `caregiver` exists, so the split writer/reader must be reconciled and cut over. |
| Payroll-entry records and employment expenses | Payroll entry/report, open-month analytics and Future Cost scenarios | **MUST MIGRATE BEFORE PRODUCTION** | Highest remaining plaintext-impact category after in-browser decryption: salary, payments, leave and expenses. No normalized payroll-entry aggregate exists. |
| Tasks | Legacy Tasks page, reminders and compatibility workspace | **MUST MIGRATE BEFORE PRODUCTION** | Canonical task already exists. The compatibility page is an active second source of truth and must be cut over/reconciled rather than extended. |
| Document metadata | Legacy Documents page and Binder selection | **MUST MIGRATE BEFORE PRODUCTION** | Canonical document/version/storage exists. Compatibility metadata (names, categories, dates) must be cut over. Uploaded file bytes in IndexedDB/device cache must follow explicit cleanup; no raw server key should enter the browser model. |
| Local document-file cache | Legacy offline/browser document preview | **INTENTIONALLY TRANSITIONAL** | May remain only as an explicitly bounded encrypted/offline cache after canonical document authority is enforced; current cleanup/account boundary tests must remain. It is not durable authority. |
| Reminder lead days and UI settings | Settings/reminder generation; font scale uses ordinary local storage | **INTENTIONALLY TRANSITIONAL** | Non-sensitive display preferences may remain local. Reminder settings tied to case obligations should migrate to canonical participant preferences. Font scale and onboarding progress are not business authority. |
| Event Wizards | Canonical application/SQL foundation, but current browser panel does not use `mvp-storage` for committed plans | **OBSOLETE** as an `mvp-storage` concern | Do not add wizard state to the compatibility blob; wire the existing canonical plan model instead. |
| Seeded MVP fixtures and direct localStorage manipulation | Playwright/unit/demo setup | **TEST/DEMO ONLY** | Synthetic data only; keep out of production seeding and never use real PII. |
| Legacy monthly-close helpers/types | Retained functions/types/tests in `mvp-storage`, not used by the canonical close UI | **OBSOLETE** | Canonical `payroll_month_close` is the only writer. Remove after compatibility migration; never reactivate or dual-write. |
| Workspace owner/sync metadata, onboarding step and billing-session flag | Account-cache fencing and UI flow state | **INTENTIONALLY TRANSITIONAL** | Identifiers/version flags are metadata rather than case facts. Continue clearing on account change/sign-out and avoid names, tokens or case content in these keys. |

### Sensitive plaintext conclusion

- There is **no evidence that active `caredesk.mvp.*` business payloads are intentionally written as
  plaintext**: writes call the browser-storage encryption wrapper, and legacy plaintext is accepted
  only for migration.
- Risk remains because the encryption key lives in the same browser session, decrypted PII exists in
  browser memory, old plaintext values can still be read during migration, IndexedDB file handling
  has a separate boundary, and the remote workspace persists a compatibility JSON snapshot rather
  than normalized rows with per-aggregate RLS. This is defense-in-depth, not production authority.
- Payroll, identity/profile and document compatibility records are therefore launch blockers until
  canonical cutover or an explicitly approved, time-bounded pilot exception with data minimization.

## F. Security readiness

| Control | Repository evidence | Closure decision |
|---|---|---|
| Server-derived tenant authority | Authentication resolves the actor; case and worker routes authorize through actor membership/active access and do not accept tenant authority from payloads | **Implemented in canonical paths**; deployment auth configuration remains a gate. |
| Same-tenant foreign keys | Composite tenant/resource constraints cover canonical case, document, Timeline, close, Wave 4–5 and review relations | **Implemented/tested by migration contracts**; verify live after migration. |
| `ENABLE` / `FORCE RLS` | Canonical tenant tables and Wave migrations enable and force RLS with least-privilege policies | **Implemented**; compatibility workspace blobs do not provide row-level aggregate isolation. |
| Cross-tenant denial | Executable RLS harness and API authorization tests cover denial/no mutation | **Implemented in tested canonical scope**; mandatory live release check. |
| Durable idempotency | Visa, canonical close and Wave 5 mutations use PostgreSQL receipts | **Partial globally**: Action AI checklist uses process memory and must not be treated as production-durable. |
| Append-only Audit | Database privileges/triggers prevent mutation/deletion; canonical audit service stores minimal evidence | **Implemented foundation, incomplete mutation coverage** as listed in product gap 10. |
| Secret scanning | Required CI secret-scan job is part of the successful aggregate CI pipeline; no provider/browser secret is designed into AI or document paths | **Repository gate green**; production secret provisioning/rotation remains external. |
| Sensitive data in logs | API error/logging policy and automation architecture prohibit bodies/content; repository console output reviewed is operational CLI metadata rather than case content | **No known case-content logging found**, but deployed log redaction/retention must be verified. |
| Browser-storage encryption | `caredesk.mvp.*` payload writes are encrypted with authenticated encryption and an ephemeral session key; account-switch/sign-out clearing exists | **Transitional mitigation only**, not a substitute for canonical persistence, device security or RLS. |
| Worker storage-key secrecy | Worker document service resolves the key server-side and returns only a five-minute signed URL after active-access and visibility checks | **Implemented**; production bucket policy and expiry must be verified. |
| Disabled phone providers fail closed | WhatsApp/SMS adapters return disabled; preference API rejects enabled/granted combinations and persists only disabled states | **Implemented**; do not advertise phone delivery. |

**Security conclusion:** the canonical architecture has strong repository controls, but CareDesk is
**not production-security ready** until the deployment, identity, database, storage, backup,
monitoring, rate-limit, secrets and operational gates in section D are verified on the launch SHA.

## G. Smallest coherent final development wave

Name: **Final development wave — canonical records and launch-critical evidence**. It is
**PROPOSED, not started and not complete**.

1. **Canonical payroll records and compatibility cutover.** Add the normalized payroll-entry/
   expense aggregate and authenticated manager API, forced RLS/same-tenant constraints, durable
   idempotency and validation. Cut Payroll and Future Cost to it; reconcile/remove active profile,
   caregiver, task and document compatibility readers in favor of existing canonical APIs.
2. **Finish deterministic automation and regulation execution.** Persist checklist/event execution
   durably through canonical task/workflow/Timeline/Audit ports; expose only reviewed active rules;
   add review/activation controls and manual/fail-closed paths. Do not connect external AI yet.
3. **Close launch collaboration evidence.** Add employer and mobile-worker Playwright journeys for
   invitation/activation, responsibility/task assignment, worker request handling, preference,
   signed document allow/deny and payment acknowledgement, plus live RLS/replay checks.
4. **Complete professional escalation and secure Binder evidence.** Add the request lifecycle and
   explicit review/export manifest, server-authorized hash/receipt, rate limits and access audit.
   Provider assignment and public sharing stay disabled until contracts/infrastructure exist.
5. **Release/security closure.** Remove obsolete local close/state paths, prove no sensitive
   plaintext business keys, run full live-PostgreSQL/Playwright/security gates, and produce the
   deployment/restore evidence needed to hand off to operations.

This wave targets repository-solvable launch blockers without pretending external providers are
available. Completion of these deliverables is estimated to raise strict product capability
completion from **4/15 (27%) to approximately 11/15 (73%)**. Smart Document AI, Case-aware Action
AI, WhatsApp-first Engagement and provider-fulfilled Human Escalation cannot become strictly
complete without external approvals/providers; they must remain accurately labelled.

## H. Explicit non-goals / do not build before launch

- Do not enable WhatsApp/SMS, add webhook code or buy a provider before consent, privacy,
  commercial and operational approval.
- Do not connect generative AI/OCR or send case/document content to a third party before ADR-003
  privacy approval, data-minimization review, DPA, credentials and provider evaluation.
- Do not build a broad professional marketplace, appointment/payment system or automated legal
  advice; a governed request/package/manual handoff is sufficient for launch.
- Do not add new event types, speculative Israeli rules, entitlement calculators, severance logic
  or authoritative payroll formulas without professional validation.
- Do not build public Binder links, attachment ZIPs, native mobile apps, new channels, analytics
  dashboards, broad refactors or new Waves.
- Do not rewrite applied migrations, introduce dual writes, expose object keys, or migrate
  dependency upgrades into the final wave without explicit planning.

## I. Acceptance criteria

1. Every production business record used by Payroll/Future Cost, Tasks, Documents, employer,
   recipient and caregiver views has one declared canonical PostgreSQL writer; compatibility data
   is reconciled, cut over, read-only for rollback or removed under an approved migration gate.
2. Manager payroll mutations validate finite/non-negative inputs, use durable tenant-scoped
   idempotency, enforce same-tenant authorization/RLS and create approved Timeline/Audit evidence.
3. A confirmed assistant checklist or event plan executes exactly once through canonical services;
   retry returns the receipt, and cancel/invalid/cross-tenant requests make no change.
4. Only active, effective, reviewed rules can influence output; source/version/provenance is visible,
   missing authority produces uncertainty/professional-review guidance, never invented law.
5. Employer and worker journeys work after refresh/retry on desktop and mobile. Worker identity,
   case/caregiver scope and document visibility are derived server-side; no raw storage key appears.
6. Professional-review transitions and Binder exports use authenticated, authorized, rate-limited,
   explicit manifests and append-only receipts. No provider fulfilment or public share is claimed.
7. WhatsApp/SMS and unapproved AI/OCR remain visibly disabled/fail-closed with usable manual paths.
8. No real PII, credentials, provider content, document bytes or message bodies enter fixtures,
   logs, Audit payloads or notification-attempt evidence.

## J. Required tests and validation

- Domain/application unit tests: payroll validation/provenance, rule selection, plan transitions,
  escalation/export lifecycle, consent and deterministic fallbacks.
- API integration tests: authentication, manager/worker role boundaries, validation, durable replay
  and conflict, safe 404/403 behavior, rate limiting and no-mutation failures.
- Live PostgreSQL: additive migration safety, same-tenant foreign keys, `ENABLE`/`FORCE RLS`, least
  privilege, append-only evidence, cross-tenant denial and restore/reconciliation queries.
- Storage: private upload, explicit worker visibility, five-minute signed-link expiry/revocation,
  no raw-key serialization, encrypted cache/account switching and compatibility cutover.
- React/component/accessibility: all loading/error/empty/disabled/RTL/mobile states and textual
  equivalents for financial projections.
- Playwright desktop/mobile: canonical payroll save/close/replay/Future Cost; employer/worker
  collaboration journey; deterministic plan execution; professional request; Binder export receipt;
  cross-tenant and worker-document denial.
- Root `format:check`, lint, build, typecheck, all unit/integration/accessibility tests, secret scan,
  CodeQL and aggregate quality gate; successful Web/API preview and production deployment checks.
- Operations: backup/restore drill, monitoring alert exercise, secret rotation, auth/MFA/recovery,
  rate-limit behavior and signed-link expiry in the production-like environment.

## K. Definition of Done

The final development wave is done only when all five deliverables and acceptance criteria are
merged through reviewed PRs; every required test is green on the final `main` SHA; live managed
PostgreSQL/RLS, object storage, Web/API deployments, authentication/MFA, backups/restores,
monitoring/alerting, distributed rate limiting and secrets are verified; payroll/legal/privacy
sign-offs are recorded; compatibility cutover has reconciliation and rollback evidence; no
critical/high security finding remains; and `BUILD_STATUS.md`/`AGENT_STATUS.md` match reality.

Mocks, process-memory receipts, local storage, browser print alone, unit tests alone, a successful
documentation PR, or external work merely being planned do not satisfy this definition.

## L. Launch blockers

### Product blockers

1. Canonical payroll-entry/expense persistence and UI cutover; eliminate sensitive split truth for
   employer/caregiver/payroll/task/document records.
2. Durable evidence-bearing automation execution and reviewed regulation boundary for any
   automation/regulatory claims included at launch.
3. Employer/worker Playwright and live-RLS proof of the complete collaboration loop.
4. Durable professional-review lifecycle/manual handoff if escalation is a launch promise.
5. Server-authorized, audited Binder export if Binder export—not explicitly labelled browser
   print—is a launch promise.

### Production/operations blockers

1. Production auth/MFA/email/redirect and access-recovery verification.
2. Managed least-privilege PostgreSQL and private encrypted object storage with live RLS tests.
3. Backup/restore/reconciliation evidence and retention/deletion approval.
4. Monitoring/alerting, distributed rate limiting, secrets/rotation, deployment/CORS/TLS and
   incident-response readiness.
5. Payroll/legal/privacy professional validation and required provider/data-processing approvals.

## M. Post-launch backlog

- Approved OCR/AI adapters and provider evaluations after privacy/legal gates.
- WhatsApp/SMS provider, webhook and delivery reconciliation after affirmative consent design.
- Professional marketplace, scheduling and commercial settlement after the manual lifecycle proves
  demand.
- Governed leave entitlement ledger and expanded reviewed regulation library.
- Secure external Binder sharing/attachment bundles beyond the launch export receipt.
- Additional locales, native mobile/offline experience, optional analytics and richer evidence
  export after production telemetry identifies need.

## N. Closure decision and external prerequisites

This governance PR does not implement or complete the final wave. The launch remains blocked by
the product and operational items above. External prerequisites not solvable solely in repository
code are: (1) provider/privacy/legal approval and contracts for OCR/AI, WhatsApp and professional
fulfilment; (2) managed identity/database/object-storage/deployment/monitoring/backup services and
their production configuration; and (3) qualified Israeli payroll/legal validation and operational
ownership. Until then, disabled/manual paths must remain explicit and fail closed.
