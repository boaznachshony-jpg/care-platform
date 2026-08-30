# Backend API Review

## Summary

The tenant-isolation posture at the HTTP layer is genuinely good: every non-public route runs `makeAuthenticate`, the tenant is always taken from `request.actor` (derived from the verified session + membership) and never from a body/query field, and I found no route where a client-supplied tenant id reaches storage. Zod validation is applied on essentially every mutating route, error envelopes are uniform, and the storage adapter derives object keys server-side. The dominant theme of the real defects is **the gap between the code and the database it will actually run against**: a systemic `SELECT … FOR UPDATE` on a table the application role has no `UPDATE` grant on will break every idempotent mutation in production, and eight hand-rolled transaction helpers omit the `set local role caredesk_app` that the shared `withTenant` helper performs, so half the API's SQL loses the defence-in-depth that the other half has. Secondary themes: optimistic concurrency is opt-in (not enforced) on financial records, multi-step commits are not transactional so a retry after a partial failure duplicates work, and the Wave-5 routes swallow every error into a fixed status code — which would hide the outage in the first finding. Test coverage is broad and thoughtful for the routes that have tests, but every Postgres path is tested against hand-written pg stubs that reproduce the service's own SQL, so no test can ever catch a grant, privilege or RLS mistake; the Wave-5 and canonical-payroll-close routes have no API tests at all.

## Findings

### [BLOCKER] Every idempotent mutation issues `SELECT … FOR UPDATE` on a table the app role cannot lock

- **ID:** API-01
- **File:** apps/api/src/payroll-entry-service.ts:105 (plus apps/api/src/leave-entry-service.ts:64, apps/api/src/scenario-expense-service.ts:60, apps/api/src/binder-export-service.ts:208, apps/api/src/regulation-rule-service.ts:369, apps/api/src/product-intelligence/canonical-intelligence-service.ts:104, apps/api/src/collaboration/wave5-service.ts:71)
- **What:** Seven services read the replay receipt with `select request_hash, response from idempotency_record … for update`, but `database/migrations/0021_visa_renewal_persistence.sql:275` grants only `select, insert on idempotency_record to caredesk_app` — PostgreSQL requires the `UPDATE` privilege for `SELECT … FOR UPDATE`, so the statement is rejected outright.
- **Why it matters:** With `DATABASE_URL` pointing at the documented least-privilege `caredesk_app` login (DEPLOYMENT.md:37, .env.example:18-25), the *first* call — not just a concurrent one — fails: `PUT /cases/:id/payroll-entries/:month`, `POST|PUT /cases/:id/leave-entries`, `POST|PUT|DELETE /cases/:id/scenario-expenses`, `POST /cases/:id/binder-exports`, `POST|PATCH /regulation-rules`, `POST /cases/:id/payroll-month-closes` and every Wave-5 mutation raise SQLSTATE 42501 (`permission denied for table idempotency_record`), the transaction rolls back, and the customer sees `500 INTERNAL_ERROR` — or, on the Wave-5 routes, a misleading `403`/`409` (see API-06). No payroll month, leave day, scenario expense, binder-export receipt or regulation-rule change can ever be saved. `packages/db/src/visa-renewal-migration.test.ts:37` actively asserts `expect(sql).not.toMatch(/grant[^;]*update[^;]*idempotency_record/i)`, so the two halves of the codebase encode directly contradictory intents and neither side's tests can detect it.
- **Fix:** Replace the lock-based read with the pattern `PgIdempotencyRepository` already uses (`packages/db/src/visa-renewal-repository.ts:256-281`): a plain `select` followed by `insert … on conflict do nothing`, letting the primary key `(tenant_id, operation, idempotency_key)` serialise concurrent duplicates. Keep the `select, insert`-only grant (append-only receipts is the right call) and add an integration test that runs one mutation as `caredesk_app` against a real database.
- **Confidence:** CONFIRMED

### [HIGH] Eight hand-rolled tenant transactions skip the role downgrade that `withTenant` performs

- **ID:** API-02
- **File:** apps/api/src/collaboration/wave5-service.ts:87-104 (identical helpers at apps/api/src/payroll-entry-service.ts:64-77, apps/api/src/leave-entry-service.ts:47-60, apps/api/src/scenario-expense-service.ts:44-56, apps/api/src/regulation-rule-service.ts:269-282, apps/api/src/binder-export-service.ts:150-164, apps/api/src/evidence-export-service.ts:187-201, apps/api/src/product-intelligence/canonical-intelligence-service.ts:59-73)
- **What:** Each private `tenantTx`/`tx` helper does `begin` + `set_config('app.tenant_id', …, true)` but omits the `set local role caredesk_app` that the shared `withTenant` (packages/db/src/pool.ts:62) executes, so these statements run as whatever role the connection string authenticates as.
- **Why it matters:** The RLS policies are `using (tenant_id = current_setting('app.tenant_id', true)::uuid)`; a connection holding `BYPASSRLS` (Supabase's `postgres` owner, which `DATABASE_ADMIN_URL` points at and which an operator can trivially paste into `DATABASE_URL`) skips them entirely. Every query in these services is written to rely on RLS rather than an explicit tenant predicate — e.g. `select ... from payroll_entry where employment_case_id=$1` (payroll-entry-service.ts:82), `select 1 from tenant_membership where id=$1 and status='active'` (wave5-service.ts:259), `select status,employment_case_id from worker_request where id=$1 for update` (wave5-service.ts:550). Under an owner connection, a manager in tenant A who guesses tenant B's case UUID reads and writes B's payroll, leave, scenario and worker data. The inconsistency is visible inside a single request: `registerPayrollEntryRoutes`'s `requireManager` uses `withTenant` (role downgraded) while the payroll write immediately after does not.
- **Fix:** Delete the seven duplicated helpers and route all of them through `withTenant` from `@caredesk/db`, or at minimum add `await client.query('set local role caredesk_app')` immediately after `begin` in each. Add a lint rule or test asserting no `set_config('app.tenant_id'` appears outside `packages/db/src/pool.ts`.
- **Confidence:** CONFIRMED (the missing statement); the cross-tenant consequence is conditional on the connection role, which the docs say should be `caredesk_app`.

### [HIGH] Optimistic concurrency is opt-in on payroll and scenario-expense writes — a client that omits `version` silently overwrites

- **ID:** API-03
- **File:** apps/api/src/payroll-entry-service.ts:116-120 and apps/api/src/routes/payroll-entries.ts:42 (same pattern at apps/api/src/scenario-expense-service.ts:126 / apps/api/src/routes/scenario-expenses.ts:22)
- **What:** The route schema declares `version: z.number().int().positive().optional()` and the service guards with `if (input.version !== undefined && previous.rows[0] && input.version !== previous.rows[0].version) throw version_conflict` — omitting the field disables the check entirely.
- **Why it matters:** Two managers open March payroll. A saves `total: 7350`; B, whose form was loaded before A's save (or whose client simply omits `version` — the web client's own type at apps/web/src/api/client.ts:494 makes it optional), saves `total: 6100`. B's `insert … on conflict do update` overwrites every column and bumps `version`; A's figures are gone with no 409 and no way to tell from the response that anything was lost. Nothing in the route or the schema constrains the `status` transition either, so a month already saved as `final` can be silently rewritten and pushed back to `draft`. `LeaveEntryService.update` gets this right (`version: z.number().int().positive()`, required, apps/api/src/routes/leave-entries.ts:30), which shows the intended contract.
- **Fix:** Make `version` required on `PUT /cases/:caseId/payroll-entries/:month` and on the scenario-expense update/delete paths (it may stay absent only for a create, distinguished by the absence of an existing row), and reject any write whose target row is already `status='final'` unless an explicit reopen flag is supplied.
- **Confidence:** CONFIRMED

### [HIGH] Automation commits are not transactional; a failure mid-way releases the receipt and a retry duplicates every task already created

- **ID:** API-04
- **File:** apps/api/src/routes/event-action-plans.ts:244-339 (same shape at apps/api/src/routes/product-differentiation.ts:421-461)
- **What:** After `automationReceipts.claim` succeeds, the handler creates N tasks one at a time through `container.createTask.execute` (each its own connection/transaction), then writes the durable `event_action_plan` row, then Timeline, then Audit; the `catch` calls `automationReceipts.fail(...)` which flips the receipt to `failed` so that `claim` will re-issue it (automation-receipt-store.ts:125-132).
- **Why it matters:** A plan with 5 items where the connection drops after task 3 leaves 3 governed tasks committed, no plan row, no Timeline/Audit evidence, and a released claim. The client's automatic retry with the same `Idempotency-Key` re-enters the loop from item 1 and creates 3 duplicate tasks. The customer ends up with 8 tasks for a 5-item plan and an audit trail claiming 5. The comment "Release the claim so a retry with the same key can execute" is exactly backwards for a non-idempotent body of work.
- **Fix:** Either make the whole commit one transaction (pass a `PoolClient` through the task use case, or write the plan row + tasks in a single `withTenant` block) or make it resumable — record each `committedItems` entry on the receipt as it is created and have the retry skip items already receipted. Do not release a claim whose side effects were partially applied.
- **Confidence:** CONFIRMED

### [MEDIUM] Authorization denials inside automation handlers surface as 500 and are never logged as security events

- **ID:** API-05
- **File:** apps/api/src/routes/product-differentiation.ts:421-461 and apps/api/src/routes/event-action-plans.ts:244-339
- **What:** `authorizeCase` only checks `employment_case:read`, which `viewer` and `family_member` hold (container.ts:167-190). The `task:create` check happens later inside `container.createTask.execute`, and the surrounding `catch` re-throws the `AuthorizationError` after calling `fail()`, so it reaches the generic error handler.
- **Why it matters:** A `viewer` POSTing `/cases/:id/assistant/checklist-confirmations` or `/cases/:id/event-plans` gets `500 INTERNAL_ERROR` instead of `403 FORBIDDEN`, `sendError`'s `securityEvent: 'authorization_denied'` warn line (routes/http-errors.ts:12-23) is never emitted, and each attempt leaves a `failed` row in `automation_execution_receipt`. A privilege-probing client is invisible in the logs and looks like a server fault on the dashboard.
- **Fix:** Catch `AuthorizationError` in both handlers and return `sendError(request, reply, 403, 'FORBIDDEN')`; better, perform the `task:create` authorization check before `claim()` so no receipt is burned.
- **Confidence:** CONFIRMED

### [MEDIUM] Wave-5 routes swallow every error into a fixed status code, masking both authorization denials and outages

- **ID:** API-06
- **File:** apps/api/src/routes/wave5.ts:184-212 (also lines 69-71, 94-96, 118-120, 135-137, 146-148, 162-166, 220-224, 243-247)
- **What:** Ten handlers use a bare `catch { return sendError(..., <fixed status>) }` with no discrimination of the thrown error.
- **Why it matters:** `PATCH /worker-requests/:requestId` maps *everything* to `409 INVALID_STATE_TRANSITION` — including `manager_required`, which `Wave5Service.updateRequest` throws before any state is read (wave5-service.ts:529). A viewer attempting to approve a worker's vacation request is told the state transition is illegal, is never recorded as `authorization_denied`, and an auditor reading the logs sees no denial. The same blanket catch turns `PUT /cases/:id/responsibilities/:kind` failures (`case_not_found`, `invalid_assignee`, `idempotency_conflict`, and the SQLSTATE 42501 from API-01) into an indiscriminate `403`, so the total breakage in API-01 would present in production as "permissions are wrong" rather than as an error worth paging on.
- **Fix:** Give `Wave5Service` typed errors (or reuse the `message === 'manager_required'` mapping the payroll/binder routes already use) and map them explicitly: `manager_required` → 403, `case_not_found`/`task_not_found` → 404, `invalid_transition` → 409, `idempotency_conflict` → 409, everything else re-thrown to the error handler so it is logged and returns 500.
- **Confidence:** CONFIRMED

### [MEDIUM] Every production hardening rule is keyed on `NODE_ENV === 'production'`, and nothing asserts it is set

- **ID:** API-07
- **File:** apps/api/src/env.ts:6 (guards at 106-116, 164-170, 184-190; consumers at apps/api/src/container.ts:360-418 and apps/api/src/create-server.ts:68-70)
- **What:** `NODE_ENV: nodeEnvSchema.default('development')`. Every fail-closed rule in the schema, plus the CORS narrowing and the synthetic-identity seeding, is conditioned on that value being literally `'production'`. `DEPLOYMENT.md` never lists `NODE_ENV` among the variables to set.
- **Why it matters:** A deployment (self-hosted, a container, a non-Vercel host) that leaves `NODE_ENV` unset boots "successfully" with: `WORKSPACE_ENCRYPTION_KEY` no longer required for a live `DATABASE_URL` (env.ts:184) — so real tenant workspaces are written to Postgres unencrypted; `BILLING_PROVIDER=mock` accepted (env.ts:164); the independent backup destination for document storage no longer required (env.ts:106); `MockAuthService` seeded with the long-lived `dev-local-token` owner session (container.ts:360-368); and CORS widened to any RFC-1918 origin (create-server.ts:72-80). `/ready` reports `ready: true` (container.ts:616) because that check is also gated on the same string. Vercel sets `NODE_ENV=production` automatically, which is the only thing standing between this and a live incident.
- **Fix:** Require `NODE_ENV` explicitly (drop the `.default`) so a missing value fails startup, or add a positive deploy assertion (e.g. refuse to start when `DATABASE_URL` is set and `NODE_ENV !== 'production'` unless an explicit `ALLOW_NON_PRODUCTION_DATABASE` opt-in is present). List `NODE_ENV=production` in DEPLOYMENT.md.
- **Confidence:** CONFIRMED

### [MEDIUM] MFA on billing and membership management defaults to log-only in production

- **ID:** API-08
- **File:** apps/api/src/env.ts:12 and apps/api/src/plugins/mfa.ts:21-23
- **What:** `SENSITIVE_OPERATION_MFA_MODE` defaults to `'report'`; in that mode `requireMfa` logs `securityEvent: 'mfa_required'` and then falls through, allowing the request.
- **Why it matters:** With the default configuration, `POST /family/invitations`, `PATCH /family/members/:id`, `DELETE /family/members/:id`, `POST /billing/payment-method/setup` and `DELETE /billing/subscription` are reachable with a session that never satisfied AAL2. A stolen or replayed access token can invite a new "owner"-adjacent member and remove the real one, or cancel the subscription, with the MFA gate producing only a log line. The comment documents this as a deliberate pilot posture, so the risk is accepted — but it is accepted *by default*, not by explicit configuration, so an operator who never reads env.ts ships with it off.
- **Fix:** Flip the default to `'enforce'` and let the pilot set `'report'` explicitly, or at minimum add `SENSITIVE_OPERATION_MFA_MODE` to the production checklist and surface the current mode in `/ready`'s `checks` block so it is visible.
- **Confidence:** CONFIRMED

### [MEDIUM] Rate limiting is process-local and therefore ineffective on the serverless deployment target

- **ID:** API-09
- **File:** apps/api/src/rate-limit.ts:25-48, wired at apps/api/src/create-server.ts:117-118
- **What:** `InMemoryRateLimiter` keeps counters in a per-process `Map`, and `apps/api/vercel.json` deploys the API as a serverless function (`rewrites` all traffic to `/api/index`), so each concurrent instance holds an independent window. Entries are also never evicted — the map only prunes the array for a key that is re-consumed.
- **Why it matters:** `POST /support/requests` is the only unauthenticated write in the API and its 5-per-15-minutes-per-IP limit (routes/support-requests.ts:9-10) is its sole abuse control before it spends Resend credit; issuing requests in parallel spreads them across cold instances and the limit effectively disappears. The same applies to the assistant (10/min) and evidence-export (5/min) buckets, which exist to bound cost and data egress. Long-lived instances additionally grow the map without bound, one entry per distinct IP/principal/bucket.
- **Fix:** Back the `RateLimiter` port with a shared store (Vercel KV / Upstash Redis) — the interface was designed for exactly this swap — and, for the in-memory fallback, evict keys whose window has fully elapsed. `/ready` already reports `rateLimiting.support: 'memory'`; treat that as not-ready in production.
- **Confidence:** CONFIRMED

### [MEDIUM] Several collection endpoints are unbounded and unpaginated

- **ID:** API-10
- **File:** apps/api/src/routes/case-contacts.ts:111-126 (timeline), apps/api/src/routes/cases.ts:81-100, apps/api/src/routes/product-differentiation.ts:483-495, apps/api/src/payroll-entry-service.ts:79-88, apps/api/src/leave-entry-service.ts (list), apps/api/src/scenario-expense-service.ts (list), apps/api/src/evidence-export-service.ts:230-252
- **What:** These handlers return the full result set with no `limit`, no cursor and no client-supplied page size; the underlying repositories in `packages/db` contain no `LIMIT` on any list query.
- **Why it matters:** `GET /cases/:caseId/timeline` grows monotonically — every task, document, payroll close, worker request and escalation appends a `timeline_event`. A case in its second year returns thousands of rows in one JSON body on every page load; the evidence export additionally joins the entire `audit_event` history for the case. This is a latency and memory cliff on a serverless function with a fixed response budget, and there is no way for a client to recover once a case crosses it. `binder_export_receipt` (`limit 100`), `document_intake_review` (`limit 100`) and `regulation_rule` (`limit 200`) show the intended pattern.
- **Fix:** Add a bounded default limit plus a keyset cursor (`created_at`/`occurred_at` + id) to the timeline, cases, professional-reviews, payroll, leave and scenario list endpoints, and cap the evidence export's collection window.
- **Confidence:** CONFIRMED

### [MEDIUM] Document intake-review receipt, its audit event and its timeline event are written on three separate connections

- **ID:** API-11
- **File:** apps/api/src/routes/case-documents.ts:219-293
- **What:** The `document_intake_review` row is inserted inside one `withTenant` transaction (line 220), then `container.audit.record(...)` (line 272) and `container.timeline.record(...)` (line 286) each open their own transaction afterwards.
- **Why it matters:** If the audit write fails (connection reset, pool exhaustion, the 42501 class of error), the human confirmation receipt is already committed and the request returns 500 — leaving a durable record of a document-AI review decision with no audit event and no timeline entry, which is precisely the evidence the receipt exists to produce. The same three-connection shape means a partially-evidenced review can never be distinguished from a complete one after the fact.
- **Fix:** Write the review row, the `audit_event` and the `timeline_event` in a single `withTenant` block (the pattern `CanonicalIntelligenceService.close` and `PgBinderExportService.create` already use), and drop the in-memory fallback branch from the audited path.
- **Confidence:** CONFIRMED

### [MEDIUM] The global error handler echoes the raw error message for any error carrying a non-500 status code

- **ID:** API-12
- **File:** apps/api/src/plugins/error-handler.ts:19-21
- **What:** `message: statusCode === 500 ? 'Unable to complete the request' : error.message` — every error that arrives with a `statusCode` other than 500 has its internal message returned verbatim to the client, along with `error.code`.
- **Why it matters:** This is the one place the codebase's own rule ("the message never leaks internals to the client", routes/http-errors.ts:26-28) is not applied. Fastify's own errors already flow through here (`FST_ERR_CTP_BODY_TOO_LARGE`, `FST_ERR_CTP_INVALID_MEDIA_TYPE`), and any future library error or thrown object that happens to carry a `statusCode` — provider SDKs commonly do, and `CardcomGatewayError` messages embed `response.Description` from Cardcom (billing/cardcom-gateway.ts:205-211) — becomes a response body. It is a latent leak that widens silently as dependencies change, and it is inconsistent with every hand-written route in the app.
- **Fix:** Always return `'Unable to complete the request'` and rely on `code` + `correlationId`, matching `sendError`. Keep the full message in the (already `safeErrorDetails`-filtered) log line only.
- **Confidence:** CONFIRMED

### [LOW] Professional-review creation replays a stored row without comparing the request hash

- **ID:** API-13
- **File:** apps/api/src/routes/product-differentiation.ts:536
- **What:** `insert into professional_review_request … on conflict (tenant_id, idempotency_key) do update set idempotency_key=excluded.idempotency_key returning …` returns the pre-existing row for a reused key regardless of whether the new body matches it.
- **Why it matters:** Every other idempotent route in the API rejects a reused key carrying a different payload with `409 IDEMPOTENCY_CONFLICT` (payroll, leave, scenario, binder, regulation, automation receipts). Here a client that reuses a key by accident — e.g. a UUID regenerated per mount rather than per submission — silently receives someone else's earlier escalation, including its `reason`, `summary` and `employmentCaseId`, which may belong to a *different case* in the same tenant (the returning clause is not filtered by `employment_case_id`). The caller believes its new escalation was recorded; it was not.
- **Fix:** Store and compare a `request_hash` as the other services do, returning 409 on mismatch, and constrain the replay lookup to the `:caseId` in the path.
- **Confidence:** CONFIRMED

### [LOW] Development in-memory fallback stores are shared across tenants and filtered only by resource id

- **ID:** API-14
- **File:** apps/api/src/routes/case-documents.ts:180 and 337-342 (also apps/api/src/routes/product-differentiation.ts:135-137, 481, 590)
- **What:** `memoryIntakeReviews`, `memoryReviews`, `memoryTransitions` are module/closure-scoped arrays and maps shared by the whole process; the read paths filter on `documentId`/`caseId`/`reviewId` only, never on `actor.tenantId`.
- **Why it matters:** These branches run whenever `container.pool` is undefined. Today the preceding `listDocuments`/`authorizeCase` call gates on tenant so a cross-tenant read is not reachable, and the branch is not used in production — but the isolation is incidental rather than enforced, so any future reordering or a new read path over the same store leaks across tenants. The `idempotency` map in product-differentiation.ts *is* keyed by tenant, showing the intended discipline.
- **Fix:** Key these stores by `${tenantId}:${id}` and filter reads on the actor's tenant, matching `idempotency`'s `cacheKey`.
- **Confidence:** CONFIRMED

### [LOW] Uploaded content type is client-declared and never verified against the bytes

- **ID:** API-15
- **File:** packages/schemas/src/case-documents.ts:32 and packages/schemas/src/workspace.ts:35, consumed at apps/api/src/storage/supabase-document-storage.ts:39-55
- **What:** `mediaType` is validated against an allow-list but the base64 `content` is never checked for a matching magic number; the declared value is passed straight to Supabase as the stored object's `content-type` and is what the signed URL will later serve.
- **Why it matters:** A caller with `document:create` can store arbitrary bytes labelled `application/pdf` or `image/png`. The API's own CSP and `nosniff` headers (plugins/security-headers.ts) do not cover the Supabase storage origin the signed URL points at, so whatever is served there is served with the attacker-chosen type. The blast radius is limited (the allow-list already excludes SVG, archives and Office macros, and the uploader must already be an authorized tenant member), which is why this is LOW rather than higher.
- **Fix:** Sniff the leading bytes after `decodeBase64` and reject an upload whose magic number does not match the declared `mediaType`, before `putObject` is called.
- **Confidence:** CONFIRMED

### [LOW] Worker invitation accepts a case id and worker id it never validates, and a rejected one reads as 403

- **ID:** API-16
- **File:** apps/api/src/routes/wave5.ts:123-138 and apps/api/src/collaboration/wave5-service.ts:293-339
- **What:** `POST /worker/invitations` takes `caseId` and `workerId` from the request body and inserts them into `worker_portal_access` with the actor's tenant id, with no server-side check that either belongs to that tenant.
- **Why it matters:** Cross-tenant use is blocked only by the composite foreign keys `(tenant_id, employment_case_id)` and `(tenant_id, caregiver_id)` in `database/migrations/0025_wave5_collaboration_engagement.sql:44-47` — the API layer contributes nothing. The FK violation is then caught by the route's bare `catch` and returned as `403 FORBIDDEN`, so a manager who mistypes a case id is told they lack permission. If those FKs are ever relaxed (a `not valid` constraint, a table rewrite), this becomes a live cross-tenant write with no second line of defence.
- **Fix:** Verify both ids inside the same transaction before the insert (`select 1 from employment_case where id=$1` / `caregiver where id=$1`, which RLS already scopes to the tenant) and return 404/422 explicitly.
- **Confidence:** CONFIRMED

## What is done well

- Tenant authority is genuinely server-derived everywhere. `makeAuthenticate` resolves the tenant from the verified session's membership (plugins/authenticate.ts:57-67) and no route reads a tenant id from body, query or header — I checked all 23 route files.
- Cross-tenant probing is consistently reported as an indistinguishable `404` rather than `403`, with the reasoning written down at the call sites (case-contacts.ts:100-102, case-documents.ts:167-169, binder-exports.ts:115).
- Zod validation is applied to the body *and* the path params on every mutating route, with `.strict()` on the payload schemas that matter (payroll, leave, scenario, intake review), so mass assignment is closed off.
- Authentication and authorization both fail closed with no configuration: `MockAuthService` and `InMemoryActorResolver` return `null` for an unseeded token, and `MembershipAuthorizationService` denies with no seeded membership — a production process missing Supabase config 401s rather than opening up.
- Storage object keys are derived server-side from the tenant id plus generated UUIDs (manage-case-documents.ts:120-126), the bucket is private, reads go only through 15-minute signed URLs, and the storage key and checksum are deliberately projected out of every response (case-documents.ts:77-97).
- Log redaction is thoughtful and specific (create-server.ts:36-49), `safeErrorDetails` strips message/stack/cause before anything reaches the log, and denials are emitted as structured `securityEvent` records.
- Cardcom token handling is correct: AES-256-GCM with the provider setup id as AAD, key length validated at construction, and the webhook treated purely as a trigger with independent server-to-server verification.
- `PUT /workspace` has real, required optimistic concurrency (`expectedVersion`) plus an explicit anti-destructive-shrink guard — this is the strongest write path in the API and the model the payroll path should follow.

## Coverage note

Read in full: `apps/api/src/index.ts`, `create-server.ts`, `server.ts`, `container.ts`, `env.ts`, `rate-limit.ts`, `api/index.js`, `vercel.json`, `vitest.config.ts`; all of `src/plugins/*`; all 23 files in `src/routes/` (including `http-errors.ts`); `src/auth/*`; `src/storage/*`; `src/billing/cardcom-gateway.ts`; `src/engagement/resend-email-provider.ts`; `src/automation/automation-receipt-store.ts`; `src/collaboration/wave5-service.ts`; `src/product-intelligence/canonical-intelligence-service.ts`; `src/payroll-entry-service.ts`; and `packages/infrastructure/src/mocks/*` (auth, actor resolver, authorization, invitation, billing gateway).

Read partially / targeted: `src/leave-entry-service.ts`, `src/scenario-expense-service.ts`, `src/regulation-rule-service.ts`, `src/binder-export-service.ts`, `src/evidence-export-service.ts` — I read their transaction helpers, every SQL statement (via grep) and the conflict/version logic, but not every projection helper. Also read out of scope, only to verify or refute specific claims: `packages/db/src/pool.ts`, `packages/db/src/visa-renewal-repository.ts`, `packages/db/src/provision-app-role.ts`, `packages/schemas/src/{case-documents,workspace}.ts`, `packages/application/src/use-cases/manage-{case-documents,workspace-files}.ts`, `packages/config/src/env.ts`, and migrations 0021, 0025, 0032 plus the grant lines of the rest.

Test coverage gaps I can name concretely:
- **No API test exists for any Wave-5 route** (`GET /cases/:id/collaboration`, `PUT /cases/:id/responsibilities/:kind`, `PUT /cases/:id/tasks/:id/assignee`, `POST /worker/invitations`, `POST /worker/activate`, `GET /worker/portal`, `POST /worker/payments/:id/acknowledgements`, `POST /worker/requests`, `PATCH /worker-requests/:id`, `GET /worker/documents/:id/download`, `GET|PUT /worker/preferences`). `registerWave5Routes` returns early when `container.pool` is undefined and no test supplies a pool, so these routes are never even registered during `pnpm test`. The only Wave-5 test asserts that method source strings contain `insert into audit_event`. The worker-portal authorization path — the one place a non-tenant-member identity reaches case data — is entirely untested.
- **No API test for `GET|POST /cases/:caseId/payroll-month-closes`** (`registerCanonicalProductIntelligenceRoutes`), same early-return-without-pool reason. The `manager_required` gate and the amount-reconciliation refine are untested.
- **No test runs any SQL against a real PostgreSQL with the `caredesk_app` role.** Every Postgres-backed route test attaches a hand-written pg stub that "answers the service's own statements" (routes/payroll-entries.test.ts:44-50), so grants, privileges, RLS policies and constraint behaviour are structurally untestable — this is exactly why API-01 and API-02 are invisible today. `pnpm db:rls-test` (packages/db/src/rls-check.ts) does hit a live database but goes through `withTenant`, so it exercises neither the private `tenantTx` helpers nor the `FOR UPDATE` grant.
- No test covers a `viewer` calling `POST /cases/:id/assistant/checklist-confirmations` or `POST /cases/:id/event-plans` (API-05's 500-instead-of-403).
- No test covers a payroll or scenario-expense save that **omits** `version` against an existing row (API-03); the existing tests only assert that a *stale* version is rejected.
- No test covers a partial failure inside the automation commit loop (API-04); the concurrency tests only cover the happy path and the duplicate-claim path.
