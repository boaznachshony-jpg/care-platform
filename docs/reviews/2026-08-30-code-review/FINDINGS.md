# CareDesk — consolidated review findings

Single source of truth for the 30 August 2026 full-stack review. Every finding
from all six reviewer reports, merged and ordered by severity. The per-area
reports in this directory hold the same findings with their reviewer's summary
and coverage notes; this file is the one to work from.

**112 findings — 13 BLOCKER, 38 HIGH, 44 MEDIUM, 17 LOW.**

Severity means one thing only: can customer data be lost, corrupted, or leaked
across tenants. BLOCKER = yes, today.

## Orchestrator adjustments

Severities below are as each reviewer filed them. Two were revised after
independent verification against the code, and the revision wins:

- **DOM-02 → HIGH** (filed BLOCKER). `database/migrations/0028_canonical_payroll_entry.sql:1-2`
  documents the behaviour as deliberate: "this table stores inputs and totals;
  it does not assert that any calculation is legally correct." The real risk is
  internal consistency, not legal correctness.
- **API-01 fix replaced.** The filed fix was correct; an earlier summary that
  suggested granting `UPDATE` was not. Do not grant it —
  `packages/db/src/visa-renewal-migration.test.ts:37` asserts it must never
  exist. Use the claim-first pattern in `packages/db/src/visa-renewal-repository.ts:256-281`.

## Index

| ID                | Sev     | Area        | Finding                                                                                                                                                                         |
| ----------------- | ------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [API-01](#api-01) | BLOCKER | Backend API | Every idempotent mutation issues `SELECT … FOR UPDATE` on a table the app role cannot lock                                                                                      |
| [DOM-01](#dom-01) | BLOCKER | Domain      | A closed payroll month is still fully editable                                                                                                                                  |
| [DOM-02](#dom-02) | BLOCKER | Domain      | The stored salary total is whatever the browser computed — never recalculated server-side                                                                                       |
| [DOM-03](#dom-03) | BLOCKER | Domain      | Quarterly national-insurance deadline uses the host timezone, and an overdue quarter silently vanishes                                                                          |
| [DR-01](#dr-01)   | BLOCKER | Backup/DR   | The restore procedure has never been executed, and the first attempt was an emergency against an expiring backup                                                                |
| [DR-02](#dr-02)   | BLOCKER | Backup/DR   | There is no way to restore one tenant. The only path is a full-project restore plus a manual hand-merge, gated on one person, inside a 7-day window                             |
| [DR-03](#dr-03)   | BLOCKER | Backup/DR   | Nothing detects silent data loss. The customer is the monitor — and this has already happened                                                                                   |
| [REL-01](#rel-01) | BLOCKER | Release     | Three migrations never record themselves; `pnpm db:migrate` is permanently broken on any database that has them                                                                 |
| [REL-02](#rel-02) | BLOCKER | Release     | There is no staging database; "staging" is a banner, and previews are wired to the production API                                                                               |
| [WEB-01](#web-01) | BLOCKER | Frontend    | Monthly payroll close silently does nothing — wrong id space, no error handling, one reused idempotency key                                                                     |
| [WEB-02](#web-02) | BLOCKER | Frontend    | No unsaved-changes guard anywhere; the payroll wizard is never drafted, so one navigation tap destroys a month of entry                                                         |
| [WEB-03](#web-03) | BLOCKER | Frontend    | SettingsPage can overwrite server-hydrated profile fields with stale pre-hydration values                                                                                       |
| [WEB-04](#web-04) | BLOCKER | Frontend    | Canonical payroll draft is wiped whenever a sibling mutation triggers a refetch                                                                                                 |
| [API-02](#api-02) | HIGH    | Backend API | Eight hand-rolled tenant transactions skip the role downgrade that `withTenant` performs                                                                                        |
| [API-03](#api-03) | HIGH    | Backend API | Optimistic concurrency is opt-in on payroll and scenario-expense writes — a client that omits `version` silently overwrites                                                     |
| [API-04](#api-04) | HIGH    | Backend API | Automation commits are not transactional; a failure mid-way releases the receipt and a retry duplicates every task already created                                              |
| [DB-01](#db-01)   | HIGH    | Database    | Eight API persistence paths set the tenant context without `SET LOCAL ROLE caredesk_app`                                                                                        |
| [DB-02](#db-02)   | HIGH    | Database    | Three migrations never record themselves, so the migration runner permanently wedges on the second run                                                                          |
| [DB-03](#db-03)   | HIGH    | Database    | Production can silently run on the in-memory repositories; the fail-closed claim holds only at `/readiness`                                                                     |
| [DB-04](#db-04)   | HIGH    | Database    | `tenant_workspace` still has a DELETE grant, and the 0035 archive trigger only fires on UPDATE                                                                                  |
| [DB-05](#db-05)   | HIGH    | Database    | Migration 0035 permanently archived unencrypted workspace payloads into a table the app can never rewrite                                                                       |
| [DB-06](#db-06)   | HIGH    | Database    | `payroll_entry.total` is client-supplied with no reconciliation constraint                                                                                                      |
| [DOM-04](#dom-04) | HIGH    | Domain      | Currency is floating-point shekels in payroll/forecast, integer agorot in billing, with an EPSILON rounding hack                                                                |
| [DOM-05](#dom-05) | HIGH    | Domain      | The cost forecast double-counts a recurring expense that also carries a due date                                                                                                |
| [DOM-06](#dom-06) | HIGH    | Domain      | Known expenses are silently dropped from any month that has an actual payroll                                                                                                   |
| [DOM-07](#dom-07) | HIGH    | Domain      | Payroll inputs silently coerce negatives and NaN to zero, and the net is clamped at zero                                                                                        |
| [DOM-08](#dom-08) | HIGH    | Domain      | Document compliance status is computed once at upload and never recomputed                                                                                                      |
| [DOM-09](#dom-09) | HIGH    | Domain      | A partially-discounted subscription is displayed with a price and then never charged at all                                                                                     |
| [DOM-10](#dom-10) | HIGH    | Domain      | There is no employment-case state machine, and the one state machine that exists is dead code                                                                                   |
| [DOM-11](#dom-11) | HIGH    | Domain      | Leave-ledger day counts are unconstrained by their own date range, and a cancelled entry can be un-cancelled                                                                    |
| [DOM-12](#dom-12) | HIGH    | Domain      | Payroll, leave and month-close authorization bypasses the audited `authorizeOrThrow` path                                                                                       |
| [DR-04](#dr-04)   | HIGH    | Backup/DR   | PITR is not enabled; the entire recovery envelope is seven daily snapshots                                                                                                      |
| [DR-05](#dr-05)   | HIGH    | Backup/DR   | Migration 0035 is the right idea, but it covers only the legacy blob, no code reads it, and it may not be applied to production                                                 |
| [DR-06](#dr-06)   | HIGH    | Backup/DR   | Canonical tables have hard deletes and no version history; there are no soft deletes anywhere                                                                                   |
| [DR-07](#dr-07)   | HIGH    | Backup/DR   | The off-site database backup and Storage copy are manual; there is no automation and no named owner                                                                             |
| [DR-08](#dr-08)   | HIGH    | Backup/DR   | Staging and production may still share one Supabase project                                                                                                                     |
| [DR-09](#dr-09)   | HIGH    | Backup/DR   | Database rows and storage objects will drift after any restore, and no reconciliation job exists                                                                                |
| [DR-10](#dr-10)   | HIGH    | Backup/DR   | Erasure obligations conflict with immutable copies that have no purge process                                                                                                   |
| [REL-03](#rel-03) | HIGH    | Release     | The migration runner has no concurrency lock, no environment guard, and no dry-run                                                                                              |
| [REL-04](#rel-04) | HIGH    | Release     | Migration 0030 is a breaking change that makes a code rollback fail with constraint violations                                                                                  |
| [REL-05](#rel-05) | HIGH    | Release     | The `/ready` deployment gate is blind to every migration after 0021                                                                                                             |
| [REL-06](#rel-06) | HIGH    | Release     | The migration safety scanner has four exploitable blind spots                                                                                                                   |
| [WEB-05](#web-05) | HIGH    | Frontend    | A transient or expired session unmounts the whole app tree and destroys in-progress form state                                                                                  |
| [WEB-06](#web-06) | HIGH    | Frontend    | No error boundary anywhere, and every localStorage write is unguarded                                                                                                           |
| [WEB-07](#web-07) | HIGH    | Frontend    | Fire-and-forget mutations: a failed save shows the user nothing at all                                                                                                          |
| [WEB-08](#web-08) | HIGH    | Frontend    | Document save has no double-submit guard — one impatient double-tap creates two documents and two uploads                                                                       |
| [WEB-09](#web-09) | HIGH    | Frontend    | A failed refetch is reported as a failed save, and none of these POSTs are idempotent — retrying creates duplicates                                                             |
| [WEB-10](#web-10) | HIGH    | Frontend    | Sign-out can fail silently, leaving the user signed in and their PII cache on a shared device                                                                                   |
| [WEB-11](#web-11) | HIGH    | Frontend    | The canonical case module is unreachable: no route creates a case, so the case, binder and visa screens are dead ends                                                           |
| [WEB-12](#web-12) | HIGH    | Frontend    | Visa renewal is implemented twice, inconsistently, and its only workflow screen demands raw UUIDs with no way to advance a workflow                                             |
| [WEB-13](#web-13) | HIGH    | Frontend    | The collaboration screen is hardcoded English with raw snake_case labels in a Hebrew RTL product                                                                                |
| [API-05](#api-05) | MEDIUM  | Backend API | Authorization denials inside automation handlers surface as 500 and are never logged as security events                                                                         |
| [API-06](#api-06) | MEDIUM  | Backend API | Wave-5 routes swallow every error into a fixed status code, masking both authorization denials and outages                                                                      |
| [API-07](#api-07) | MEDIUM  | Backend API | Every production hardening rule is keyed on `NODE_ENV === 'production'`, and nothing asserts it is set                                                                          |
| [API-08](#api-08) | MEDIUM  | Backend API | MFA on billing and membership management defaults to log-only in production                                                                                                     |
| [API-09](#api-09) | MEDIUM  | Backend API | Rate limiting is process-local and therefore ineffective on the serverless deployment target                                                                                    |
| [API-10](#api-10) | MEDIUM  | Backend API | Several collection endpoints are unbounded and unpaginated                                                                                                                      |
| [API-11](#api-11) | MEDIUM  | Backend API | Document intake-review receipt, its audit event and its timeline event are written on three separate connections                                                                |
| [API-12](#api-12) | MEDIUM  | Backend API | The global error handler echoes the raw error message for any error carrying a non-500 status code                                                                              |
| [DB-07](#db-07)   | MEDIUM  | Database    | Migration 0030 adds a validated CHECK with no `NOT VALID`, so it fails on any database with an existing resolved review                                                         |
| [DB-08](#db-08)   | MEDIUM  | Database    | `idempotency_record` stores full API response bodies forever with no expiry and no purge path                                                                                   |
| [DB-09](#db-09)   | MEDIUM  | Database    | The live RLS guard does not cover five of the tables it is supposed to protect                                                                                                  |
| [DB-10](#db-10)   | MEDIUM  | Database    | Actor columns (`created_by`, `updated_by`, `closed_by`, `linked_by`, `recorded_by`, `confirmed_by`, `changed_by`) carry no foreign key anywhere in the schema                   |
| [DB-11](#db-11)   | MEDIUM  | Database    | `document.owner_id` is a polymorphic reference with no foreign key and no constraint tying it to `owner_type`                                                                   |
| [DB-12](#db-12)   | MEDIUM  | Database    | No index on `worker_portal_access.user_id`, which is the worker-portal authentication hot path                                                                                  |
| [DB-13](#db-13)   | MEDIUM  | Database    | Six reference tables were created after 0015's lockdown; the `anon`/`authenticated` revoke may not have applied to them                                                         |
| [DB-14](#db-14)   | MEDIUM  | Database    | Migration 0032 satisfies its own "review evidence" constraint with a placeholder                                                                                                |
| [DB-15](#db-15)   | MEDIUM  | Database    | The in-memory fallback enforces none of the database's protective constraints, so tests cannot catch violations of them                                                         |
| [DB-16](#db-16)   | MEDIUM  | Database    | There is no implemented erasure or anonymisation path for a tenant                                                                                                              |
| [DOM-13](#dom-13) | MEDIUM  | Domain      | `packages/schemas` is the shared contract for the early endpoints only — every money and leave endpoint defines its own                                                         |
| [DOM-14](#dom-14) | MEDIUM  | Domain      | Monthly-close reconciliation tolerance is looser than the DB constraint it feeds                                                                                                |
| [DOM-15](#dom-15) | MEDIUM  | Domain      | Infrastructure failures during visa-renewal completion are reported as a validation error                                                                                       |
| [DOM-16](#dom-16) | MEDIUM  | Domain      | Monthly billing date drifts permanently after any month shorter than the anchor day                                                                                             |
| [DOM-17](#dom-17) | MEDIUM  | Domain      | A calendar-day expiry stored at UTC midnight reads as expired for the whole of its final valid day                                                                              |
| [DOM-18](#dom-18) | MEDIUM  | Domain      | Governed rule selection picks the highest version string, not the rule effective at the as-of date                                                                              |
| [DOM-19](#dom-19) | MEDIUM  | Domain      | Idempotency state for outbound notifications lives in a process-local Map                                                                                                       |
| [DOM-20](#dom-20) | MEDIUM  | Domain      | Partial-month proration hardcodes Saturday as the rest day and an undocumented divisor                                                                                          |
| [DR-11](#dr-11)   | MEDIUM  | Backup/DR   | The "binder export" is a receipt plus a browser print — it is not a data export and not a recovery path                                                                         |
| [DR-12](#dr-12)   | MEDIUM  | Backup/DR   | The document mirror is undocumented in DEPLOYMENT.md, has no backfill, and no completeness check                                                                                |
| [DR-13](#dr-13)   | MEDIUM  | Backup/DR   | WORKSPACE_ENCRYPTION_KEY is a single point of unrecoverable loss for live data, history and every backup                                                                        |
| [DR-14](#dr-14)   | MEDIUM  | Backup/DR   | RTO/RPO are stated but never measured, and the audit trail shares the database's fate with no retention policy                                                                  |
| [REL-07](#rel-07) | MEDIUM  | Release     | Indexes and constraints are added to live tables without `CONCURRENTLY`/`NOT VALID`, and no lock timeout bounds the damage                                                      |
| [REL-08](#rel-08) | MEDIUM  | Release     | Two migrations share the number 0026 and nothing enforces uniqueness                                                                                                            |
| [REL-09](#rel-09) | MEDIUM  | Release     | No down migrations, and three migrations perform irreversible bulk writes to customer tenants                                                                                   |
| [REL-10](#rel-10) | MEDIUM  | Release     | `pnpm db:rls-test` writes to, and deletes from, production tables with a BYPASSRLS connection and no environment guard                                                          |
| [REL-11](#rel-11) | MEDIUM  | Release     | Web and API deploy independently with no version negotiation or contract check                                                                                                  |
| [REL-12](#rel-12) | MEDIUM  | Release     | No feature flags: every change is live for every customer at merge                                                                                                              |
| [WEB-14](#web-14) | MEDIUM  | Frontend    | Infinite loading states and unhandled rejections on data load                                                                                                                   |
| [WEB-15](#web-15) | MEDIUM  | Frontend    | Onboarding claims "saved" unconditionally, and a stale draft can overwrite newer profile edits                                                                                  |
| [WEB-16](#web-16) | MEDIUM  | Frontend    | Action failures are reported as load failures and replace the form region                                                                                                       |
| [WEB-17](#web-17) | MEDIUM  | Frontend    | Deleting a client leaves uploaded identity documents behind, and the "backup" export is unencrypted plaintext PII                                                               |
| [WEB-18](#web-18) | MEDIUM  | Frontend    | The device cache key lives in sessionStorage while the data lives in localStorage — in local-only mode that is permanent loss                                                   |
| [WEB-19](#web-19) | MEDIUM  | Frontend    | Legacy plaintext values are read back forever and never re-encrypted                                                                                                            |
| [WEB-20](#web-20) | MEDIUM  | Frontend    | API base URL falls back to `:4000` on the page's own host, and no security headers are set                                                                                      |
| [WEB-21](#web-21) | MEDIUM  | Frontend    | i18n is bypassed on almost every business screen, and the English locale is unreachable                                                                                         |
| [API-13](#api-13) | LOW     | Backend API | Professional-review creation replays a stored row without comparing the request hash                                                                                            |
| [API-14](#api-14) | LOW     | Backend API | Development in-memory fallback stores are shared across tenants and filtered only by resource id                                                                                |
| [API-15](#api-15) | LOW     | Backend API | Uploaded content type is client-declared and never verified against the bytes                                                                                                   |
| [API-16](#api-16) | LOW     | Backend API | Worker invitation accepts a case id and worker id it never validates, and a rejected one reads as 403                                                                           |
| [DB-17](#db-17)   | LOW     | Database    | Two migrations share the `0026` prefix                                                                                                                                          |
| [DB-18](#db-18)   | LOW     | Database    | Inconsistent handling of an empty `app.tenant_id`: `::uuid` vs `nullif(…, '')::uuid`                                                                                            |
| [DB-19](#db-19)   | LOW     | Database    | `document_intake_review.confirmed_fields`, `event_action_plan.answers` and `automation_execution_receipt.response` are unconstrained jsonb with a comment-only privacy contract |
| [DB-20](#db-20)   | LOW     | Database    | `PgWorkspaceFileRepository.delete` drops the only record of a private storage key                                                                                               |
| [DOM-21](#dom-21) | LOW     | Domain      | Domain failures are returned as `null`, conflating distinct outcomes                                                                                                            |
| [DOM-22](#dom-22) | LOW     | Domain      | Non-deterministic `new Date()` defaults in otherwise pure functions                                                                                                             |
| [DOM-23](#dom-23) | LOW     | Domain      | `eligibleChannels` uses a single-argument comparator                                                                                                                            |
| [DOM-24](#dom-24) | LOW     | Domain      | A zero-total payroll month can be recorded but can never be closed                                                                                                              |
| [REL-13](#rel-13) | LOW     | Release     | Applied-migration immutability is measured against `main`, not against what production actually ran                                                                             |
| [REL-14](#rel-14) | LOW     | Release     | The migration connection disables TLS certificate verification                                                                                                                  |
| [REL-15](#rel-15) | LOW     | Release     | No release artifact ties a deployed build to the schema version it requires                                                                                                     |
| [WEB-22](#web-22) | LOW     | Frontend    | A regulation-rule admin console is rendered inside consumer Settings                                                                                                            |
| [WEB-23](#web-23) | LOW     | Frontend    | `canonicalVersion` optimistic-lock field is declared and documented but never written or read                                                                                   |

## Findings

### API-01

**[BLOCKER] Every idempotent mutation issues `SELECT … FOR UPDATE` on a table the app role cannot lock**

_Area: Backend API · source: [`01-backend-api.md`](01-backend-api.md)_

- **ID:** API-01
- **File:** apps/api/src/payroll-entry-service.ts:105 (plus apps/api/src/leave-entry-service.ts:64, apps/api/src/scenario-expense-service.ts:60, apps/api/src/binder-export-service.ts:208, apps/api/src/regulation-rule-service.ts:369, apps/api/src/product-intelligence/canonical-intelligence-service.ts:104, apps/api/src/collaboration/wave5-service.ts:71)
- **What:** Seven services read the replay receipt with `select request_hash, response from idempotency_record … for update`, but `database/migrations/0021_visa_renewal_persistence.sql:275` grants only `select, insert on idempotency_record to caredesk_app` — PostgreSQL requires the `UPDATE` privilege for `SELECT … FOR UPDATE`, so the statement is rejected outright.
- **Why it matters:** With `DATABASE_URL` pointing at the documented least-privilege `caredesk_app` login (DEPLOYMENT.md:37, .env.example:18-25), the _first_ call — not just a concurrent one — fails: `PUT /cases/:id/payroll-entries/:month`, `POST|PUT /cases/:id/leave-entries`, `POST|PUT|DELETE /cases/:id/scenario-expenses`, `POST /cases/:id/binder-exports`, `POST|PATCH /regulation-rules`, `POST /cases/:id/payroll-month-closes` and every Wave-5 mutation raise SQLSTATE 42501 (`permission denied for table idempotency_record`), the transaction rolls back, and the customer sees `500 INTERNAL_ERROR` — or, on the Wave-5 routes, a misleading `403`/`409` (see API-06). No payroll month, leave day, scenario expense, binder-export receipt or regulation-rule change can ever be saved. `packages/db/src/visa-renewal-migration.test.ts:37` actively asserts `expect(sql).not.toMatch(/grant[^;]*update[^;]*idempotency_record/i)`, so the two halves of the codebase encode directly contradictory intents and neither side's tests can detect it.
- **Fix:** Replace the lock-based read with the pattern `PgIdempotencyRepository` already uses (`packages/db/src/visa-renewal-repository.ts:256-281`): a plain `select` followed by `insert … on conflict do nothing`, letting the primary key `(tenant_id, operation, idempotency_key)` serialise concurrent duplicates. Keep the `select, insert`-only grant (append-only receipts is the right call) and add an integration test that runs one mutation as `caredesk_app` against a real database.
- **Confidence:** CONFIRMED

---

### DOM-01

**[BLOCKER] A closed payroll month is still fully editable**

_Area: Domain · source: [`06-domain-logic.md`](06-domain-logic.md)_

- **ID:** DOM-01
- **File:** apps/api/src/payroll-entry-service.ts:97-149 (write path); database/migrations/0028_canonical_payroll_entry.sql:43 (`grant select, insert, update`); apps/web/src/storage/mvp-storage.ts:703 (`saveMvpPayroll`)
- **What:** `payroll_month_close` is correctly append-only (`grant select, insert` only, migration
  0023:39, with a `unique (tenant_id, employment_case_id, payroll_month)` so a month cannot be closed
  twice). But the _underlying facts_ are not frozen with it. `PayrollEntryService.save` does an
  `on conflict … do update` on `payroll_entry` with **no reference to `payroll_month_close`
  anywhere** — I grepped the write path, the route, the migrations and the triggers; there is no
  guard and no trigger. The `status='final'` flag on `payroll_entry` is also not enforced: a `final`
  row can be updated back to `draft`. The browser store is worse — `PayrollPage.tsx` never calls
  `readMvpMonthlyCloses()` at all, so the form has no idea a month is closed.
- **Why it matters:** July is closed on 5 August with `total_amount = 6,200`, producing an immutable
  receipt, a timeline event and an audit event. On 20 August a manager opens July and corrects a
  typo to 5,000. The entry now says 5,000; the close receipt still says 6,200; nothing reconciles
  them and nothing flags the divergence. Every downstream consumer disagrees:
  `projectFutureCost` uses the close (6,200), the payroll list shows 5,000, and the binder export
  can carry either. For a product whose value proposition is defensible evidence of what was paid to
  a foreign worker, two contradictory canonical numbers with no correction record is the worst
  possible outcome.
- **Fix:** In `PayrollEntryService.save`, inside the existing transaction, `select 1 from
payroll_month_close where employment_case_id=$1 and payroll_month=($2||'-01')::date` and reject
  with a typed `PayrollMonthClosedError` when present. Back it with a DB trigger so no future write
  path can bypass it. Define the correction path explicitly (a new versioned entry + a correction
  receipt), since "reopening is deliberately unsupported" (0023:37-38) currently means "silently
  supported by editing the source".
- **Confidence:** CONFIRMED

---

### DOM-02

**[BLOCKER] The stored salary total is whatever the browser computed — never recalculated server-side**

_Area: Domain · source: [`06-domain-logic.md`](06-domain-logic.md)_

- **ID:** DOM-02
- **File:** apps/api/src/payroll-entry-service.ts:143 (`input.total` written verbatim); apps/api/src/routes/payroll-entries.ts:39 (`total: z.number().finite().min(-10_000_000).max(10_000_000)`); apps/web/src/payroll-calculation.ts:98-119 (the only implementation of the calculation)
- **What:** The single monthly-payroll calculation in the product lives in the browser bundle.
  The API accepts `baseSalary`, all the addition/deduction components **and** `total` as
  independent numbers, and persists `total` without ever recomputing it. `payroll_entry` has
  per-column range checks but **no** reconciliation constraint (contrast `payroll_month_close`,
  which does have `payroll_month_close_amount_reconciles`, migration 0026:8). So the server has no
  opinion about whether the total matches its own components.
- **Why it matters:** Send `baseSalary: 6000, advances: 5000, total: 6000` and the canonical payroll
  record, the audit event and the evidence binder all say ₪6,000 was owed while the components say
  ₪1,000. No validation catches it. This is not only a tampering surface: any bug or refactor in
  the client calculation writes wrong money into the record of account, and because the calculation
  is client-side it is versioned with the browser bundle rather than with the data. A regulated
  audit trail cannot be reconstructed from inputs the server never verified.
- **Fix:** Move `calculateMonthlyPayroll` into `packages/domain` (pure, no IO), have the API compute
  the total from the submitted components and either reject a mismatched client `total` or stop
  accepting it at all. Add a DB check constraint mirroring the close table's. The client then calls
  the same shared function, so the two can never diverge.
- **Confidence:** CONFIRMED

---

### DOM-03

**[BLOCKER] Quarterly national-insurance deadline uses the host timezone, and an overdue quarter silently vanishes**

_Area: Domain · source: [`06-domain-logic.md`](06-domain-logic.md)_

- **ID:** DOM-03
- **File:** apps/web/src/quarterly-national-insurance.ts:67-82,122-145
- **What:** Two defects in the only encoded legal deadline in the product.
  (a) `createQuarterlyInsuranceTask(today = new Date())` defaults to wall-clock time and
  `localIso()` reads `getFullYear/getMonth/getDate` — **host local timezone**, not Asia/Jerusalem.
  (b) `relevantQuarter()` returns the previous quarter only during the first month of a quarter
  (`month % 3 === 0`). From the 1st of the second month it switches to the _current_, not-yet-ended
  quarter, whose `paymentOpenDate` is in the future → status `not_open`.
- **Why it matters:** (a) On a UTC host (or a family member abroad), at 00:30 Israel time on
  16 April the computed `currentDate` is still `2026-04-15`, so a payment that is now legally late
  is reported as `due_today`. In the other direction a browser at UTC-5 reports `due_today` on
  15 April local while it is already the 16th in Israel. Israel is UTC+2/+3, so this is a
  systematic 2–3 hour window of a wrong legal status every single day, on a deadline that carries
  interest and penalties. (b) Worse: a family that misses the Q4 deadline (15 January) sees
  `overdue` for the rest of January, and then on **1 February the item disappears entirely** —
  the function switches to Q1, which is `not_open`. The one unpaid quarter is the one the product
  stops showing.
- **Fix:** Pass an explicitly Israel-local "today" (format the instant in `Asia/Jerusalem`, e.g. via
  `Intl.DateTimeFormat` with that timeZone) and remove the `new Date()` default so the function is
  pure and testable. Return **all** quarters whose deadline has passed without a recorded payment,
  not just the one derived from the current month. Move the whole thing into `packages/rules` as a
  `GovernedRule` with `effectiveFrom` (see the rule-versioning section).
- **Confidence:** CONFIRMED

---

### DR-01

**[BLOCKER] The restore procedure has never been executed, and the first attempt was an emergency against an expiring backup**

_Area: Backup/DR · source: [`04-backup-dr.md`](04-backup-dr.md)_

- **ID:** DR-01
- **File:** `docs/operations/production-release-and-recovery.md:15-18`, `:31-32`, `:115-129`; `PILOT_RELEASE.md:13`; `docs/governance/WORK-PLAN-2026-08-29.md:22-36`
- **What:** The policy requires "a documented restore drill to a disposable project before
  the first pilot customer and at least quarterly after launch" (`:31-32`) and states in
  present tense that "a restore must be exercised successfully before the first external
  customer" (`:17-18`). `PILOT_RELEASE.md:13` carries the same item as an unchecked gate.
  **No drill record exists anywhere in the repository** — no dated log, no signed record,
  no checksums file, no CI job, no script. The drill acceptance criteria at `:115-129`
  are well written (schema history matches, tenant/employment/payroll/task/document row
  counts match, sign-in isolation, private document downloads, payroll totals reconcile,
  `/health` and `/ready` green) but they have never been run.
  The only evidence of an actual restore is `docs/governance/WORK-PLAN-2026-08-29.md:22-36`,
  which plans a `Restore to new project` from the 2026-08-22 backup as step 1.1 of an
  urgent work plan, notes the window closes "tomorrow" because retention is 7 rolling
  days, and explicitly contemplates that the backup may itself be empty
  (`:36` — "if 1.2 finds 22.8 is also empty, the data was overwritten before that and
  there is nothing to restore").
- **Why it matters:** Concrete scenario: a bad migration or a bad deploy corrupts
  production on a Friday evening. Nobody has ever restored this system. The operator does
  not know whether `caredesk_app` role provisioning survives a restore, whether the
  Supavisor pooler username changes on a new project ref (it does — `database/README.md:48`),
  whether `WORKSPACE_ENCRYPTION_KEY` still decrypts the restored payloads, or how long any
  of it takes. The stated RTO of 4 hours is a guess. In a real incident the team discovers
  all of this under time pressure while customers are locked out — which is exactly the
  situation `WORK-PLAN-2026-08-29.md` documents.
- **Fix:**
  1. Run the drill **now**, against synthetic data, before any real PII exists. Follow the
     acceptance criteria already written at `:115-129`.
  2. Commit the drill record (date, source backup identifier, target project ref, results,
     measured wall-clock RTO, cleanup confirmation) to `docs/operations/`. A drill that is
     not recorded did not happen.
  3. Add the _restore_ commands to the runbook. The document currently gives commands for
     the backup direction only (`:47-57`); the restore direction is described in prose.
  4. Make the drill a dated, recurring calendar obligation with a named owner, and make a
     stale drill a hard release gate rather than a checklist line.
- **Confidence:** CONFIRMED

---

---

### DR-02

**[BLOCKER] There is no way to restore one tenant. The only path is a full-project restore plus a manual hand-merge, gated on one person, inside a 7-day window**

_Area: Backup/DR · source: [`04-backup-dr.md`](04-backup-dr.md)_

- **ID:** DR-02
- **File:** NOT FOUND IN REPO as a capability. Ad-hoc path documented once at
  `docs/governance/WORK-PLAN-2026-08-29.md:28-33`
- **What:** Nothing in the codebase can restore a single tenant. There is no admin route
  (`apps/api/src/routes/` contains no restore/recovery/admin route), no CLI command
  (`package.json` scripts are migrate, provision-app-role, provision-pilot-account,
  activate-subscription, rls-test, migration-safety — nothing restorative), and no
  documented procedure in `docs/operations/`.
  The improvised path actually used is:
  1. `Restore to new project` from a daily backup — "the action requires owner approval"
     (`WORK-PLAN-2026-08-29.md:28`), i.e. one human being with Supabase owner rights;
  2. query the disposable project's `tenant_workspace` to see whether it holds real data (`:29`);
  3. extract and decrypt the payload and diff it against production (`:30`) — which
     requires possession of `WORKSPACE_ENCRYPTION_KEY`;
  4. "surgical restoration — only the missing keys, without touching the rest"
     (`:31`), by hand, after per-key approval;
  5. delete the temporary project (`:32`).
     The one genuinely good property here: because it goes via a _separate_ project, it does
     **not** clobber other tenants. Single-tenant restore is therefore _possible_ — but only
     as an unrehearsed, undocumented, owner-gated manual operation bounded by the 7-day
     retention window, requiring SQL skill and the encryption key, with no verification step.
- **Why it matters:** This is the most likely disaster by a wide margin. A user deletes the
  wrong client; a family member with manager role clears a case; a bad deploy writes
  garbage into one workspace. Full-database restore is not an option — it would roll every
  other paying customer back by up to 24 hours, which is itself a data-loss incident.
  So in practice the operator will attempt the hand-merge under pressure, and the failure
  modes are: the backup is older than the corruption (7-day ceiling), the diff is done by
  eye and misses records, or the merge writes an inconsistent state that then propagates
  into `tenant_workspace_history` as if it were legitimate. There is no verification
  afterwards because there is no reconciliation job (DR-08).
- **Fix:**
  1. Write and test a `pnpm dr:restore-tenant` script: takes a source dump plus a tenant id,
     restores that tenant's rows into a staging schema, diffs against live, and requires an
     explicit confirmation before writing. Exercise it in the DR-01 drill.
  2. Build the read side of `tenant_workspace_history` (DR-05) — for the legacy blob this
     turns single-tenant recovery from a multi-hour project restore into a single query.
  3. Extend the same versioning idea to the canonical tables (DR-06), so the in-database
     undo covers what the product is actually migrating toward.
  4. Do not leave the recovery path gated on one individual's Supabase owner credential
     with no documented break-glass alternative.
- **Confidence:** CONFIRMED

---

---

### DR-03

**[BLOCKER] Nothing detects silent data loss. The customer is the monitor — and this has already happened**

_Area: Backup/DR · source: [`04-backup-dr.md`](04-backup-dr.md)_

- **ID:** DR-03
- **File:** not found (no monitoring/alerting anywhere in repo). Related:
  `apps/api/src/container.ts:610-655`; `PILOT_RELEASE.md:52`;
  `packages/application/src/ports/workspace-shrink-guard.test.ts:4-17`
- **What:** There is no monitoring, alerting, row-count check, drift check, or integrity
  job anywhere in the repository. A grep for Sentry/Datadog/PagerDuty/alerting across
  `apps/`, `packages/` and `.github/` returns only two source comments observing that a
  lost audit record "is a monitoring problem" (`packages/application/src/use-cases/authorize.ts:75`)
  — with no monitoring behind them.
  `/ready` (`apps/api/src/container.ts:631-650`) issues a single query asserting that six
  schema objects exist (`resolve_caredesk_actor`, `tenant_workspace`, `workspace_file`,
  `list_caredesk_family_members`, `product_subscription`, `workflow_instance`). It reports
  green against a database in which every one of those tables has been emptied.
  `PILOT_RELEASE.md:52` is the entire detection strategy: "Review `/ready`, failed logins,
  storage errors and failed CI daily during the pilot" — a human, once a day, reading
  signals that cannot reveal an emptied tenant.
  The counterfactual is not needed. The incident described in
  `packages/application/src/ports/workspace-shrink-guard.test.ts:4-17` — "a perfectly
  well-formed save request that replaced a populated account with a set of blank values,
  and the optimistic version check waved it through" — was discovered by a person noticing
  a named customer's case was not on the screen (`WORK-PLAN-2026-08-29.md:34`).
- **Why it matters:** Detection latency directly multiplies every other weakness. Backup
  retention is 7 rolling days; PITR is off. If loss is not noticed within 7 days it is
  permanent regardless of how good the restore procedure is. The stated RPO of ≤24 hours
  is meaningless if the mean time to detection is measured in days. For regulated
  employment and identity data — passport scans, visa authorizations, payroll — a customer
  discovering the loss themselves is also a reportable security-incident trigger under the
  process `PILOT_RELEASE.md:47` requires but which does not yet exist.
- **Fix:**
  1. Cheapest high-value control first: a daily job that records per-tenant row counts for
     `tenant_workspace` (populated entries), `workspace_file`, `document`, `employment_case`,
     `task`, `payroll_entry`, and alerts on any tenant whose count drops by more than a
     small threshold. This is a few dozen lines and would have caught the incident.
  2. Alert on `WORKSPACE_SHRINK_REJECTED` (`packages/application/src/ports/workspace-repository.ts:16`).
     Today the guard correctly refuses the write — and nobody is told a customer's client
     just tried to erase their account.
  3. Extend `/ready` or add a separate `/internal/integrity` to assert non-emptiness of
     core tables for provisioned tenants, not merely their existence.
  4. Add uptime and error monitoring with a real alert destination before real PII lands.
- **Confidence:** CONFIRMED

---

---

### REL-01

**[BLOCKER] Three migrations never record themselves; `pnpm db:migrate` is permanently broken on any database that has them**

_Area: Release · source: [`05-release-safety.md`](05-release-safety.md)_

- **ID:** REL-01
- **File:** `packages/db/src/migrate.ts:11-48` (runner); `database/migrations/0024_wave4_automation.sql` (no `schema_migrations` insert, EOF at line ~55); `database/migrations/0027_product_differentiation_completion.sql` (same); `database/migrations/0030_human_escalation_lifecycle.sql:72` (ends at the `grant`, no insert)
- **What:** The runner does not write the ledger. It creates the table (`:12-14`), reads it (`:16-20`), and relies on every SQL file to insert its own version — documented as the design at `:8-9` ("the SQL files end with an insert into schema_migrations, so re-running is a no-op"). 33 of 36 files comply. `0024`, `0027`, and `0030` do not. Verified: `grep -ci 'insert into schema_migrations'` returns 0 for all three, and no variant spelling exists (`grep -in 'schema_migrations'` on those three files returns nothing).
- **Why it matters:** Concrete sequence. Production is at `0035`. Someone adds `0036` and runs `pnpm db:migrate`. The runner sees `0024` absent from the ledger, executes it, and hits `create table document_intake_review` at `0024_wave4_automation.sql:3` — a bare `create table` with no `if not exists`. Postgres raises `42P07 duplicate_table`. The transaction rolls back correctly (no damage), the runner throws (`migrate.ts:42`), and **the loop stops there** — `0025` through `0036` are never attempted. `0036` cannot be applied. The API build that needs it is already on Vercel. The operator, under release pressure, now hand-writes `insert into schema_migrations` against the production database — the precise manoeuvre that `0017_restore_missing_pilot_workspace.sql:56-61` exists to clean up after the last time, and the one where transposing a version number silently skips a real migration. The README advertises the opposite: `README.md:71` and `database/README.md:66` both say `pnpm db:migrate # apply pending migrations (idempotent)`, and `database/README.md:82` claims "each recording its own version in `schema_migrations`".
- **Why CI cannot see it:** `ci.yml:128-162` migrates a _fresh_ Postgres container. `grep -rn "runMigrations"` shows three call sites and none of them runs the migrator twice. No test asserts that a migration file self-records. The failure is invisible until it happens on the one database that matters.
- **Fix:** (1) Move ledger insertion into the runner — `await client.query('insert into schema_migrations (version) values ($1)', [version])` between `migrate.ts:37` and `:38`, inside the same transaction, and make it `on conflict do nothing` so the 33 self-recording files stay valid. (2) Add a CI assertion that every `database/migrations/*.sql` either self-records or that the runner covers it. (3) Add a CI step that runs `runMigrations` **twice** against the same container and asserts the second call returns `[]`. (4) Before the next release, reconcile the production ledger deliberately: confirm `document_intake_review`, `event_action_plan`, `professional_review_request`, `ai_action_confirmation`, `professional_review_transition` all exist and match the committed DDL, then insert the three missing versions in one reviewed transaction with a backup taken first.
- **Confidence:** CONFIRMED

---

### REL-02

**[BLOCKER] There is no staging database; "staging" is a banner, and previews are wired to the production API**

_Area: Release · source: [`05-release-safety.md`](05-release-safety.md)_

- **ID:** REL-02
- **File:** `docs/operations/production-release-and-recovery.md:15-22`; `apps/web/src/environment.ts:6-10`; `apps/web/vercel.json:8`; `DEPLOYMENT.md:5-9,20-27`
- **What:** `DEPLOYMENT.md:5` describes `staging` as a branch that "produces a Vercel Preview deployment" — of the same two Vercel projects, not a separate stack. `apps/web/src/environment.ts:9` classifies any `*.vercel.app` hostname as "staging" purely to show a purple banner; nothing about the backend changes. `apps/web/vercel.json:8` rewrites `/api/:path*` to the hardcoded literal `https://care-platform-api.vercel.app` on **every** deployment, previews included. `DEPLOYMENT.md:20-27` lists a single set of web variables and states "Both authentication variables are required in Preview and Production", pointing preview builds at the same Supabase project. `.env.example` has no `VERCEL_ENV` branch and no staging/production split anywhere in its 129 lines. The team's own runbook says it outright: "Staging and production still need separate Supabase projects" and "Staging must never use the production database or private Storage bucket" (`:17-18`, `:22-23`) — written as an open launch blocker, not a solved one.
- **Why it matters:** Every "staging rehearsal" described in `PILOT_RELEASE.md` and `DEPLOYMENT.md` is executed against live customer data. A preview deployment of an in-progress branch — with a half-finished write path, a bad migration assumption, or a loop that re-saves workspaces — mutates production rows. Because `PILOT_RELEASE.md:60` gates promotion on "the same commit passes every gate above", the team is systematically encouraged to exercise unmerged code against production. This is the classic catastrophic mistake and it is currently the documented process, not an accident waiting to happen.
- **Fix:** Create a second Supabase project. Scope `DATABASE_URL`, `SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_STORAGE_BUCKET` per Vercel environment (Production / Preview / Development are separate scopes in the Vercel dashboard — verify none of them is currently set to "All Environments"). Replace the hardcoded host in `apps/web/vercel.json:8` with a per-environment value, or delete the rewrite (nothing in `apps/web/src` fetches `/api/*` — the client uses `API_BASE_URL` from `apps/web/src/api/client.ts:47` — so it is currently dead config aimed at production). Add a boot assertion in `apps/api` that refuses to start when `VERCEL_ENV !== 'production'` and the connection string points at the production project ref.
- **Confidence:** CONFIRMED (repo evidence). The exact Vercel per-environment variable scoping is dashboard state — NEEDS-VERIFICATION for that one detail, but the runbook's own statement settles the substance.

---

### WEB-01

**[BLOCKER] Monthly payroll close silently does nothing — wrong id space, no error handling, one reused idempotency key**

_Area: Frontend · source: [`02-frontend.md`](02-frontend.md)_

- **ID:** WEB-01
- **File:** apps/web/src/components/PayrollIntelligence.tsx:31, apps/web/src/components/PayrollIntelligence.tsx:69-92, apps/web/src/pages/PayrollPage.tsx:727-732
- **What:** `closeMonth()` posts to `/cases/${caseId}/payroll-month-closes` where `caseId` is actually the local MVP client UUID (`caseId={clientId}` from `/clients/:clientId/payroll`), has no `try`/`catch`, no in-flight state and no success/failure UI, and signs every request with a single `useRef(crypto.randomUUID())` key created once per mount.
- **Why it matters:** Three compounding failures on the same button. (1) `clientId` comes from `createMvpClient()`'s local `crypto.randomUUID()` while canonical case ids come from `POST /cases`; the server sees an unknown case → 403/404. (2) `onClick={() => void closeMonth()}` means the rejection is an unhandled promise: the employer taps "אישור שהחודש מוכן וסגירה", nothing changes, no error appears, and the close history stays empty forever — they cannot tell whether the month was recorded. (3) Even against a correct case id, closing a second month reuses the first month's idempotency key, so the server replays the first close and the second month is never recorded while the UI shows no complaint. `refreshCloses()` also has no `.catch`, so its failure is a second unhandled rejection and `closes` silently stays `[]`.
- **Fix:** Pass the authenticated `EmploymentCase` id (not the local client id) or remove the canonical call from this local screen; wrap `closeMonth` in `try/catch` with a `'saving' | 'saved' | 'error'` state rendered as `role="alert"`/`role="status"`; generate the idempotency key per close attempt (keyed by month, regenerated after a successful close); add `.catch` to `refreshCloses`.
- **Confidence:** CONFIRMED

---

### WEB-02

**[BLOCKER] No unsaved-changes guard anywhere; the payroll wizard is never drafted, so one navigation tap destroys a month of entry**

_Area: Frontend · source: [`02-frontend.md`](02-frontend.md)_

- **ID:** WEB-02
- **File:** apps/web/src/pages/PayrollPage.tsx:167-171, apps/web/src/pages/PayrollPage.tsx:434-441, apps/web/src/AppShell.tsx:255-277
- **What:** The five-step payroll wizard keeps every entered value in `useState` (`values`, `additionalPayments`) and only persists on the final "אישור ושמירה"; there is no `beforeunload` handler, no router `useBlocker`, and `loadMonth()` overwrites all values with no confirmation.
- **Why it matters:** Verified by grep — `beforeunload`/`useBlocker`/`usePrompt` appear nowhere in `apps/web/src`. Concrete flows: (a) the user fills steps 2–4 (base salary, work days, Saturdays, holiday/vacation/sick pay, advances, deductions — ~20 fields), then taps "משימות" in the fixed mobile bottom nav to check something; `PayrollPage` unmounts and every value is gone with no warning. (b) At step 1 the user changes the month input to correct a mistake; `onChange={(event) => loadMonth(event.target.value)}` (line 815) resets `values` and `additionalPayments` to the stored/blank record — silently discarding everything typed. (c) "עריכת החודש" in the annual history (line 1741) does the same to an in-progress month. For the 50–60-year-old target user on a phone, (a) is a routine mis-tap.
- **Fix:** Persist the wizard to a scoped draft key the way `OnboardingPage` already does (`saveMvpOnboardingDraft` pattern, debounced), restore it in the `useState` initialiser, and add a router blocker + `beforeunload` while the draft differs from the saved record. Require an explicit confirm before `loadMonth` discards unsaved values.
- **Confidence:** CONFIRMED

---

### WEB-03

**[BLOCKER] SettingsPage can overwrite server-hydrated profile fields with stale pre-hydration values**

_Area: Frontend · source: [`02-frontend.md`](02-frontend.md)_

- **ID:** WEB-03
- **File:** apps/web/src/pages/SettingsPage.tsx:32-46, apps/web/src/pages/SettingsPage.tsx:115-122
- **What:** `draft` is seeded once from `profile`; the `useEffect` that re-syncs it to a later-arriving profile is disabled permanently after the first keystroke (`if (!edited)`), and submit writes the **whole** draft object via `setProfile(draft)`.
- **Why it matters:** `AuthProvider` renders the app immediately when `canUseCachedWorkspace(user.id)` is true (auth-context.tsx:139-145), then continues `startWorkspaceSync` in the background; a successful hydration calls `replaceMvpWorkspace(response.snapshot)` (workspace-sync.ts:291-298), which wipes and rewrites every `caredesk.mvp.*` key and fires `MVP_PROFILE_CHANGED`. Scenario: the user opens Settings on a phone with a stale device cache (e.g. a spouse added the bureau contact and the medical-insurance expiry from another device), types one character into "מספר טלפון" before hydration lands, hydration then replaces the store with the fuller server profile, but `edited === true` so `draft` keeps the stale copy for all ~30 untouched fields. Pressing "שמירה" writes that stale draft back over the hydrated profile and the sync layer PUTs it to the server, destroying the other device's edits. The existing test `SettingsPage.test.tsx:179 'keeps values the user is editing when a later profile arrives'` only asserts the _edited_ field survives; it never asserts the untouched hydrated fields do.
- **Fix:** Track edits per field, not per form — merge later-arriving profiles into the draft for fields the user has not touched. On submit, send only the changed fields (`{...profile, ...changedFields}` computed at submit time from the current `profile`, via `updateMvpProfile(changes)` which already exists) rather than the whole snapshot. `EmployeePage.tsx:71` has the same whole-object-write shape.
- **Confidence:** LIKELY

---

### WEB-04

**[BLOCKER] Canonical payroll draft is wiped whenever a sibling mutation triggers a refetch**

_Area: Frontend · source: [`02-frontend.md`](02-frontend.md)_

- **ID:** WEB-04
- **File:** apps/web/src/pages/case/CanonicalPayrollIntelligence.tsx:159-168, apps/web/src/pages/case/CanonicalPayrollIntelligence.tsx:264-316
- **What:** `useEffect(..., [entries, month])` calls `setDraft(found ? {...found} : blank())`, and `entries` gets a brand-new array identity from every `refresh()` — which `addExpense`, `removeExpense` and `migrateLegacyExpenses` all call.
- **Why it matters:** The month's payroll worksheet (16 numeric fields plus a repeatable additional-payments list) and the scenario-expense form live on the same screen, one above the other. The user fills in the payroll worksheet, scrolls down, adds a planning expense ("הוספת הוצאת תרחיש"), and `addExpense → refresh() → setEntries(payroll)` re-runs the effect with a new array reference. Because the month has no saved server entry yet, `found` is `undefined` and the effect calls `blank()`: every number the user just typed resets to `0` with no warning and no message. Removing an expense or running the legacy-expense migration does the same.
- **Fix:** Key the draft reset on the identity of the entry for the selected month, not on the `entries` array reference (e.g. depend on `entries?.find(e => e.month === month)?.id` and `?.version`), and never reset a dirty draft without an explicit user action.
- **Confidence:** CONFIRMED

---

### API-02

**[HIGH] Eight hand-rolled tenant transactions skip the role downgrade that `withTenant` performs**

_Area: Backend API · source: [`01-backend-api.md`](01-backend-api.md)_

- **ID:** API-02
- **File:** apps/api/src/collaboration/wave5-service.ts:87-104 (identical helpers at apps/api/src/payroll-entry-service.ts:64-77, apps/api/src/leave-entry-service.ts:47-60, apps/api/src/scenario-expense-service.ts:44-56, apps/api/src/regulation-rule-service.ts:269-282, apps/api/src/binder-export-service.ts:150-164, apps/api/src/evidence-export-service.ts:187-201, apps/api/src/product-intelligence/canonical-intelligence-service.ts:59-73)
- **What:** Each private `tenantTx`/`tx` helper does `begin` + `set_config('app.tenant_id', …, true)` but omits the `set local role caredesk_app` that the shared `withTenant` (packages/db/src/pool.ts:62) executes, so these statements run as whatever role the connection string authenticates as.
- **Why it matters:** The RLS policies are `using (tenant_id = current_setting('app.tenant_id', true)::uuid)`; a connection holding `BYPASSRLS` (Supabase's `postgres` owner, which `DATABASE_ADMIN_URL` points at and which an operator can trivially paste into `DATABASE_URL`) skips them entirely. Every query in these services is written to rely on RLS rather than an explicit tenant predicate — e.g. `select ... from payroll_entry where employment_case_id=$1` (payroll-entry-service.ts:82), `select 1 from tenant_membership where id=$1 and status='active'` (wave5-service.ts:259), `select status,employment_case_id from worker_request where id=$1 for update` (wave5-service.ts:550). Under an owner connection, a manager in tenant A who guesses tenant B's case UUID reads and writes B's payroll, leave, scenario and worker data. The inconsistency is visible inside a single request: `registerPayrollEntryRoutes`'s `requireManager` uses `withTenant` (role downgraded) while the payroll write immediately after does not.
- **Fix:** Delete the seven duplicated helpers and route all of them through `withTenant` from `@caredesk/db`, or at minimum add `await client.query('set local role caredesk_app')` immediately after `begin` in each. Add a lint rule or test asserting no `set_config('app.tenant_id'` appears outside `packages/db/src/pool.ts`.
- **Confidence:** CONFIRMED (the missing statement); the cross-tenant consequence is conditional on the connection role, which the docs say should be `caredesk_app`.

---

### API-03

**[HIGH] Optimistic concurrency is opt-in on payroll and scenario-expense writes — a client that omits `version` silently overwrites**

_Area: Backend API · source: [`01-backend-api.md`](01-backend-api.md)_

- **ID:** API-03
- **File:** apps/api/src/payroll-entry-service.ts:116-120 and apps/api/src/routes/payroll-entries.ts:42 (same pattern at apps/api/src/scenario-expense-service.ts:126 / apps/api/src/routes/scenario-expenses.ts:22)
- **What:** The route schema declares `version: z.number().int().positive().optional()` and the service guards with `if (input.version !== undefined && previous.rows[0] && input.version !== previous.rows[0].version) throw version_conflict` — omitting the field disables the check entirely.
- **Why it matters:** Two managers open March payroll. A saves `total: 7350`; B, whose form was loaded before A's save (or whose client simply omits `version` — the web client's own type at apps/web/src/api/client.ts:494 makes it optional), saves `total: 6100`. B's `insert … on conflict do update` overwrites every column and bumps `version`; A's figures are gone with no 409 and no way to tell from the response that anything was lost. Nothing in the route or the schema constrains the `status` transition either, so a month already saved as `final` can be silently rewritten and pushed back to `draft`. `LeaveEntryService.update` gets this right (`version: z.number().int().positive()`, required, apps/api/src/routes/leave-entries.ts:30), which shows the intended contract.
- **Fix:** Make `version` required on `PUT /cases/:caseId/payroll-entries/:month` and on the scenario-expense update/delete paths (it may stay absent only for a create, distinguished by the absence of an existing row), and reject any write whose target row is already `status='final'` unless an explicit reopen flag is supplied.
- **Confidence:** CONFIRMED

---

### API-04

**[HIGH] Automation commits are not transactional; a failure mid-way releases the receipt and a retry duplicates every task already created**

_Area: Backend API · source: [`01-backend-api.md`](01-backend-api.md)_

- **ID:** API-04
- **File:** apps/api/src/routes/event-action-plans.ts:244-339 (same shape at apps/api/src/routes/product-differentiation.ts:421-461)
- **What:** After `automationReceipts.claim` succeeds, the handler creates N tasks one at a time through `container.createTask.execute` (each its own connection/transaction), then writes the durable `event_action_plan` row, then Timeline, then Audit; the `catch` calls `automationReceipts.fail(...)` which flips the receipt to `failed` so that `claim` will re-issue it (automation-receipt-store.ts:125-132).
- **Why it matters:** A plan with 5 items where the connection drops after task 3 leaves 3 governed tasks committed, no plan row, no Timeline/Audit evidence, and a released claim. The client's automatic retry with the same `Idempotency-Key` re-enters the loop from item 1 and creates 3 duplicate tasks. The customer ends up with 8 tasks for a 5-item plan and an audit trail claiming 5. The comment "Release the claim so a retry with the same key can execute" is exactly backwards for a non-idempotent body of work.
- **Fix:** Either make the whole commit one transaction (pass a `PoolClient` through the task use case, or write the plan row + tasks in a single `withTenant` block) or make it resumable — record each `committedItems` entry on the receipt as it is created and have the retry skip items already receipted. Do not release a claim whose side effects were partially applied.
- **Confidence:** CONFIRMED

---

### DB-01

**[HIGH] Eight API persistence paths set the tenant context without `SET LOCAL ROLE caredesk_app`**

_Area: Database · source: [`03-database.md`](03-database.md)_

- **ID:** DB-01
- **File:** `apps/api/src/regulation-rule-service.ts:268-277`,
  `apps/api/src/collaboration/wave5-service.ts:87-104`,
  `apps/api/src/binder-export-service.ts:151-163`,
  `apps/api/src/evidence-export-service.ts:187-199`,
  `apps/api/src/payroll-entry-service.ts:64-75`,
  `apps/api/src/leave-entry-service.ts:48-59`,
  `apps/api/src/scenario-expense-service.ts:44-55`,
  `apps/api/src/product-intelligence/canonical-intelligence-service.ts:60-68`
  — contrast `packages/db/src/pool.ts:61-64`
- **What:** `packages/db/src/pool.ts` defines the one correct entry point:
  ```
  await client.query('begin');
  await client.query('set local role caredesk_app');
  await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
  ```
  Eight later services hand-rolled their own transaction helper and kept only the
  `set_config` line. Grepping the whole repo, `set local role` appears in exactly two
  non-test files: `pool.ts` and `rls-check.ts`. Every table these eight services touch —
  `payroll_entry`, `leave_entry`, `scenario_expense`, `regulation_rule`,
  `regulation_rule_transition`, `binder_export_receipt`, `worker_portal_access`,
  `case_responsibility_assignment`, `worker_request`, `professional_review_request`,
  `task`, `timeline_event`, `audit_event`, `employment_case`, `document`,
  `idempotency_record`, `tenant_membership` — is reached without the role switch.
- **Why it matters:** `pool.ts:41-52` states in its own comment that the role switch exists
  precisely for the case where "someone ever points DATABASE_URL back at an administrative
  role". `database/README.md:35-46` documents that exact state as a normal provisioning
  step: "Put that in `.env.local` as `CAREDESK_APP_DB_PASSWORD`, keep `DATABASE_URL` on the
  owner for now". In that window, and in any environment where the app URL is misconfigured
  to the owner, `withTenant()` paths remain isolated while these eight are fully cross-tenant:
  Supabase's `postgres` role has `rolbypassrls = true`, so every policy is skipped. The
  sharpest instance is `regulation-rule-service.ts:286-287`,
  `select role from tenant_membership where user_id=$1 and status='active' limit 1` — the
  authorization check itself relies solely on RLS for tenant scoping, so an owner connection
  turns it into "does this user have a manager role in _any_ tenant", i.e. privilege escalation
  across tenants. `evidence-export-service.ts:231-247` would likewise export another tenant's
  audit and timeline rows.
- **Fix:** Delete the seven hand-rolled helpers and route every one through
  `withTenant()` from `@caredesk/db`. If a helper must stay local, make `set local role
caredesk_app` the first statement after `begin`. Add an assertion to `rls-check.ts` that
  fails when `current_user` inside a tenant transaction is not `caredesk_app` — the file
  already checks this for the pool connection (`rls-check.ts:278-302`) but not for these
  code paths. A lint rule banning `set_config('app.tenant_id'` outside `pool.ts` would make
  the regression impossible to reintroduce.
- **Confidence:** CONFIRMED (the code fact; the cross-tenant consequence is conditional on
  the connecting role, which the README documents as a real interim state).

---

### DB-02

**[HIGH] Three migrations never record themselves, so the migration runner permanently wedges on the second run**

_Area: Database · source: [`03-database.md`](03-database.md)_

- **ID:** DB-02
- **File:** `packages/db/src/migrate.ts:5-9,27-46`; `database/migrations/0024_wave4_automation.sql:53`
  (file ends after the last grant), `database/migrations/0027_product_differentiation_completion.sql:53`,
  `database/migrations/0030_human_escalation_lifecycle.sql:72`
- **What:** `runMigrations` explicitly delegates version bookkeeping to the SQL file — "each
  migration … self-records its version (the SQL files end with an insert into
  schema_migrations), so re-running is a no-op". 33 of the 36 files do. `0024`, `0027` and
  `0030` do not (verified by counting `insert into schema_migrations` per file: 0 for each).
- **Why it matters:** First run: all migrations apply, three of them unrecorded. Second run
  (any redeploy, any `pnpm db:migrate`): `0024` is not in `applied`, so it re-executes,
  `create table document_intake_review` raises `relation "document_intake_review" already
exists`, the transaction rolls back and `runMigrations` **throws** at
  `migrate.ts:42`. The loop is sequential, so migration `0025` onward is never reached. A new
  migration `0036` can therefore never be applied to any environment that has already run
  0024 — the schema is frozen at 0035 and the failure looks like an unrelated "already
  exists" error. `0030` is worse than 0024 because it is not even idempotent in isolation:
  `alter table professional_review_request add column assigned_to_name text` has no
  `IF NOT EXISTS`.
- **Fix:** Add a new migration `0036` that inserts the three missing versions
  (`insert into schema_migrations (version) values ('0024_wave4_automation'),
('0027_product_differentiation_completion'), ('0030_human_escalation_lifecycle')
on conflict do nothing;`) — the same repair pattern 0017 already uses at lines 56-61.
  Then stop trusting the SQL file: have `runMigrations` insert the version itself inside the
  same transaction after `client.query(sql)`, and add a `migration-safety` rule that rejects
  any new migration file lacking the self-record line.
- **Confidence:** CONFIRMED.

---

### DB-03

**[HIGH] Production can silently run on the in-memory repositories; the fail-closed claim holds only at `/readiness`**

_Area: Database · source: [`03-database.md`](03-database.md)_

- **ID:** DB-03
- **File:** `apps/api/src/container.ts:272-279`, `apps/api/src/env.ts:37`,
  `apps/api/src/index.ts:14-37,39-56`, `apps/api/src/container.ts:613-620`
- **What:** `env.ts:37` declares `DATABASE_URL: z.string().optional()` and the production
  `superRefine` block never requires it (it only requires `WORKSPACE_ENCRYPTION_KEY`
  _when_ `DATABASE_URL` is present — `env.ts:184-190`). `container.ts:279` then does
  `const pool = env.DATABASE_URL ? createPool(env.DATABASE_URL) : undefined;` and the `else`
  branch at `container.ts:344-355` swaps in `InMemoryCaseFoundationRepository`,
  `InMemoryDocumentRepository`, `InMemoryAuditService`, `InMemoryWorkspaceRepository`,
  `InMemoryBillingRepository` and friends. `index.ts` builds the server and exports it as the
  Vercel handler regardless; `readiness()` is a separate endpoint that reports
  `database: 'unconfigured'` but does not gate traffic, and nothing calls it at boot.
- **Why it matters:** A typo'd or unset `DATABASE_URL` in a production deploy yields a fully
  functional-looking API where every customer write lands in process memory. On Vercel each
  invocation may get a fresh instance, so a family enters payroll data, gets a 200, and the
  data is gone on the next request. The audit trail is an in-process array
  (`in-memory-audit-service.ts:3-8`) — there is no durable record that it happened. The only
  signal is one `app.log.info({ persistence: 'in-memory' })` line at `index.ts:47-50`, which
  is not emitted at all on Vercel (`startLocalServer` is guarded by `!process.env.VERCEL`).
- **Fix:** In `env.ts`, add to the production `superRefine`: `DATABASE_URL`,
  `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` and the storage settings are required when
  `NODE_ENV === 'production'`. That turns a missing database into a startup failure, which
  `index.ts:25-34` already renders as a 503-everything app with the real message — exactly the
  fail-closed behaviour the docs claim.
- **Confidence:** CONFIRMED.

---

### DB-04

**[HIGH] `tenant_workspace` still has a DELETE grant, and the 0035 archive trigger only fires on UPDATE**

_Area: Database · source: [`03-database.md`](03-database.md)_

- **ID:** DB-04
- **File:** `database/migrations/0035_workspace_version_history.sql:67-70`;
  grant at `database/migrations/0011_tenant_workspace.sql:23` and re-granted at
  `database/migrations/0017_restore_missing_pilot_workspace.sql:27`
- **What:** Migration 0035 opens with "a single bad write therefore destroyed the customer's
  data with no way back: point-in-time recovery is not enabled on this project, and the
  backup project mirrors documents only". Its fix is
  `create trigger tenant_workspace_archive_previous **before update** on tenant_workspace`.
  There is no `before delete` trigger, and `caredesk_app` retains
  `select, insert, update, **delete**` on `tenant_workspace`. The archive therefore holds
  versions 1..N-1; version N — the live one — exists only in `tenant_workspace`.
- **Why it matters:** `delete from tenant_workspace where tenant_id = …` destroys the
  customer's current workspace with no archive row and no PITR to fall back on. That is
  precisely the unrecoverable-loss scenario 0035 was written to close, left open through the
  one verb the trigger does not cover. No repository method in `packages/db` issues that
  DELETE today, but the grant is live, so any future code path, a hand-run operator query
  through the app role, or an ORM-style "replace the row" implementation reaches it.
  `tenant_workspace_history` also has no FK to `tenant_workspace`, so nothing at the schema
  level blocks the delete either.
- **Fix:** `revoke delete on tenant_workspace from caredesk_app;` in a new migration — no
  code needs it. Belt and braces: add a `before delete` trigger reusing
  `archive_tenant_workspace_version()` (change `return new` to `return old` for the delete
  path) so an operator-level delete still leaves the last version recoverable.
- **Confidence:** CONFIRMED.

---

### DB-05

**[HIGH] Migration 0035 permanently archived unencrypted workspace payloads into a table the app can never rewrite**

_Area: Database · source: [`03-database.md`](03-database.md)_

- **ID:** DB-05
- **File:** `database/migrations/0035_workspace_version_history.sql:14-16,44,74-78`;
  `packages/db/src/workspace-repository.ts:110-119`
- **What:** 0035's header asserts "The payload is archived exactly as stored, which means it
  stays encrypted under WORKSPACE_ENCRYPTION_KEY with the tenant id as AAD. Archiving does
  not widen the blast radius of a database read." That is only true if the payload was
  already encrypted. `PgWorkspaceRepository.find` proves it is not always:
  ```ts
  if (row && this.encryptionKey && !isEncryptedEnvelope(row.payload)) {
    const encrypted = encryptPayload(row.payload, row.tenant_id, this.encryptionKey);
    await client.query(`update tenant_workspace set payload = $2::jsonb where …`, …);
  }
  ```
  This lazy re-encryption pass exists because plaintext workspace rows exist in the wild
  (encryption was added after the table). Migration 0035 lines 74-78 then bulk-copied
  `select … payload … from tenant_workspace` into the history table — capturing whatever was
  stored at that moment, plaintext included. The history table is granted
  `select, insert` only (line 44: "Deliberately no update and no delete"), so the lazy
  re-encryption pass can never reach it, and the `on conflict (tenant_id, version) do nothing`
  in the trigger means a later re-encryption UPDATE of the same version is a no-op against
  the archive.
- **Why it matters:** `tenant_workspace.payload` is the complete MVP state for a household:
  caregiver details, payroll figures, document metadata. For every tenant whose row was still
  plaintext when 0035 ran, a plaintext copy is now permanently at rest in
  `tenant_workspace_history`, and the application has no mechanism to remove or re-encrypt
  it. A database dump or a read by anyone with owner credentials sees cleartext for those
  tenants; the encryption-at-rest control the workspace design depends on does not cover them.
- **Fix:** Run an operator-role (owner) migration that re-encrypts any
  `tenant_workspace_history` row where `payload ->> '__caredesk_encrypted_workspace_v1'` is
  null, using the same AAD (`tenant_id`) as `workspace-repository.ts:44`. Add an assertion
  (or a CHECK) that every history payload carries the envelope marker. Correct 0035's header
  comment, which currently overstates the guarantee.
- **Confidence:** LIKELY — the code path proving plaintext rows exist is confirmed; whether
  any specific tenant was plaintext at the moment 0035 ran needs a query against the live
  database: `select count(*) from tenant_workspace_history where payload ->>
'__caredesk_encrypted_workspace_v1' is null;`

---

### DB-06

**[HIGH] `payroll_entry.total` is client-supplied with no reconciliation constraint**

_Area: Database · source: [`03-database.md`](03-database.md)_

- **ID:** DB-06
- **File:** `database/migrations/0028_canonical_payroll_entry.sql:25`;
  written from `apps/api/src/payroll-entry-service.ts:143,147`
- **What:** `total numeric(12,2) not null check (total between -10000000 and 10000000)` is
  the only constraint. The value comes straight from the request body
  (`PayrollEntryInput.total`, `payroll-entry-service.ts:22`) and is inserted verbatim at
  parameter `$22`. Compare `payroll_month_close`, where migration 0026 added
  `payroll_month_close_amount_reconciles check (total_amount = base_salary_amount +
additions_amount - deductions_amount)` — the same team applied exactly this protection to
  the close receipt and not to the entry it derives from.
- **Why it matters:** `payroll_entry` is the canonical record of what a family paid a
  caregiver in a given month, and it is what `packages/application/src/product-intelligence.ts`
  reads to build financial projections. A UI rounding bug, a stale client, or a crafted
  request stores a total that does not equal its own components, and nothing in the database
  or the read path detects the discrepancy. Because
  `payroll_entry_case_month_unique (tenant_id, employment_case_id, payroll_month)` drives an
  `on conflict … do update`, a bad total silently overwrites a good one. In an Israeli
  caregiver-employment product this row is the evidence a family would show a labour
  inspector.
- **Fix:** Add a CHECK mirroring 0026, accounting for the `additional_payments` jsonb array:
  compute the expected total server-side in `payroll-entry-service.ts` and stop accepting
  `total` from the client at all; keep the CHECK as the backstop. Note `additional_payments`
  is `jsonb … check (jsonb_typeof(...) = 'array')` with no constraint on element shape or
  amount, so any reconciliation CHECK must either sum it in SQL or the column must be
  normalised into rows.
- **Confidence:** CONFIRMED.

---

### DOM-04

**[HIGH] Currency is floating-point shekels in payroll/forecast, integer agorot in billing, with an EPSILON rounding hack**

_Area: Domain · source: [`06-domain-logic.md`](06-domain-logic.md)_

- **ID:** DOM-04
- **File:** packages/application/src/product-intelligence.ts:171 (`roundMoney`), 107-123 (`projectPayrollAnalytics`); apps/web/src/payroll-calculation.ts:98-119; contrast packages/application/src/use-cases/manage-product-billing.ts:62-73 (agorot integers)
- **What:** Product billing does it right: integers in agorot, VAT split as
  `net = round(price / (1 + vatBps/10000))` then `vat = price - net`, so the parts always sum to the
  whole. Caregiver payroll and cost forecasting do the opposite: `number` shekels with decimals, and
  one rounding helper:
  `const roundMoney = (amount) => Math.round((amount + Number.EPSILON) * 100) / 100;`
  `Number.EPSILON` is ~2.2e-16 in absolute terms, while the representation gap at shekel magnitudes
  is ~1e-13, so the correction does nothing where it is needed. I ran it:
  `roundMoney(1.015) === 1.02` but `roundMoney(8.165) === 8.16` and
  `roundMoney(1.005) === 1.01`. There is no stated half-up/half-even decision anywhere.
  `calculateMonthlyPayroll` meanwhile does **no** rounding at all — `paidSaturdays * saturdayRate`
  (e.g. `4.5 × 372.15`) flows unrounded into `total`, which then gets implicitly rounded by
  Postgres when stored into `numeric(12,2)`. Rounding therefore happens at the storage layer, at an
  undocumented step, with a different rule than the display layer.
  `projectPayrollAnalytics` (line 112) accumulates `cumulative` as raw float addition with no
  rounding at all, and `average: total / months.length` is unrounded.
- **Why it matters:** Two half-agora cases in the same month round in opposite directions, so the
  employer's printed payslip and the stored record can differ by an agora, repeatedly and
  unpredictably. Cumulative float addition across 12 months compounds it. For an audit trail the
  problem is not the size of the error, it is that the same inputs do not provably produce the same
  output at every layer.
- **Fix:** One representation for all money in `packages/domain`: integer agorot. One rounding
  function with an explicit documented rule (half-up is the ordinary Israeli payroll convention);
  round once, at the point a value becomes a payable amount, never on intermediates. Delete
  `roundMoney`.
- **Confidence:** CONFIRMED

---

### DOM-05

**[HIGH] The cost forecast double-counts a recurring expense that also carries a due date**

_Area: Domain · source: [`06-domain-logic.md`](06-domain-logic.md)_

- **ID:** DOM-05
- **File:** packages/application/src/product-intelligence.ts:182-187, 286-287
- **What:** `knownExpenses` sums every expense whose `dueDate` falls in the month; `recurring` sums
  every `frequency: 'monthly'` expense in window. `forecastTotal = projected(salary + recurring) +
knownExpenses + scenarioTotal` — an expense that is _both_ monthly and dated lands in both sums.
  The `components` list (line 262-264) uses `||`, so it lists the expense once. Total and components
  therefore disagree. Verified against the built package:
  ```
  projectFutureCost({ startMonth:'2028-01', baseSalary:100,
    expenses:[{ id:'ins', amount:50, frequency:'monthly', dueDate:'2028-03-15' }] })
  → 2028-03: total 200, components [base_salary 100, ins 50]   // components sum to 150
  ```
- **Why it matters:** A ₪50/month insurance premium that also records the month it falls due
  inflates that month's projection by exactly the premium, and the itemised breakdown the family is
  shown does not add up to the headline number. It is precisely the "explain this number" surface
  the product sells, showing a number it cannot explain.
- **Fix:** Compute one deduped expense set per month (the same predicate the `components` list uses)
  and derive both the total and the components from it.
- **Confidence:** CONFIRMED

---

### DOM-06

**[HIGH] Known expenses are silently dropped from any month that has an actual payroll**

_Area: Domain · source: [`06-domain-logic.md`](06-domain-logic.md)_

- **ID:** DOM-06
- **File:** packages/application/src/product-intelligence.ts:288-300
- **What:** When a month has `actual` (closed payroll) or `entered` payroll, `total` is set to that
  amount alone — while `known` on the very same row still reports the month's dated expenses.
  Verified:
  ```
  expenses:[{ id:'fee', amount:500, frequency:'one_time', dueDate:'2028-01-10' }],
  actuals:[{ month:'2028-01', amount:95 }]
  → { month:'2028-01', known:500, total:95 }   // annual total 1195, the 500 is nowhere
  ```
- **Why it matters:** Payroll and employment expenses are different things — a ₪500 insurance
  renewal due in a month whose salary happens to be closed disappears from that month's total _and_
  from the 12-month total and the reserve recommendation. A family planning its cash reserve is
  under-told by exactly the expenses that are hardest to absorb (the lumpy annual ones). The row
  also self-contradicts: `known: 500, total: 95`.
- **Fix:** `total = actualPayroll + knownExpenses + scenarioTotal`. The actual replaces the _salary
  forecast_, not the whole month.
- **Confidence:** CONFIRMED

---

### DOM-07

**[HIGH] Payroll inputs silently coerce negatives and NaN to zero, and the net is clamped at zero**

_Area: Domain · source: [`06-domain-logic.md`](06-domain-logic.md)_

- **ID:** DOM-07
- **File:** apps/web/src/payroll-calculation.ts:33-35, 118
- **What:** `safeAmount(value) => Number.isFinite(value) && value > 0 ? value : 0` is applied to
  every component, and the result is `total: Math.max(0, base + additions - deductions)`.
- **Why it matters:** Two distinct silent failures. (1) A field that fails to parse (`NaN` from an
  empty or malformed numeric input) becomes 0 rather than an error — if it is `advances: NaN` the
  deduction vanishes and the caregiver is over-paid; if it is `holidayPay: NaN` they are under-paid.
  Nothing tells anyone. (2) The `Math.max(0, …)` clamp: a caregiver who took ₪7,000 of advances
  against a ₪6,000 month should net **−₪1,000** (a balance carried forward), and the DB explicitly
  permits it (`payroll_entry.total between -10000000 and 10000000`). The client invents a floor of
  zero that the data model does not have, so the ₪1,000 the employee owes is erased.
- **Fix:** Validate at the boundary and throw a typed error on a non-finite or negative component
  instead of coercing. Remove the clamp; let a negative net be a negative net, and surface it as a
  carry-forward.
- **Confidence:** CONFIRMED

---

### DOM-08

**[HIGH] Document compliance status is computed once at upload and never recomputed**

_Area: Domain · source: [`06-domain-logic.md`](06-domain-logic.md)_

- **ID:** DOM-08
- **File:** packages/application/src/use-cases/manage-case-documents.ts:85-94 (`deriveComplianceStatus`), 138 (its only production call site)
- **What:** `deriveComplianceStatus` is called exactly once — while inserting the document — and the
  result is persisted into `document.compliance_status`. I searched every write of that column
  across `packages`, `apps` and `database/migrations`: the only one is the insert at
  `packages/db/src/document-repository.ts:125`. There is no scheduled recompute, no trigger, and no
  derivation on read (`apps/api/src/routes/case-documents.ts:88` returns the stored value verbatim).
- **Why it matters:** A visa uploaded in March expiring in December is stored as `valid`. In
  December it is still `valid`. In February it is still `valid`. The status never becomes `expiring`
  and never becomes `expired`. The compliance index built for exactly this purpose
  (`document_by_expiry`, migration 0008:118) is never scanned. For a product whose core promise is
  "you will not miss the visa deadline", the field that represents that promise is frozen at upload
  time.
- **Fix:** Derive on read from `expires_at` and the request clock (cheap, always correct, no job to
  fail), and keep the stored column only as a denormalised index for the scan. If it stays stored,
  add the daily recompute job the index was built for.
- **Confidence:** CONFIRMED

---

### DOM-09

**[HIGH] A partially-discounted subscription is displayed with a price and then never charged at all**

_Area: Domain · source: [`06-domain-logic.md`](06-domain-logic.md)_

- **ID:** DOM-09
- **File:** packages/application/src/use-cases/manage-product-billing.ts:73 (`effectivePriceAgorot`); database/migrations/0014_product_billing.sql:145,161
- **What:** The application layer advertises
  `effectivePriceAgorot = Math.round(price * (1 - launchDiscountPercent / 100))`. The SQL that
  actually claims due charges selects only rows `where s.launch_discount_percent = 0`, and bills
  `d.price_agorot` — the **undiscounted** price. So the discount exists in exactly two states as far
  as money is concerned: 0 (charged in full) or anything else (never charged).
- **Why it matters:** Set a tenant to a 40% launch discount: the billing page shows a 60% effective
  price and a next charge date, `deriveBillingAccessState` treats the tenant as needing payment, and
  the collection job never picks the row up. The customer is billed ₪0 indefinitely while being told
  otherwise. The two rules for the same number live in different languages in different layers with
  nothing tying them together.
- **Fix:** Compute the charged amount from one place. Either apply the discount in the claim query
  (`round(price_agorot * (100 - launch_discount_percent) / 100.0)`) or drop partial discounts from
  the model and make `launch_discount_percent` a boolean "sponsored". Add a test asserting
  `effectivePriceAgorot === amountAgorot` for the same subscription row.
- **Confidence:** CONFIRMED

---

### DOM-10

**[HIGH] There is no employment-case state machine, and the one state machine that exists is dead code**

_Area: Domain · source: [`06-domain-logic.md`](06-domain-logic.md)_

- **ID:** DOM-10
- **File:** packages/workflows/src/state-machine.ts:9-24; packages/domain/src/status.ts:8-15
- **What:** `EMPLOYMENT_CASE_STATUSES` defines a six-state lifecycle
  (draft → active → suspended → ended → cancelled → archived). `OpenEmploymentCase` creates every
  case as `'draft'` (open-employment-case.ts:87) and **nothing in the repository ever updates
  `employment_case.status`** — I grepped every `update … set` against that table across
  `apps/api/src` and `packages/db/src`; there is none outside the RLS test harness. So the lifecycle
  is decorative and every case is permanently a draft. Separately,
  `isAllowedTransition` — the only transition table in the codebase — is imported by exactly one
  file: `packages/workflows/src/state-machine.test.ts`. Nothing in production calls it. The real
  visa-renewal transition guards were reimplemented as a SQL `where` clause
  (`packages/db/src/visa-renewal-repository.ts:518-533`, which does check `wi.status in
('active','blocked')`, verified evidence, no unresolved overlap review — that part is sound).
- **Why it matters:** Two costs. First, a case can never legally end: there is no path to `ended`,
  so termination, the moment that triggers severance, notice and the visa consequences, has no
  representation. Second, the transition rules that do exist are trapped in SQL strings where the
  domain layer cannot unit-test them, and the package built to hold them is unused — so the next
  workflow will reinvent them again in a third place.
- **Fix:** Either implement the case lifecycle (a `TransitionEmploymentCase` use case validating
  against a transition table in `packages/domain`) or delete the enum until it is real. Move the
  visa-renewal guard conditions into `packages/workflows` so they are testable, and have the SQL
  enforce them as a second line rather than as the only one.
- **Confidence:** CONFIRMED

---

### DOM-11

**[HIGH] Leave-ledger day counts are unconstrained by their own date range, and a cancelled entry can be un-cancelled**

_Area: Domain · source: [`06-domain-logic.md`](06-domain-logic.md)_

- **ID:** DOM-11
- **File:** apps/api/src/routes/leave-entries.ts:19,23-32; apps/api/src/leave-entry-service.ts:145-160; database/migrations/0033_governed_leave_ledger.sql:15
- **What:** `days` is validated only as `> 0 and <= 366`, entirely independently of `startDate` and
  `endDate` (the `range` refinement checks only `startDate <= endDate`). The DB check is the same.
  So `startDate: 2026-08-01, endDate: 2026-08-03, days: 200` is accepted everywhere. Separately,
  `LeaveEntryService.update` takes `status: 'recorded' | 'cancelled'` with no transition guard, so a
  cancelled ledger row can be flipped back to `recorded`.
- **Why it matters:** `projectSharedLeave` (packages/application/src/collaboration.ts:86-90) sums
  `fact.days` to produce `used` and `planned`, and that figure is shown to both the family and
  (via the worker portal) the caregiver as the authoritative record of leave taken. A typo of 200
  for 2 is not caught by any layer. The un-cancel path defeats the stated design — the migration
  comment says "a mistaken row is cancelled, keeping the evidence trail intact", but a cancellation
  that can be reversed in place is not evidence.
- **Fix:** Refine `days <= calendarDaysBetween(startDate, endDate)` in a shared schema (and mirror it
  as a DB check). Make `cancelled` terminal in the service.
- **Confidence:** CONFIRMED

---

### DOM-12

**[HIGH] Payroll, leave and month-close authorization bypasses the audited `authorizeOrThrow` path**

_Area: Domain · source: [`06-domain-logic.md`](06-domain-logic.md)_

- **ID:** DOM-12
- **File:** apps/api/src/routes/payroll-entries.ts:85-96 (`requireManager`); apps/api/src/product-intelligence/canonical-intelligence-service.ts:90-95; contrast packages/application/src/use-cases/authorize.ts:36-79
- **What:** `authorizeOrThrow` exists specifically so that "a refusal cannot be thrown without also
  being recorded" (its own docstring), and every Milestone-1 use case routes through it. The
  money-handling paths do not: they run an ad-hoc
  `select 1 from tenant_membership … role in ('owner','manager')` inline — once in a route
  pre-handler, once inside a service — and return 403 or `throw new Error('manager_required')`
  without touching `AuthorizationService` or `AuditService`. `PayrollEntryService.save` itself
  contains no authorization at all; it is safe only because the route remembered.
- **Why it matters:** A viewer repeatedly probing the payroll-write endpoint of a case leaves **no
  `permission_decision = 'denied'` audit row** — the exact class of event the audit design calls out
  as the one worth investigating. And the check is one forgotten pre-handler away from being absent:
  the service is a public class with a `pool`, callable from any future route or job with no guard.
  This is authorization enforced at the transport layer rather than in the domain, which is what the
  brief asks about.
- **Fix:** Give payroll/leave/close real use cases in `packages/application` that call
  `authorizeOrThrow` with `resourceType: 'payroll' | 'leave'`, and have the routes call the use
  case. The membership SQL becomes an `AuthorizationService` rule, not a copy-pasted query.
- **Confidence:** CONFIRMED

---

### DR-04

**[HIGH] PITR is not enabled; the entire recovery envelope is seven daily snapshots**

_Area: Backup/DR · source: [`04-backup-dr.md`](04-backup-dr.md)_

- **ID:** DR-04
- **File:** `database/migrations/0035_workspace_version_history.sql:6`;
  `docs/operations/production-release-and-recovery.md:34-36`, `:9-13`;
  `docs/governance/WORK-PLAN-2026-08-29.md:24`
- **What:** PITR is explicitly not configured. The clearest statement is in the migration
  comment itself: "point-in-time recovery is not enabled on this project, and the backup
  project mirrors documents only, not the workspace"
  (`0035_workspace_version_history.sql:6`). The policy document defers it —
  "Broader commercial launch requires a fresh risk review and may require Point-in-Time
  Recovery" (`:35-36`).
  **Window: none.** Recovery granularity is one physical snapshot per day. Retention is 7
  rolling days — confirmed by observation (`:10-11`, seven retained daily backups, latest
  2026-08-03 20:44:45 UTC) and by the operator's own note that "the 22.8 backup is the only
  one preceding the overwrite (23.8, 04:39 UTC); retention is 7 rolling days"
  (`WORK-PLAN-2026-08-29.md:24`).
  The repo **does** state which plan it relies on — Supabase Pro, upgraded 2026-08-04
  (`:9`, `:24-25`) — so this is not an unstated assumption. That is a point in its favour.
  What is unstated is the retention period _configured_ on that plan (the policy says "with
  the desired retention period" without naming one) and whether anyone has verified it
  since the upgrade.
- **Why it matters:** Without PITR, the best possible outcome after a mid-day corruption is
  losing everything since the previous night's snapshot — up to 24 hours of a family's
  payroll entries, uploaded documents and case updates. With a 7-day ceiling, any loss that
  survives a week is unrecoverable by any means. Combined with DR-03 (no detection), that
  week can elapse silently.
- **Fix:**
  1. Enable PITR on the production project before real customer data is onboarded. On
     Supabase this is a plan/add-on decision, so make it explicitly and record the retention
     window in `production-release-and-recovery.md` next to the RPO statement.
  2. Until PITR exists, revise the stated RPO honestly: it is ≤24 hours _only for detected_
     loss, and effectively unbounded for undetected loss.
  3. Verify and document the actual configured retention on the Pro project rather than
     "the desired retention period".
- **Confidence:** CONFIRMED

---

---

### DR-05

**[HIGH] Migration 0035 is the right idea, but it covers only the legacy blob, no code reads it, and it may not be applied to production**

_Area: Backup/DR · source: [`04-backup-dr.md`](04-backup-dr.md)_

- **ID:** DR-05
- **File:** `database/migrations/0035_workspace_version_history.sql` (whole file);
  `docs/governance/WORK-PLAN-2026-08-29.md:40-44`; `apps/api/src/container.ts:631-650`
- **What:** Read on its own terms this migration is well built, and this audit should say so
  plainly. **What it protects:**
  - Every superseded version of `tenant_workspace.payload` is archived by a `BEFORE UPDATE`
    trigger (`:67-70`), deliberately at the database layer "so that it also captures writes
    that bypass the API — manual SQL, the re-encryption pass in `PgWorkspaceRepository.find`,
    and any future code path" (`:10-12`). That re-encryption pass is real
    (`packages/db/src/workspace-repository.ts:110-119`), so this was a correct call.
  - Purely additive: no column dropped, no value changed, `tenant_workspace` untouched (`:8-9`).
  - The archive is seeded with every tenant's current state (`:72-78`), so the version live
    at migration time survives even if the very next write is bad.
  - `unique (tenant_id, version)` plus `on conflict do nothing` (`:28`, `:57`) means a
    re-run cannot fail a customer's save.
  - RLS enabled _and_ forced with a tenant-scoped policy (`:34-39`); grants are
    `select, insert` only — "Deliberately no update and no delete" (`:41-44`).
  - `revoke all on function ... from public` (`:65`), closing the PostgREST-exposure hole
    that PostgreSQL's default `EXECUTE to PUBLIC` would otherwise open — this was a
    follow-up fix (commit `ea3ca81`).
  - Payload stays encrypted under `WORKSPACE_ENCRYPTION_KEY` with tenant id as AAD, so
    archiving does not widen read blast radius (`:14-16`).

  **What it does not protect:**
  1. **Nothing reads it.** `tenant_workspace_history` appears in no TypeScript file, no
     repository method, no API route, no script — grep across the repo returns only the
     migration itself. There is a write path and no read path. Recovery still requires a
     human with a database connection, SQL, and the encryption key.
  2. **DELETE is not archived.** The trigger is `BEFORE UPDATE` only (`:67-70`) while
     `caredesk_app` still holds `DELETE` on `tenant_workspace` (`0011_tenant_workspace.sql:23`).
     A delete of the row loses the then-current version.
  3. **Legacy blob only.** It covers `tenant_workspace.payload` — the compatibility MVP
     snapshot. It does **not** cover `employment_case`, `document`, `document_version`,
     `task`, `contact`, `payroll_month_close`, `payroll_entry`, the leave ledger, billing,
     or `workspace_file`. Those are the canonical tables the product is migrating toward
     (`docs/adr/ADR-006-normalized-persistence-migration.md`), and they have no history.
  4. **No document bytes and no `workspace_file` rows.**
  5. **Key dependency.** History is encrypted with `WORKSPACE_ENCRYPTION_KEY`. Losing or
     rotating that key without escrow makes the entire archive unreadable — see DR-12.
  6. **No pruning, no retention.** Unbounded growth, and archived payloads keep data that
     the privacy policy requires to be deleted — see DR-09.
  7. **Not enforced anywhere.** `/ready` checks six schema objects and
     `tenant_workspace_history` is not among them (`apps/api/src/container.ts:631-637`), so
     production reports green without the safety net. `docs/governance/WORK-PLAN-2026-08-29.md:40-44`
     lists applying 0035 to production as still-pending step 2 — "until it runs, there is
     no safety net."

- **Why it matters:** A reader of this migration could reasonably conclude the workspace is
  now recoverable. It is only _archivable_. In a live incident the operator still has to
  write ad-hoc SQL against an encrypted JSONB column under pressure — the same manual work
  as before, just with better source material. And if the migration is not applied to the
  production project, none of it exists at all.
- **Fix:**
  1. Confirm 0035 is applied to production and add `tenant_workspace_history` to the
     `/ready` object check so a missing safety net fails the readiness gate.
  2. Build the read path: a repository method listing versions for a tenant and an
     operator-only CLI that decrypts and diffs a chosen version against live. This is small
     and it is the difference between an archive and a recovery capability.
  3. Add an `AFTER DELETE` archive branch, or revoke `DELETE` on `tenant_workspace` from
     `caredesk_app` entirely (nothing in the application appears to need it).
  4. Define a retention/pruning policy for the archive that is consistent with the privacy
     notice, executed by the admin role.
  5. Add a test. This migration has no coverage; the RLS harness
     (`packages/db/src/rls-check.ts`) should assert the archive is tenant-isolated and that
     `caredesk_app` cannot update or delete a history row.
- **Confidence:** CONFIRMED

---

---

### DR-06

**[HIGH] Canonical tables have hard deletes and no version history; there are no soft deletes anywhere**

_Area: Backup/DR · source: [`04-backup-dr.md`](04-backup-dr.md)_

- **ID:** DR-06
- **File:** `database/migrations/0008_documents.sql:135`, `0007_tasks_and_timeline.sql:94`,
  `0006_organizations_and_contacts.sql:153`, `0012_workspace_files.sql:26`,
  `0011_tenant_workspace.sql:23`, `0021_visa_renewal_persistence.sql:272`
- **What:** Across all 36 migrations there is **no** `deleted_at`, `is_deleted`, or any
  soft-delete column — the only match for that family of names is `archived_at` inside
  `tenant_workspace_history` (`0035:26`). `caredesk_app` holds `select, insert, update,
delete` on `document`, `task`, contacts/organizations, `workspace_file`,
  `tenant_workspace`, and the visa-renewal tables.
  The architecture documentation anticipated this: `docs/architecture/database-blueprint.md:102-103`
  states "Soft deletion is permitted only where retention policy allows it. Audit, payroll
  snapshots, rule versions, and ledger entries are not silently [deleted]" — the retention
  policy that would authorise it remains an open legal decision (`:469-480`, "No developer
  may invent retention periods").
  The genuine mitigations that do exist: `document_version` is immutable (insert-only,
  `0008:57-58`), so replacing a file adds a version rather than overwriting; `audit_event`
  (`0009`), `timeline_event` (`0007`), `binder_export_receipt` (`0031`) and
  `automation_execution_receipt` (`0029`) are all append-only by grant. Those preserve the
  _record_ of what happened. They do not preserve the data.
- **Why it matters:** A manager-role family member deletes a case, or a bad deploy issues a
  `DELETE` with a wrong predicate. The row is gone immediately and irreversibly. The audit
  trail will faithfully record that it happened and by whom, which is useful for the
  incident report and useless for the customer. Recovery then falls back to DR-02 —
  full-project restore and hand-merge — for what should be a one-click undo.
- **Fix:**
  1. Before onboarding real data, remove `DELETE` from `caredesk_app`'s grants on the
     tables where the application does not require it, and implement deletion as a status
     change plus a scheduled hard-delete governed by the retention policy.
  2. Where deletion must remain immediate, mirror the 0035 pattern: a trigger-written
     history table with insert-only grants.
  3. Resolve the blocking dependency: the retention periods are already written down in
     `CareDesk_Legal_Validation_P0.docx` §4 (payroll 7 years, ID scans 90 days after
     employment ends, AI questions 30 days, usage logs 12 months, inactive accounts 24
     months). Get those approved and encoded so soft delete stops being blocked on an
     "open legal decision".
- **Confidence:** CONFIRMED

---

---

### DR-07

**[HIGH] The off-site database backup and Storage copy are manual; there is no automation and no named owner**

_Area: Backup/DR · source: [`04-backup-dr.md`](04-backup-dr.md)_

- **ID:** DR-07
- **File:** `docs/operations/production-release-and-recovery.md:16-18`, `:26-30`, `:38-61`;
  `package.json:12-30`; `.github/workflows/ci.yml:1-8`
- **What:** The policy requires "a separate daily off-site logical backup of database roles,
  schema, and data" (`:26-27`) and "a separate daily off-site copy of every private Storage
  object" (`:28-29`), both encrypted with access limited to production operators (`:30`).
  The document is explicit that these are not yet in place: "an off-site logical backup and
  Storage copy must be automated" (`:17`).
  What exists is a manual procedure to be run **before a schema change** (`:38-61`): three
  logical exports (`roles.sql`, `schema.sql`, `data.sql`) and
  `npx supabase storage cp -r ss://caredesk-private-documents <dir>\storage --experimental`
  (`:56`), with SHA-256 checksums, project ref, timestamps, object count and operator
  recorded (`:60-61`).
  There is no automation behind it: `package.json` has no backup/restore/verify script;
  `.github/workflows/ci.yml` triggers only on `workflow_dispatch`, `pull_request` and pushes
  to `main`/`staging` (`:3-7`) — there is **no `schedule:` trigger anywhere**; `scripts/`
  contains only lint and hygiene checks. Ownership is "the production operators" (`:30`)
  and `PILOT_RELEASE.md:13` — no named individual, no rota.
  Note also the copy command uses an `--experimental` CLI flag for a control on which
  customer document recovery depends.
- **Why it matters:** A "daily" backup that depends on a person remembering will be missed,
  and its absence is invisible until it is needed. It is also tied to the wrong event: the
  procedure fires before schema changes, but the realistic loss events (a bad application
  write, a user error, a leaked service-role key) are unrelated to schema changes. Worse,
  the managed Supabase backups and the off-site copy live in the same vendor account: a
  compromised or closed Supabase organisation takes out both simultaneously — which is
  precisely the failure the off-site copy is supposed to cover, and it currently does not
  exist.
- **Fix:**
  1. Automate both jobs on a schedule outside Vercel and outside the Supabase account (a
     scheduled GitHub Action with encrypted artifact upload to independent object storage,
     or an equivalent runner). Fail loudly and alert when a run is missed.
  2. Store the off-site copy under credentials that are not the Supabase account's, so a
     single-account compromise cannot destroy every copy.
  3. Name a specific owner and a backup owner in `production-release-and-recovery.md`.
  4. Automate the checksum recording and verification the policy already specifies (`:63-70`)
     rather than leaving it as a manual discipline.
- **Confidence:** CONFIRMED

---

---

### DR-08

**[HIGH] Staging and production may still share one Supabase project**

_Area: Backup/DR · source: [`04-backup-dr.md`](04-backup-dr.md)_

- **ID:** DR-08
- **File:** `docs/operations/production-release-and-recovery.md:16-17`, `:22-23`, `:99`;
  `PILOT_RELEASE.md:1`
- **What:** "Staging and production still need separate Supabase projects" (`:16-17`),
  present tense, in the launch-blockers section. The minimum supported setup requires
  "Separate Supabase projects for staging and production. Staging must never use the
  production database or private Storage bucket" (`:22-23`), and the release checklist
  carries "staging and production project refs are different" as an unchecked item (`:99`).
  Nothing in the repository demonstrates the separation has been made.
- **Why it matters:** Everything else in this audit assumes production data can only be
  damaged by production activity. If the projects are shared, a staging `db reset`, a seed
  script, a truncate during a test, or a Playwright run against the wrong `DATABASE_URL`
  destroys real customer data directly. The release checklist explicitly guards against
  "`db reset`, seed, truncate, or bulk delete" in a release (`:105`), which only makes
  sense because the risk is live. Combined with no PITR, no detection and no rehearsed
  restore, a single mistyped environment variable is an extinction event for the pilot's
  data.
- **Fix:** Separate the projects before any real customer data is entered, and make the
  API refuse to start when its `DATABASE_URL` project ref matches a configured staging ref.
  This is cheap and it removes a whole category of accident.
- **Confidence:** LIKELY (the repository states the separation is outstanding; the actual
  current infrastructure state cannot be verified from the repo)

---

---

### DR-09

**[HIGH] Database rows and storage objects will drift after any restore, and no reconciliation job exists**

_Area: Backup/DR · source: [`04-backup-dr.md`](04-backup-dr.md)_

- **ID:** DR-09
- **File:** `docs/operations/production-release-and-recovery.md:28-29`;
  `apps/api/src/storage/mirrored-document-storage.ts:5-6`, `:29-31`;
  `packages/application/src/use-cases/manage-workspace-files.ts:97-114`;
  `database/migrations/0012_workspace_files.sql:4-17`; reconciliation job: NOT FOUND IN REPO
- **What:** Document bytes and their metadata live in two independent systems with
  independent recovery timelines. The policy names the hazard: "Supabase database backups
  contain Storage metadata, not the uploaded files" (`:28-29`).
  The mirror makes this more subtle rather than less. `MirroredDocumentStorage` writes every
  object to an independent backup project before reporting success (`:14-23`), and
  deliberately does **not** propagate deletes: "User deletion intentionally does not delete
  the backup copy, preserving recovery from accidental deletion" (`:5-6`, `:29-31`). So
  after any restore:
  - **Rows without bytes:** an object deleted from the primary bucket after the backup was
    taken is restored as a `workspace_file` row pointing at a `storage_key` that no longer
    resolves in the primary. The signed-URL path (`GetWorkspaceFileUrl`) issues a link that
    404s. The bytes are still in the mirror, but nothing reads the mirror
    (`getSignedUrl` always uses the primary, `:25-27`).
  - **Bytes without rows:** an object uploaded after the backup keeps its bytes in both
    buckets while its row is gone, becoming an orphan that no tenant can see, no API can
    reach, and no erasure request can find.
  - **Deleted documents:** `DeleteWorkspaceFile` hard-deletes the `workspace_file` row
    (`manage-workspace-files.ts:99`) and then the primary object (`:101`). The mirror copy
    survives — but the row carrying its `storage_key` is gone, so the only remaining map to
    that byte range is the object path itself (`<tenantId>/workspaces/<clientId>/documents/<documentId>/<objectId>`,
    `apps/api/src/storage/supabase-document-storage.ts:40`) plus the
    `workspace.document.deleted` audit event. Recoverable by a human who knows this; not
    documented anywhere.
    No reconciliation exists. There is no script in `scripts/`, no `package.json` command, and
    no CI job. The requirement is stated only as future work:
    `docs/governance/next-delivery-wave-gap-analysis.md:174` ("Database restore and
    reconciliation must verify tenant counts, worker-access relationships, intent/attempt
    pairs and audit references before re-enabling delivery") and as one line of the drill
    acceptance criteria (`production-release-and-recovery.md:120`).
- **Why it matters:** Post-restore, a family opens the caregiver's passport and gets an
  error — with no indication whether the file is lost or merely unreachable, and no tool to
  tell the operator which of the two it is or how many documents are affected. For a product
  whose core promise is that the visa and passport paperwork is in one safe place, a
  silently broken document is the worst possible failure, and it will be discovered by the
  customer at the moment they need the document most.
- **Fix:**
  1. Write a reconciliation script (`pnpm dr:reconcile`) that lists every `workspace_file`
     and `document_version` storage key, lists both buckets, and reports three sets: rows
     without primary bytes, primary bytes without rows, and rows whose bytes exist only in
     the mirror. Run it after every restore and on a schedule.
  2. Add a documented fallback read from the mirror bucket for the "primary object missing"
     case, so the second copy is actually reachable in an incident.
  3. Make the reconciliation output part of the drill record required by
     `production-release-and-recovery.md:127-129`.
- **Confidence:** CONFIRMED

---

---

### DR-10

**[HIGH] Erasure obligations conflict with immutable copies that have no purge process**

_Area: Backup/DR · source: [`04-backup-dr.md`](04-backup-dr.md)_

- **ID:** DR-10
- **File:** `CareDesk_Legal_Validation_P0.docx` §4 (retention table), §5 (rights), Part 3
  (P0 checklist); `apps/api/src/storage/mirrored-document-storage.ts:5-6`, `:29-31`;
  `database/migrations/0035_workspace_version_history.sql:41-44`;
  `docs/architecture/database-blueprint.md:469-480`; `PILOT_RELEASE.md:38`, `:43-44`
- **What:** The legal validation document sets concrete obligations under the Israeli
  Privacy Protection Law 5741-1981 and Amendment 13 (in force August 2025, penalties to
  ₪3.2M): a named DPO, database registration, a deletion policy with an access/correction/
  portability process, an audit log of sensitive access, DPAs with cloud providers, and a
  specific retention schedule — payroll 7 years (statutory), **passport/ID scans deleted 90
  days after employment ends**, AI questions anonymised after 30 days, usage logs 12 months,
  inactive accounts deleted after 24 months. "Automatic document deletion policy (90 days)"
  is a mandatory P0 pre-launch checklist item.
  Against that, three separate immutable-copy conflicts exist today, none of them documented
  as accepted risk:
  1. **The mirror bucket never forgets.** Deleting a document deletes only the primary
     (`mirrored-document-storage.ts:29-31`); the backup copy is retained deliberately. There
     is no purge path, no expiry, and no process for removing a specific object from the
     mirror on an erasure request. A passport scan a customer deleted persists indefinitely
     in a second Supabase project.
  2. **Workspace history never forgets.** `tenant_workspace_history` has no `delete` grant
     and no pruning (`0035:41-44`, "Pruning, if it is ever needed, is an operator action
     through the admin role"). Every archived payload contains the personal data as it stood
     at that version, including records the customer has since deleted.
  3. **Daily physical backups** hold erased data for the retention window. This one is a
     normal and defensible industry position — but it is nowhere written down as such.
     Additionally, **no automatic deletion exists at all**: no scheduled job, no retention
     enforcement, no erasure endpoint anywhere in `apps/api/src/routes/`. And the DPO fields in
     the privacy notice are placeholders ("[to be filled before launch]"), so there is no named
     recipient for the erasure or access request that `PILOT_RELEASE.md:38` requires to have "a
     named operator and written response procedure".
     `docs/architecture/database-blueprint.md:469-480` acknowledges the whole area is open:
     retention periods "remain an open legal/privacy decision… No developer may invent
     retention periods."
- **Why it matters:** A customer exercises the right to erasure. The operator deletes the
  rows and the primary objects, and truthfully believes the request is fulfilled — while
  copies of the same identity documents remain in the mirror bucket and inside archived
  workspace payloads, with no inventory of where they are and no tool to remove them. Under
  Amendment 13 that is an unfulfilled erasure request on sensitive data, with regulator
  exposure. It is also the classic trap: the controls added for data safety (DR-05, DR-09)
  are the ones that create the compliance conflict, and neither was reconciled against the
  retention schedule that already exists in the legal document.
- **Fix:**
  1. Write the erasure procedure **as a procedure**, enumerating every copy: primary bucket,
     mirror bucket, `tenant_workspace_history`, physical backups, off-site logical backups.
     For each, state either "purged on request" or "retained for N days as a documented,
     disclosed exception", and put the disclosure in the privacy notice.
  2. Propagate erasure to the mirror explicitly — a distinct operator-invoked path, separate
     from ordinary user deletion, so the accidental-deletion safety net survives while
     genuine erasure completes.
  3. Give `tenant_workspace_history` a retention window and an admin-role pruning job.
  4. Implement the 90-day identity-document deletion the P0 checklist requires, as a
     scheduled job, before real ID scans are accepted.
  5. Name the DPO and fill the contact fields before the first real customer.
- **Confidence:** CONFIRMED

---

---

### REL-03

**[HIGH] The migration runner has no concurrency lock, no environment guard, and no dry-run**

_Area: Release · source: [`05-release-safety.md`](05-release-safety.md)_

- **ID:** REL-03
- **File:** `packages/db/src/migrate.ts:11-48`; `packages/db/src/cli.ts:16-44`; contrast `packages/db/src/rls-check-ci.ts:19-22`
- **What:** No `pg_advisory_lock` anywhere in the runner (repo-wide, the only advisory lock is inside a plpgsql body at `0019_backfill_self_service_accounts.sql:29`). `cli.ts:17` reads `DATABASE_ADMIN_URL` and connects — it never checks which environment that is, never prints a plan, never asks for confirmation, never records what it did beyond stdout (`cli.ts:36-39`). The CI RLS harness _does_ guard its target (`rls-check-ci.ts:19-22` refuses any non-loopback host) — the production-facing runner does not.
- **Why it matters:** Two failure modes. (a) Two operators, or one operator and a retried terminal, run `db:migrate` concurrently: both read the ledger, both see the same version pending, both execute the DDL, one gets a duplicate-object error mid-sequence and leaves the run partially advanced. Vercel does not trigger migrations (neither `vercel.json` runs `db:migrate`; the build commands at `apps/web/vercel.json:5` and `apps/api/vercel.json:4` only build), so this is human concurrency rather than deploy concurrency — but `AGENTS.md` describes a multi-agent workflow, which makes two people at two terminals the expected case, not the exotic one. (b) An operator with a production `.env.local` open in one window runs what they believe is a local migration. Nothing stops them.
- **Fix:** Wrap the whole loop in `select pg_advisory_lock(<constant>)` / `pg_advisory_unlock` around `migrate.ts:22-46` (a session-level lock, since transaction-level would release at each `commit`). Add a `--dry-run` that prints the pending list and exits. Require an explicit `--yes-production` flag or an interactive confirmation when the host is not loopback. Append each applied version, timestamp and operator to a release log.
- **Confidence:** CONFIRMED

---

### REL-04

**[HIGH] Migration 0030 is a breaking change that makes a code rollback fail with constraint violations**

_Area: Release · source: [`05-release-safety.md`](05-release-safety.md)_

- **ID:** REL-04
- **File:** `database/migrations/0030_human_escalation_lifecycle.sql:15-20,36-38`; contrast `database/migrations/0027_product_differentiation_completion.sql:12`
- **What:** `0027:12` created `professional_review_request.status` with `check (status in ('draft','open','in_review','resolved','cancelled'))` and `default 'open'`. `0030:15-17` rewrites existing `'draft'`/`'open'` rows to `'requested'`, `0030:18-20` installs a new `CHECK` that **no longer permits** `'draft'` or `'open'`, and `0030:36-38` adds `check (status <> 'resolved' or resolution_note is not null)` — a conditional NOT NULL on a column that did not exist one migration earlier.
- **Why it matters:** `DEPLOYMENT.md:8` and `PILOT_RELEASE.md:37` both define rollback as "redeploy the last known-good production commit". Do that across `0030` and the restored API build writes `'open'` (its `0027`-era default) into a column whose constraint now rejects it, and resolves reviews without a `resolution_note` into a constraint that now requires one. Both surface as `23514 check_violation` — a 500 on the escalation path, not a graceful degradation. The `0030` author clearly _understood_ expand/contract, because `:24-26` explicitly preserves the legacy `assigned_to` column "(expand-only release policy)" — the discipline was applied to the column and skipped on the constraints. It also passes CI cleanly: `migration-safety.ts` has no rule for constraint narrowing and none for `UPDATE`.
- **Fix:** For the constraint half, the expand form is: add the new statuses to the `CHECK` _without_ removing the old ones, ship code that stops writing the old ones, wait one stable release, then contract. For `review_resolution_note_consistent`, add it `NOT VALID` first so it constrains only new rows, and validate in the following release. Going forward, add a "rollback compatibility" line to the release checklist at `production-release-and-recovery.md:95-108` that names the oldest build the new schema still accepts.
- **Confidence:** CONFIRMED

---

### REL-05

**[HIGH] The `/ready` deployment gate is blind to every migration after 0021**

_Area: Release · source: [`05-release-safety.md`](05-release-safety.md)_

- **ID:** REL-05
- **File:** `apps/api/src/container.ts:611-657`, specifically the probe at `:632-638`
- **What:** Readiness in production checks exactly six database objects: `resolve_caredesk_actor`, `tenant_workspace`, `workspace_file`, `list_caredesk_family_members`, `product_subscription`, `workflow_instance`. The newest of these arrives in `0021_visa_renewal_persistence.sql`. Nothing from `0023` onward is checked — not `payroll_month_close`, `document_intake_review`, `event_action_plan`, `payroll_entry`, `automation_execution_receipt`, `professional_review_request`, `professional_review_transition`, `binder_export_receipt`, `regulation_rule`, `leave_entry`, `scenario_expense`, or `tenant_workspace_history`.
- **Why it matters:** `DEPLOYMENT.md:62-63` makes `/ready` a deployment blocker ("A 503 is a deployment blocker, even when `/health` is green") and `PILOT_RELEASE.md:28` repeats it. But given REL-01 — where the migration run aborts and the operator may not notice the non-zero exit in a scrollback — the API deploys, `/ready` returns `ready: true`, the release is signed off, and the first customer to open the payroll or escalation screen gets a `42P01 undefined_table` 500. The gate that exists specifically to catch "required migrations are missing" (`container.ts:649`) reports green on a database 14 migrations behind the code.
- **Fix:** Replace the hand-maintained `to_regclass` list with a ledger comparison: have the build embed the highest migration version present in `database/migrations/` at build time, and have `/ready` fail when `select max(version) from schema_migrations` is below it. That single check subsumes the six object probes and cannot go stale.
- **Confidence:** CONFIRMED

---

### REL-06

**[HIGH] The migration safety scanner has four exploitable blind spots**

_Area: Release · source: [`05-release-safety.md`](05-release-safety.md)_

- **ID:** REL-06
- **File:** `packages/db/src/migration-safety.ts:13-58` (rules), `:64-69` (`executableSql`), `:88-116` (driver); invoked at `.github/workflows/ci.yml:60-61`
- **What:** Four gaps, in descending order of how likely they are to be hit:
  1. **No `UPDATE` rule.** `DESTRUCTIVE_RULES` covers `DROP TABLE`, `DROP SCHEMA`, `TRUNCATE`, `DELETE FROM`, `DROP COLUMN`, `RENAME COLUMN`, `ALTER COLUMN ... TYPE`, `SET NOT NULL`. A bulk `UPDATE ... SET` destroys customer data exactly as thoroughly as a `DELETE` and is not mentioned. `0030:15-17` — the one in-place rewrite in the set — sailed through.
  2. **String-literal bypass.** `executableSql` at `:68` replaces every `'...'` literal with `''` before matching. So `execute 'truncate task'` is invisible to all eight rules. This is not hypothetical syntax: `0018:76` and `0019:131` already use exactly this `execute '<ddl>'` idiom. A `DO $$ ... EXECUTE '<destructive>' ... $$` block passes clean.
  3. **Bounded lookahead.** The `drop-column`, `alter-column-type` and `set-not-null` patterns (`:41,:51,:56`) use `[\s\S]{0,400}` / `{0,250}` windows between `alter table` and the dangerous keyword. A migration with a long `ALTER TABLE ... ADD COLUMN ... , ... , DROP COLUMN x` — like the four-column `0026_canonical_product_intelligence.sql:3-11` shape — can push the keyword past the window.
  4. **No lock/ordering rules at all.** Nothing flags `CREATE INDEX` without `CONCURRENTLY` on an existing table, `ADD CONSTRAINT` (CHECK or FK) without `NOT VALID`, a duplicate migration number, or a file that omits its `schema_migrations` insert. Those are the four checks that would have caught REL-01, REL-04, REL-07 and REL-08 respectively.
- **Why it matters:** The team correctly treats this check as authoritative — `migration-safety-cli.ts:77-79` prints "Do not bypass this check", and `database/README.md:76-77` says "CI rejects edits to applied migrations and common destructive or rolling-deployment-incompatible changes". A green check reads as "this migration is safe to run on production". For a bulk `UPDATE` or an unconcurrent index, it is not saying that.
- **Fix:** Add rules for `\bupdate\s+\w+\s+set\b`, `create\s+index(?!\s+concurrently)` on a table not created in the same file, and `add\s+constraint(?![\s\S]*not\s+valid)`. Match against the pre-strip SQL for the `execute '...'` case (or strip comments only, not literals). Add a structural check: every `database/migrations/NNNN_*.sql` must contain exactly one `insert into schema_migrations` naming its own version, and no two files may share an `NNNN`. All four are cheap and all four are file-local.
- **Confidence:** CONFIRMED

---

### WEB-05

**[HIGH] A transient or expired session unmounts the whole app tree and destroys in-progress form state**

_Area: Frontend · source: [`02-frontend.md`](02-frontend.md)_

- **ID:** WEB-05
- **File:** apps/web/src/auth/auth-context.tsx:172-198, apps/web/src/auth/auth-context.tsx:316-325
- **What:** `AuthProvider` returns `loading` / `login` / `storageUnavailable` **instead of** `children`, so any auth state change tears the entire React subtree down; `recoverTransientSession()` sets `state = 'loading'` on every empty-session event.
- **Why it matters:** Supabase surfaces a momentary null session on token refresh and when a mobile browser resumes a suspended tab — this is exactly what `recoverTransientSession`'s comment says it exists for. When it fires, `setState('loading')` swaps the whole app for `<AuthLoadingPage/>`, unmounting `PayrollPage` / `SettingsPage` / `DocumentsPage` and discarding their component state. If the 1.5 s recovery fails, the user lands on the login page and every typed value in the wizard, the settings form and the document form is gone. Nothing in `apiRequest` (client.ts:101-130) handles a mid-flow 401 either — each screen treats it as a generic failure, and only `VisaRenewalSection` distinguishes 401/403.
- **Fix:** Keep `children` mounted and overlay the loading/login state (portal or absolutely-positioned cover) so component state survives a transient auth blip; combined with WEB-02's draft persistence this makes the loss non-fatal. Add a single 401 handler that shows a re-authentication prompt without unmounting the form.
- **Confidence:** CONFIRMED

---

### WEB-06

**[HIGH] No error boundary anywhere, and every localStorage write is unguarded**

_Area: Frontend · source: [`02-frontend.md`](02-frontend.md)_

- **ID:** WEB-06
- **File:** apps/web/src/main.tsx:16-24, apps/web/src/storage/mvp-storage.ts:135-137
- **What:** `grep -rn "ErrorBoundary\|componentDidCatch"` over `apps/web/src` and `packages/ui` returns nothing, and `writeBusinessItem` → `window.localStorage.setItem` is called with no `try`/`catch` from `saveMvpProfile`, `saveList`, `saveClients`, `saveMvpOnboardingDraft` and `replaceMvpWorkspace`.
- **Why it matters:** `localStorage.setItem` throws `QuotaExceededError` when the origin quota (~5 MB) is exhausted and throws outright in Safari private browsing. The store is a plausible quota risk: `MvpDocument` still carries a legacy `dataUrl?: string` (base64 file bodies), and every business key is AES-GCM-hex-encoded, roughly doubling its size. When the throw happens inside a React event handler — `TasksPage.saveTask` (line 104), `SettingsPage` submit (line 120), `MedicationsPage.persist`, `PayrollPage.savePayroll` (line 545) — it propagates uncaught and React 18 unmounts the entire tree: the user gets a blank white page at the exact moment they pressed "save", with their input gone and no explanation. Only `DocumentsPage.saveDocument` wraps its persist in `try`/`catch`; `DocumentsPage.removeDocument` does not.
- **Fix:** Add a top-level `ErrorBoundary` in `main.tsx` that renders a Hebrew recovery screen instead of a blank page, and make `writeBusinessItem` throw a typed `StorageWriteError` that every `persist()` catches and surfaces as an inline error instead of a success message.
- **Confidence:** CONFIRMED

---

### WEB-07

**[HIGH] Fire-and-forget mutations: a failed save shows the user nothing at all**

_Area: Frontend · source: [`02-frontend.md`](02-frontend.md)_

- **ID:** WEB-07
- **File:** apps/web/src/pages/case/ProductCompletionPanel.tsx:157, apps/web/src/pages/case/CollaborationPanel.tsx:82, apps/web/src/pages/WorkerPortalPage.tsx:118-124
- **What:** Several write paths call an API function with `void`/bare `async` and no `catch`, no busy state and no result UI.
- **Why it matters:** Enumerated instances, all silent on failure: `ProductCompletionPanel.tsx:157` `void confirmAssistantChecklist(caseId, answer.proposedChecklist!)` — the "create tasks" button; `:162`/`:286` `void escalate()` (creates a professional review); `:135` `void ask()` (try/finally, no catch); `:252` `void loadHistory()`. `CollaborationPanel.tsx:82,104` `void put(...)` for responsibility and task assignment, and `:154-161` the worker-request status `<select>` whose `onChange` awaits a PATCH with no catch — because the select is controlled by `data`, a failed PATCH makes the value snap back with no message, reading as "the app ignored my click". `WorkerPortalPage.tsx:118` (payment acknowledgement — a legally-loaded act), `:189` (new worker request) and `:245` (save preferences) are all unguarded `async` handlers; "save preferences" never confirms success or failure under any circumstance. Every one of these is also an unhandled promise rejection.
- **Fix:** Give each mutation the `'saving' | 'saved' | 'error'` treatment `AutomationPanel.tsx:29-42` already models correctly, and disable the control while in flight.
- **Confidence:** CONFIRMED

---

### WEB-08

**[HIGH] Document save has no double-submit guard — one impatient double-tap creates two documents and two uploads**

_Area: Frontend · source: [`02-frontend.md`](02-frontend.md)_

- **ID:** WEB-08
- **File:** apps/web/src/pages/DocumentsPage.tsx:79-121, apps/web/src/pages/DocumentsPage.tsx:251-253
- **What:** `saveDocument` is `async` (it awaits `saveDocumentFile`, which uploads the whole file), but the submit button has no `disabled` state and `resetForm()` only runs after the await resolves.
- **Why it matters:** For a new document `existing` is `undefined`, so each submit mints a fresh `crypto.randomUUID()`. On a slow mobile connection uploading a 10 MB passport scan, a second tap while the first request is in flight produces two ids, two `PUT /workspace/files/...` uploads, and two `MvpDocument` rows for the same file. The user then sees a duplicated document card and no way to know which is which. `removeDocument` (line 144) is likewise unguarded and, on API failure, produces an unhandled rejection with no message and no state change.
- **Fix:** Add an `isSaving` state, `disabled={isSaving}` on the submit button, and derive the document id once before the first submit. Wrap `removeDocument`'s await in `try`/`catch` with a surfaced error.
- **Confidence:** CONFIRMED

---

### WEB-09

**[HIGH] A failed refetch is reported as a failed save, and none of these POSTs are idempotent — retrying creates duplicates**

_Area: Frontend · source: [`02-frontend.md`](02-frontend.md)_

- **ID:** WEB-09
- **File:** apps/web/src/pages/case/CaseContactsSection.tsx:40-50, apps/web/src/pages/case/CaseTasksSection.tsx:64-73, apps/web/src/pages/case/CaseDocumentsSection.tsx:96-111, apps/web/src/pages/FamilyAccessPage.tsx:61-85
- **What:** Each handler does `await mutate(); setState(await list()); reset();` inside one `try`, so a failure of the _list_ call after a _successful_ mutation lands in the same `catch` and shows "adding failed"; and `addCaseContact` / `createCaseTask` / `uploadCaseDocument` / `inviteFamilyMember` send no `idempotency-key` header (compare `startVisaRenewal`, `createBinderExport`, `savePayrollEntry`, which all do).
- **Why it matters:** The contact/task/document was created, the form was never reset, and the user is told it failed — so they press submit again and get a duplicate contact, a duplicate task, or a second upload of the same passport scan. The same holds for a request that succeeds server-side but whose response is lost to a mobile network drop. In `FamilyAccessPage.submitInvitation` the fields are cleared _before_ `await load()`, so a `load()` failure shows a generic error with the typed name and email already gone, and the retry hits `FAMILY_MEMBER_EXISTS`.
- **Fix:** Separate the mutation `try` from the refetch `try` — a refetch failure should show "saved, could not refresh the list", not "failed". Add a per-submission `idempotency-key` to all four POSTs, generated once per form submission attempt (not per request).
- **Confidence:** CONFIRMED

---

### WEB-10

**[HIGH] Sign-out can fail silently, leaving the user signed in and their PII cache on a shared device**

_Area: Frontend · source: [`02-frontend.md`](02-frontend.md)_

- **ID:** WEB-10
- **File:** apps/web/src/AppShell.tsx:181, apps/web/src/auth/auth-context.tsx:297-311
- **What:** `signOut()` returns `false` without side effects when `flushWorkspaceSync()` fails or when Supabase returns an error, and all four call sites invoke it as `onClick={() => void auth.signOut()}` with no handling of the return value.
- **Why it matters:** `flushWorkspaceSync` returns `false` whenever the pending snapshot could not be saved (offline, expired token, `unreadableKeys > 0`, version conflict) — a realistic state, since the sync banner already exists for it. The user taps "התנתקות", **nothing at all happens on screen**, and they walk away from a clinic or family computer believing they signed out. The session stays live, `caredesk.mvp.*` keeps every ID number, passport number, medication list and payroll record, and the sessionStorage decryption key is still present so the next person in that tab can read all of it. The other three call sites (AppShell.tsx:300, FamilyAccessPage.tsx:132, ClientsPage.tsx:98, AccountFrozenGate.tsx:72) have the same gap.
- **Fix:** Surface the failure — a modal offering "sign out anyway (unsaved changes on this device will be lost)" versus "retry saving" — and never leave the button appearing to have done nothing.
- **Confidence:** CONFIRMED

---

### WEB-11

**[HIGH] The canonical case module is unreachable: no route creates a case, so the case, binder and visa screens are dead ends**

_Area: Frontend · source: [`02-frontend.md`](02-frontend.md)_

- **ID:** WEB-11
- **File:** apps/web/src/App.tsx:352, apps/web/src/pages/OpenCasePage.tsx:21, apps/web/src/pages/EmergencyBinderPage.tsx:89-103
- **What:** `OpenCasePage` — the only component that calls `openEmploymentCase()` — is never referenced by any route (grep confirms: only its own file and its test), and `/cases/new` is explicitly `<Navigate to="/" replace />`.
- **Why it matters:** No user can create an `EmploymentCase`, so `/cases/:caseId` (and with it `CaseContactsSection`, `CaseTasksSection`, `CaseDocumentsSection`, `CaseTimelineSection`, `VisaRenewalSection`, `CollaborationPanel`, `ProductCompletionPanel`, `CanonicalPayrollIntelligence`) is reachable only by pasting a UUID. `EmergencyBinderPage`, which _is_ in the mobile nav ("תיק חירום"), loads `listEmploymentCases()` and will show "לא נמצא תיק העסקה פעיל" to every real user — a headline feature that is permanently empty. Meanwhile the same business facts exist twice: contacts, tasks, documents and payroll all have a local MVP implementation and a canonical one, with no linkage or reconciliation except the manual migration widgets inside `CanonicalPayrollIntelligence`.
- **Fix:** Either route `OpenCasePage` and drive case creation from the end of onboarding (mapping the local client to the created case id and storing it), or remove the unreachable canonical screens from the shipped bundle and the nav so the product does not advertise features no user can reach.
- **Confidence:** CONFIRMED

---

### WEB-12

**[HIGH] Visa renewal is implemented twice, inconsistently, and its only workflow screen demands raw UUIDs with no way to advance a workflow**

_Area: Frontend · source: [`02-frontend.md`](02-frontend.md)_

- **ID:** WEB-12
- **File:** apps/web/src/pages/case/VisaRenewalSection.tsx:245-292, apps/web/src/storage/mvp-storage.ts:614-643
- **What:** The consumer-facing visa model is a single date field (`profile.visaRenewalDate`) that auto-generates a local task (`system-visa-renewal`); the canonical model is a server workflow with statuses `not_started|active|blocked|completed|cancelled`, RACI assignments, blockers and evidence. Nothing connects them, and the only canonical UI is a "start" form asking the user to type `templateVersionId`, `currentAuthorizationId`, `stepKey`, `responsibleId` and `accountableId` as raw UUIDs/keys.
- **Why it matters:** (a) A user who completes the local visa task in `TasksPage` has changed nothing in the canonical workflow, and vice versa — the two representations can disagree indefinitely about whether the visa renewal is done. (b) The start form is an internal/admin surface shipped on a customer screen; a 60-year-old employer cannot supply a template version UUID, so the workflow can never legitimately be started from the product. (c) There is no UI to transition a workflow at all — no complete, cancel, resolve-blocker or link-renewed-authorization action — so a workflow that reaches `blocked` is a permanent dead end the user can only look at. The screen renders `assignment.assigneeId` and `linkedRenewedAuthorizationId` as bare UUIDs to the user.
- **Fix:** Pick one visa-renewal source of truth. If canonical: derive `templateVersionId` and `currentAuthorizationId` server-side or from a picker, resolve assignees from the family-membership list by name, add the transition actions, and drive `profile.visaRenewalDate` / the local task from the workflow's `evaluation.dueDate`. If local: remove the canonical section from the customer surface.
- **Confidence:** CONFIRMED

---

### WEB-13

**[HIGH] The collaboration screen is hardcoded English with raw snake_case labels in a Hebrew RTL product**

_Area: Frontend · source: [`02-frontend.md`](02-frontend.md)_

- **ID:** WEB-13
- **File:** apps/web/src/pages/case/CollaborationPanel.tsx:70-74, apps/web/src/pages/case/CollaborationPanel.tsx:118-168
- **What:** "Family collaboration", "Responsibilities", "Task assignments", "Worker requests", "No open requests.", "Unassigned", "Status", "In review", "Accept", "Reject", "Resolve", "Loading collaboration…", "Collaboration could not be loaded." are English literals, and the responsibility labels are rendered as `kind.replaceAll('_', ' ')` → "case management", "documents compliance", "visa authorization".
- **Why it matters:** The document is `<html lang="he" dir="rtl">` and the target user is a Hebrew-speaking family member in their 50s–60s. This screen is unusable for them: English labels inside an RTL layout, raw enum keys as field names, and untranslated `request.request_type` / `request.status` values shown verbatim. The bilingual `role="alert"` error message is also English-only. This is the one screen in the app that assigns who is responsible for what in the family — precisely the content that must be readable.
- **Fix:** Move every string in this file to `packages/i18n` (`he.json` already has the `collaboration.*` namespace — `collaboration.fromCaregiver` etc. are used here, so the surrounding chrome was simply never extracted) and translate the responsibility, request-type and status enums.
- **Confidence:** CONFIRMED

---

### API-05

**[MEDIUM] Authorization denials inside automation handlers surface as 500 and are never logged as security events**

_Area: Backend API · source: [`01-backend-api.md`](01-backend-api.md)_

- **ID:** API-05
- **File:** apps/api/src/routes/product-differentiation.ts:421-461 and apps/api/src/routes/event-action-plans.ts:244-339
- **What:** `authorizeCase` only checks `employment_case:read`, which `viewer` and `family_member` hold (container.ts:167-190). The `task:create` check happens later inside `container.createTask.execute`, and the surrounding `catch` re-throws the `AuthorizationError` after calling `fail()`, so it reaches the generic error handler.
- **Why it matters:** A `viewer` POSTing `/cases/:id/assistant/checklist-confirmations` or `/cases/:id/event-plans` gets `500 INTERNAL_ERROR` instead of `403 FORBIDDEN`, `sendError`'s `securityEvent: 'authorization_denied'` warn line (routes/http-errors.ts:12-23) is never emitted, and each attempt leaves a `failed` row in `automation_execution_receipt`. A privilege-probing client is invisible in the logs and looks like a server fault on the dashboard.
- **Fix:** Catch `AuthorizationError` in both handlers and return `sendError(request, reply, 403, 'FORBIDDEN')`; better, perform the `task:create` authorization check before `claim()` so no receipt is burned.
- **Confidence:** CONFIRMED

---

### API-06

**[MEDIUM] Wave-5 routes swallow every error into a fixed status code, masking both authorization denials and outages**

_Area: Backend API · source: [`01-backend-api.md`](01-backend-api.md)_

- **ID:** API-06
- **File:** apps/api/src/routes/wave5.ts:184-212 (also lines 69-71, 94-96, 118-120, 135-137, 146-148, 162-166, 220-224, 243-247)
- **What:** Ten handlers use a bare `catch { return sendError(..., <fixed status>) }` with no discrimination of the thrown error.
- **Why it matters:** `PATCH /worker-requests/:requestId` maps _everything_ to `409 INVALID_STATE_TRANSITION` — including `manager_required`, which `Wave5Service.updateRequest` throws before any state is read (wave5-service.ts:529). A viewer attempting to approve a worker's vacation request is told the state transition is illegal, is never recorded as `authorization_denied`, and an auditor reading the logs sees no denial. The same blanket catch turns `PUT /cases/:id/responsibilities/:kind` failures (`case_not_found`, `invalid_assignee`, `idempotency_conflict`, and the SQLSTATE 42501 from API-01) into an indiscriminate `403`, so the total breakage in API-01 would present in production as "permissions are wrong" rather than as an error worth paging on.
- **Fix:** Give `Wave5Service` typed errors (or reuse the `message === 'manager_required'` mapping the payroll/binder routes already use) and map them explicitly: `manager_required` → 403, `case_not_found`/`task_not_found` → 404, `invalid_transition` → 409, `idempotency_conflict` → 409, everything else re-thrown to the error handler so it is logged and returns 500.
- **Confidence:** CONFIRMED

---

### API-07

**[MEDIUM] Every production hardening rule is keyed on `NODE_ENV === 'production'`, and nothing asserts it is set**

_Area: Backend API · source: [`01-backend-api.md`](01-backend-api.md)_

- **ID:** API-07
- **File:** apps/api/src/env.ts:6 (guards at 106-116, 164-170, 184-190; consumers at apps/api/src/container.ts:360-418 and apps/api/src/create-server.ts:68-70)
- **What:** `NODE_ENV: nodeEnvSchema.default('development')`. Every fail-closed rule in the schema, plus the CORS narrowing and the synthetic-identity seeding, is conditioned on that value being literally `'production'`. `DEPLOYMENT.md` never lists `NODE_ENV` among the variables to set.
- **Why it matters:** A deployment (self-hosted, a container, a non-Vercel host) that leaves `NODE_ENV` unset boots "successfully" with: `WORKSPACE_ENCRYPTION_KEY` no longer required for a live `DATABASE_URL` (env.ts:184) — so real tenant workspaces are written to Postgres unencrypted; `BILLING_PROVIDER=mock` accepted (env.ts:164); the independent backup destination for document storage no longer required (env.ts:106); `MockAuthService` seeded with the long-lived `dev-local-token` owner session (container.ts:360-368); and CORS widened to any RFC-1918 origin (create-server.ts:72-80). `/ready` reports `ready: true` (container.ts:616) because that check is also gated on the same string. Vercel sets `NODE_ENV=production` automatically, which is the only thing standing between this and a live incident.
- **Fix:** Require `NODE_ENV` explicitly (drop the `.default`) so a missing value fails startup, or add a positive deploy assertion (e.g. refuse to start when `DATABASE_URL` is set and `NODE_ENV !== 'production'` unless an explicit `ALLOW_NON_PRODUCTION_DATABASE` opt-in is present). List `NODE_ENV=production` in DEPLOYMENT.md.
- **Confidence:** CONFIRMED

---

### API-08

**[MEDIUM] MFA on billing and membership management defaults to log-only in production**

_Area: Backend API · source: [`01-backend-api.md`](01-backend-api.md)_

- **ID:** API-08
- **File:** apps/api/src/env.ts:12 and apps/api/src/plugins/mfa.ts:21-23
- **What:** `SENSITIVE_OPERATION_MFA_MODE` defaults to `'report'`; in that mode `requireMfa` logs `securityEvent: 'mfa_required'` and then falls through, allowing the request.
- **Why it matters:** With the default configuration, `POST /family/invitations`, `PATCH /family/members/:id`, `DELETE /family/members/:id`, `POST /billing/payment-method/setup` and `DELETE /billing/subscription` are reachable with a session that never satisfied AAL2. A stolen or replayed access token can invite a new "owner"-adjacent member and remove the real one, or cancel the subscription, with the MFA gate producing only a log line. The comment documents this as a deliberate pilot posture, so the risk is accepted — but it is accepted _by default_, not by explicit configuration, so an operator who never reads env.ts ships with it off.
- **Fix:** Flip the default to `'enforce'` and let the pilot set `'report'` explicitly, or at minimum add `SENSITIVE_OPERATION_MFA_MODE` to the production checklist and surface the current mode in `/ready`'s `checks` block so it is visible.
- **Confidence:** CONFIRMED

---

### API-09

**[MEDIUM] Rate limiting is process-local and therefore ineffective on the serverless deployment target**

_Area: Backend API · source: [`01-backend-api.md`](01-backend-api.md)_

- **ID:** API-09
- **File:** apps/api/src/rate-limit.ts:25-48, wired at apps/api/src/create-server.ts:117-118
- **What:** `InMemoryRateLimiter` keeps counters in a per-process `Map`, and `apps/api/vercel.json` deploys the API as a serverless function (`rewrites` all traffic to `/api/index`), so each concurrent instance holds an independent window. Entries are also never evicted — the map only prunes the array for a key that is re-consumed.
- **Why it matters:** `POST /support/requests` is the only unauthenticated write in the API and its 5-per-15-minutes-per-IP limit (routes/support-requests.ts:9-10) is its sole abuse control before it spends Resend credit; issuing requests in parallel spreads them across cold instances and the limit effectively disappears. The same applies to the assistant (10/min) and evidence-export (5/min) buckets, which exist to bound cost and data egress. Long-lived instances additionally grow the map without bound, one entry per distinct IP/principal/bucket.
- **Fix:** Back the `RateLimiter` port with a shared store (Vercel KV / Upstash Redis) — the interface was designed for exactly this swap — and, for the in-memory fallback, evict keys whose window has fully elapsed. `/ready` already reports `rateLimiting.support: 'memory'`; treat that as not-ready in production.
- **Confidence:** CONFIRMED

---

### API-10

**[MEDIUM] Several collection endpoints are unbounded and unpaginated**

_Area: Backend API · source: [`01-backend-api.md`](01-backend-api.md)_

- **ID:** API-10
- **File:** apps/api/src/routes/case-contacts.ts:111-126 (timeline), apps/api/src/routes/cases.ts:81-100, apps/api/src/routes/product-differentiation.ts:483-495, apps/api/src/payroll-entry-service.ts:79-88, apps/api/src/leave-entry-service.ts (list), apps/api/src/scenario-expense-service.ts (list), apps/api/src/evidence-export-service.ts:230-252
- **What:** These handlers return the full result set with no `limit`, no cursor and no client-supplied page size; the underlying repositories in `packages/db` contain no `LIMIT` on any list query.
- **Why it matters:** `GET /cases/:caseId/timeline` grows monotonically — every task, document, payroll close, worker request and escalation appends a `timeline_event`. A case in its second year returns thousands of rows in one JSON body on every page load; the evidence export additionally joins the entire `audit_event` history for the case. This is a latency and memory cliff on a serverless function with a fixed response budget, and there is no way for a client to recover once a case crosses it. `binder_export_receipt` (`limit 100`), `document_intake_review` (`limit 100`) and `regulation_rule` (`limit 200`) show the intended pattern.
- **Fix:** Add a bounded default limit plus a keyset cursor (`created_at`/`occurred_at` + id) to the timeline, cases, professional-reviews, payroll, leave and scenario list endpoints, and cap the evidence export's collection window.
- **Confidence:** CONFIRMED

---

### API-11

**[MEDIUM] Document intake-review receipt, its audit event and its timeline event are written on three separate connections**

_Area: Backend API · source: [`01-backend-api.md`](01-backend-api.md)_

- **ID:** API-11
- **File:** apps/api/src/routes/case-documents.ts:219-293
- **What:** The `document_intake_review` row is inserted inside one `withTenant` transaction (line 220), then `container.audit.record(...)` (line 272) and `container.timeline.record(...)` (line 286) each open their own transaction afterwards.
- **Why it matters:** If the audit write fails (connection reset, pool exhaustion, the 42501 class of error), the human confirmation receipt is already committed and the request returns 500 — leaving a durable record of a document-AI review decision with no audit event and no timeline entry, which is precisely the evidence the receipt exists to produce. The same three-connection shape means a partially-evidenced review can never be distinguished from a complete one after the fact.
- **Fix:** Write the review row, the `audit_event` and the `timeline_event` in a single `withTenant` block (the pattern `CanonicalIntelligenceService.close` and `PgBinderExportService.create` already use), and drop the in-memory fallback branch from the audited path.
- **Confidence:** CONFIRMED

---

### API-12

**[MEDIUM] The global error handler echoes the raw error message for any error carrying a non-500 status code**

_Area: Backend API · source: [`01-backend-api.md`](01-backend-api.md)_

- **ID:** API-12
- **File:** apps/api/src/plugins/error-handler.ts:19-21
- **What:** `message: statusCode === 500 ? 'Unable to complete the request' : error.message` — every error that arrives with a `statusCode` other than 500 has its internal message returned verbatim to the client, along with `error.code`.
- **Why it matters:** This is the one place the codebase's own rule ("the message never leaks internals to the client", routes/http-errors.ts:26-28) is not applied. Fastify's own errors already flow through here (`FST_ERR_CTP_BODY_TOO_LARGE`, `FST_ERR_CTP_INVALID_MEDIA_TYPE`), and any future library error or thrown object that happens to carry a `statusCode` — provider SDKs commonly do, and `CardcomGatewayError` messages embed `response.Description` from Cardcom (billing/cardcom-gateway.ts:205-211) — becomes a response body. It is a latent leak that widens silently as dependencies change, and it is inconsistent with every hand-written route in the app.
- **Fix:** Always return `'Unable to complete the request'` and rely on `code` + `correlationId`, matching `sendError`. Keep the full message in the (already `safeErrorDetails`-filtered) log line only.
- **Confidence:** CONFIRMED

---

### DB-07

**[MEDIUM] Migration 0030 adds a validated CHECK with no `NOT VALID`, so it fails on any database with an existing resolved review**

_Area: Database · source: [`03-database.md`](03-database.md)_

- **ID:** DB-07
- **File:** `database/migrations/0030_human_escalation_lifecycle.sql:36-38`
- **What:**
  ```sql
  alter table professional_review_request
    add constraint review_resolution_note_consistent
    check (status <> 'resolved' or resolution_note is not null);
  ```
  `resolution_note` is added two statements earlier (line 32) as a nullable column with no
  backfill. A constraint added without `NOT VALID` is validated immediately against all
  existing rows. Migration 0020 demonstrates the team knows the `NOT VALID` + explicit
  `VALIDATE` pattern (lines 35-55) and uses it correctly there.
- **Why it matters:** `professional_review_request` was created in 0027 with
  `status … default 'open'` and a `'resolved'` value in its vocabulary. Any tenant that
  resolved a review between 0027 and 0030 has a row with `status = 'resolved'` and
  `resolution_note is null`, which makes migration 0030 abort. Combined with DB-02 (0030 also
  never records itself), a deployment hitting this fails, rolls back, and every later
  migration is blocked. It also takes an ACCESS EXCLUSIVE lock for the full validation scan.
- **Fix:** Add with `NOT VALID`, backfill `resolution_note` for existing resolved rows (e.g.
  a `'migrated'` sentinel meeting the 3-2000 char length constraint), then
  `alter table … validate constraint …` as a separate statement, exactly as 0020 does.
- **Confidence:** LIKELY — confirmed as a code fact; whether any resolved row exists is
  environment-dependent (`select count(*) from professional_review_request where status =
'resolved' and resolution_note is null;`).

---

### DB-08

**[MEDIUM] `idempotency_record` stores full API response bodies forever with no expiry and no purge path**

_Area: Database · source: [`03-database.md`](03-database.md)_

- **ID:** DB-08
- **File:** `database/migrations/0021_visa_renewal_persistence.sql:199-208,220-221,275`;
  `packages/db/src/visa-renewal-repository.ts:267-282`
- **What:** The table is
  ```sql
  create table idempotency_record (
    tenant_id …, operation text, idempotency_key text, request_hash text,
    response jsonb not null, created_at …, expires_at timestamptz,
    primary key (tenant_id, operation, idempotency_key)
  );
  ```
  `expires_at` is nullable with **no default**. `PgIdempotencyRepository.saveIdempotency`
  (and every other writer — `wave5-service.ts:79-83`, `binder-export-service.ts:271-273`,
  `payroll-entry-service.ts:166-168`, `regulation-rule-service.ts:407-409`) inserts without
  it, so it is always NULL. The partial index
  `idempotency_record_expiry on idempotency_record (expires_at) where expires_at is not null`
  (line 220) therefore indexes zero rows. And the grant is `select, insert` only (line 275) —
  the application has no DELETE.
- **Why it matters:** `response` is the complete serialized API response for the operation:
  a payroll entry (salary figures), a binder export receipt (document ids and manifest), a
  regulation rule, a worker request. That is customer financial and identity-adjacent data,
  duplicated indefinitely in a second table, growing monotonically with every mutating request,
  with no retention policy, no expiry, and no way for the application or a data-erasure
  workflow to remove it. `database/migrations/sensitive-record-migration-requirements.md:30-32`
  requires documented "retention, erasure, legal-hold" rules per record type; this table has
  none. It also silently enlarges the blast radius of any database read beyond the canonical
  tables that were carefully designed to minimise it.
- **Fix:** Set `expires_at timestamptz not null default (now() + interval '30 days')` for new
  rows, backfill existing rows from `created_at`, and add an operator-run (owner-role) purge
  job for expired rows — the existing partial index is already the right shape for it. Do not
  grant DELETE to `caredesk_app`. Consider storing a response _hash_ plus a minimal
  reconstructable envelope rather than the whole body.
- **Confidence:** CONFIRMED.

---

### DB-09

**[MEDIUM] The live RLS guard does not cover five of the tables it is supposed to protect**

_Area: Database · source: [`03-database.md`](03-database.md)_

- **ID:** DB-09
- **File:** `packages/db/src/rls-check.ts:29-80` (`ALL_TENANT_TABLES`)
- **What:** `ALL_TENANT_TABLES` is the list the "all tenant-owned and control tables retain
  enabled, forced RLS" assertion iterates (lines 498-512). Comparing it against the 55
  tenant-owned tables in the schema, five are missing:
  `professional_review_request` (0027), `ai_action_confirmation` (0027), `leave_entry` (0033),
  `scenario_expense` (0034), `tenant_workspace_history` (0035). Note
  `professional_review_transition` _is_ listed while its parent
  `professional_review_request` is not, which reads like a copy/paste slip.
- **Why it matters:** The schema is correct today, so this is not itself a leak. But
  `database/README.md:113-125` and `rls-test-harness-design.md:34-37` both present
  `pnpm db:rls-test` as the coverage gate that catches exactly the class of defect migrations
  0004 and 0005 were written to fix. A future migration that forgets `FORCE` or `WITH CHECK`
  on `leave_entry` or `tenant_workspace_history` passes CI. `tenant_workspace_history` is the
  highest-value omission: it holds every historical version of every tenant's complete
  workspace.
- **Fix:** Derive `ALL_TENANT_TABLES` from the database instead of a hand-maintained literal —
  query `pg_class` for every table in `public` that has a `tenant_id` column and assert
  `relrowsecurity and relforcerowsecurity` plus a policy with both `polqual` and
  `polwithcheck`. That makes the gate self-maintaining, which is what
  `rls-test-harness-design.md:34-37` actually specifies ("generate the list … and fail the
  test suite if any table lacks a corresponding RLS test").
- **Confidence:** CONFIRMED.

---

### DB-10

**[MEDIUM] Actor columns (`created_by`, `updated_by`, `closed_by`, `linked_by`, `recorded_by`, `confirmed_by`, `changed_by`) carry no foreign key anywhere in the schema**

_Area: Database · source: [`03-database.md`](03-database.md)_

- **ID:** DB-10
- **File:** `database/migrations/0003_care_employment_core.sql:15,17` (pattern origin);
  `0023_monthly_payroll_close.sql:14`, `0028_canonical_payroll_entry.sql:28-29`,
  `0031_binder_export_receipt.sql:26`, `0030_human_escalation_lifecycle.sql:51`,
  `0033_governed_leave_ledger.sql:20-21`, `0034_scenario_expense.sql:15-16`, and ~20 more
- **What:** These are all `uuid` (frequently `not null`) with no `references app_user (id)`
  and no composite `(tenant_id, …) references tenant_membership (tenant_id, id)`. Contrast
  `tenant_workspace.updated_by uuid not null references app_user (id)` (0011:10) and
  `workspace_file.updated_by` (0012:12), which _do_ have the FK — so the omission is
  inconsistent rather than a uniform policy. `worker_portal_access.user_id` also has a real FK
  (0025:48).
- **Why it matters:** Evidence rows — a payroll close receipt, a binder export receipt, a
  review transition — assert "user X did this". With no FK, `created_by` can hold a UUID that
  matches no `app_user`, or (worse for isolation reasoning) a user id belonging to a different
  tenant, and nothing at the database layer notices. For `binder_export_receipt` and
  `payroll_month_close`, both explicitly framed as immutable evidence, an unresolvable actor
  id makes the evidence unable to answer the question it exists to answer.
- **Fix:** For actor columns that are semantically "a member of this tenant", use the composite
  FK to `tenant_membership (tenant_id, id)` — the candidate key already exists from
  `tenant_membership_tenant_unique` (0020:32-33). For genuinely global identities, use
  `references app_user (id)` as 0011/0012 already do. Add with `NOT VALID` + `VALIDATE` per
  0020's pattern so existing data surfaces rather than blocking the deploy.
- **Confidence:** CONFIRMED.

---

### DB-11

**[MEDIUM] `document.owner_id` is a polymorphic reference with no foreign key and no constraint tying it to `owner_type`**

_Area: Database · source: [`03-database.md`](03-database.md)_

- **ID:** DB-11
- **File:** `database/migrations/0008_documents.sql:27-34`
- **What:** `owner_type text not null check (owner_type in ('employment_case',
'care_recipient', 'employer', 'caregiver', 'organization', 'contact'))` paired with a bare
  `owner_id uuid` (nullable, no FK). Every _other_ reference in this schema uses a composite
  same-tenant FK; this is the one polymorphic escape hatch.
- **Why it matters:** A passport document can be recorded as `owner_type = 'caregiver'` with
  an `owner_id` that is a `contact` id, a deleted caregiver's id, or a UUID from another
  tenant, and the database accepts it. `document.sensitivity` and downstream masking decisions
  are made per-document, but "which person is this passport about" is unverifiable. Because
  `document` also carries a DELETE grant while `document_version` does not, orphaning is
  one-directional but the dangling `owner_id` persists in the evidence trail.
- **Fix:** Either normalise into per-owner-type nullable FK columns with a CHECK that exactly
  one is set (the pattern `workflow_assignment` already uses at 0021:171-180 for
  `assignee_membership_id` / `assignee_contact_id`), or add a trigger-based same-tenant
  existence check. The `workflow_assignment` precedent means the house style already has an
  answer for this.
- **Confidence:** CONFIRMED.

---

### DB-12

**[MEDIUM] No index on `worker_portal_access.user_id`, which is the worker-portal authentication hot path**

_Area: Database · source: [`03-database.md`](03-database.md)_

- **ID:** DB-12
- **File:** `database/migrations/0025_wave5_collaboration_engagement.sql:33-56`;
  consumed by `database/migrations/0026_wave5_worker_authorization.sql:12-14` and
  `apps/api/src/collaboration/wave5-service.ts:110-113`
- **What:** `worker_portal_access` has `unique (tenant_id, id)`,
  `unique index worker_access_active_case on (tenant_id, employment_case_id, caregiver_id)
where status in ('invited','active')`, and the primary key on `id`. The
  `SECURITY DEFINER` resolver runs
  `select distinct access.tenant_id from worker_portal_access access
 where access.user_id = p_user_id and access.status = 'active'` — leading on `user_id`,
  for which no index exists. Because the function is `SECURITY DEFINER` it runs with
  BYPASSRLS, so there is no tenant predicate to narrow the scan either: it is a full
  sequential scan of every tenant's rows on **every authenticated worker request**.
- **Why it matters:** This is the first query of the worker portal request lifecycle. It grows
  linearly with total platform worker accounts across all tenants, not per-tenant, so it
  degrades in exactly the dimension that scaling makes worse.
- **Fix:** `create index worker_portal_access_by_user on worker_portal_access (user_id)
where status = 'active';` Also consider `notification_intent`/`document_intake_review`
  secondary access paths (`document_intake_review` has only its `(tenant_id, id)` primary key,
  so a lookup by `document_version_id` scans the tenant's rows).
- **Confidence:** CONFIRMED.

---

### DB-13

**[MEDIUM] Six reference tables were created after 0015's lockdown; the `anon`/`authenticated` revoke may not have applied to them**

_Area: Database · source: [`03-database.md`](03-database.md)_

- **ID:** DB-13
- **File:** `database/migrations/0015_lock_down_supabase_public_schema.sql:7-17` vs
  `database/migrations/0021_visa_renewal_persistence.sql:5-69`
- **What:** 0015 revokes existing grants (`revoke all privileges on all tables in schema
public from anon, authenticated`) and then sets
  `alter default privileges **for role postgres** in schema public revoke all privileges on
tables from anon, authenticated`. The default-privileges clause only affects objects created
  by role `postgres`. Migrations run as `DATABASE_ADMIN_URL`, which through Supavisor is
  `postgres.<project-ref>` — this authenticates _as_ `postgres`, so the clause should hold —
  but on the CI path (`rls-check-ci.ts:24-40`) the connecting role is `caredesk` and
  `postgres` is created as a bare NOLOGIN placeholder, so tables created there fall outside
  the default-privileges rule entirely. The six tables from 0021
  (`workflow_template`, `workflow_template_version`, `workflow_template_step`,
  `visa_rule_definition`, `visa_rule_version`, `visa_rule_source`) plus every table from
  0022-0035 were created after 0015 and have no RLS to fall back on.
- **Why it matters:** If the default-privileges revoke did not apply, Supabase's own
  `alter default privileges … grant all on tables to anon, authenticated` gives the browser
  PostgREST role direct read access to those tables. For the six reference tables that is
  low-value (approved rule text), but the same reasoning covers the _tenant-owned_ tables
  created after 0015 — those are saved only by their forced RLS policies, not by grant
  hygiene. `rls-check.ts:514-528` does assert zero `anon`/`authenticated` grants exist, which
  is the right check; it just is not run on every deploy.
- **Fix:** Add an explicit `revoke all privileges on all tables in schema public from anon,
authenticated;` as the last statement of every migration that creates a table (0017:28,54
  already does this for two tables), or make the assertion in `rls-check.ts:514-528` part of
  the required deploy gate rather than an optional local command.
- **Confidence:** NEEDS-VERIFICATION — run
  `select table_name, grantee from information_schema.role_table_grants where table_schema =
'public' and grantee in ('anon','authenticated');` against the live database.

---

### DB-14

**[MEDIUM] Migration 0032 satisfies its own "review evidence" constraint with a placeholder**

_Area: Database · source: [`03-database.md`](03-database.md)_

- **ID:** DB-14
- **File:** `database/migrations/0032_regulation_rule_lifecycle.sql:50-51,109-151`
- **What:** The table defines
  `regulation_rule_review_consistent check ((status in ('approved','active','retired')) =
(reviewed_by is not null and reviewed_at is not null))` — "Reviewed states must carry their
  review evidence (fail closed)". The seed then inserts four rules with `status = 'approved'`
  where `reviewed_by` is set to the literal string
  `'תוכן ייחוס ראשוני של CareDesk — טעון אימות על ידי גורם מקצועי'`
  ("CareDesk preliminary reference content — requires professional verification"), i.e. a
  disclaimer occupying the reviewer-name field, and `reviewed_at = now()`.
- **Why it matters:** The constraint is intended to guarantee that any approved rule names a
  human reviewer. Seeding it with a disclaimer string makes the constraint pass while the
  invariant it encodes is false, and the resulting rows are `status = 'approved'` in every
  existing tenant — one manager click away from `active`, at which point
  `apps/api/src/regulation-rule-service.ts` feeds them to assistant/wizard context as
  reviewed content. For Israeli labour-law statements presented to families, "who reviewed
  this" is the audit question that matters most.
- **Fix:** Seed at `status = 'draft'` (which the constraint permits with NULL reviewer) and
  require a real reviewer name on the transition to `approved`. Alternatively add a CHECK
  that `reviewed_by` does not match the disclaimer sentinel. Separately: the seed uses
  `cross join tenant`, so tenants created after 0032 receive no rules at all — there is no
  trigger or bootstrap path — which is an inconsistency worth resolving in the same change.
- **Confidence:** CONFIRMED.

---

### DB-15

**[MEDIUM] The in-memory fallback enforces none of the database's protective constraints, so tests cannot catch violations of them**

_Area: Database · source: [`03-database.md`](03-database.md)_

- **ID:** DB-15
- **File:** `packages/infrastructure/src/mocks/in-memory-audit-service.ts:3-9`,
  `in-memory-task-repository.ts:6-27`, `in-memory-workspace-file-repository.ts:6-25`
- **What:** `InMemoryAuditService.record` is `this.events.push(event)` — no length caps, no
  denial-requires-reason rule. Postgres enforces
  `audit_event_change_summary_is_a_summary check (length(change_summary) <= 500)`,
  `audit_event_reason_is_short`, `audit_event_purpose_is_a_code` and
  `audit_event_denial_has_reason check (permission_decision <> 'denied' or reason is not
null)` (0009:95-103). `InMemoryTaskRepository.createTask` accepts any
  `employmentCaseId` without checking it exists — Postgres has
  `task_case_same_tenant foreign key (tenant_id, employment_case_id)` (0007:67-69). None of
  the mocks implement CHECK vocabularies, uniqueness, or same-tenant composite FKs.
- **Why it matters:** A route that builds a `changeSummary` longer than 500 characters, or
  records a denial without a reason, passes every API test and then throws
  `violates check constraint` in production — aborting the _entire_ transaction, so the
  business write it accompanied is rolled back too. Because audit writes are deliberately
  bundled into the same transaction as the change they describe
  (`visa-renewal-repository.ts:299-329`, `binder-export-service.ts:254-270`), an over-long
  summary does not just lose the audit row, it loses the customer's action. The mock is
  otherwise conscientious — `InMemoryWorkspaceRepository` explicitly mirrors the destructive-
  shrink guard with a comment saying why (`in-memory-workspace-repository.ts:22-24`) — which
  shows the team already accepts this principle; it just has not been applied to the
  constraint surface.
- **Fix:** Port the audit length caps and the denial-requires-reason rule into
  `InMemoryAuditService.record` (throw, don't truncate), and have `InMemoryTaskRepository` /
  `InMemoryDocumentRepository` reject a case id they have not seen. These are a handful of
  lines each and they convert a class of production-only failure into a test failure.
- **Confidence:** CONFIRMED.

---

### DB-16

**[MEDIUM] There is no implemented erasure or anonymisation path for a tenant**

_Area: Database · source: [`03-database.md`](03-database.md)_

- **ID:** DB-16
- **File:** schema-wide — no `ON DELETE` clause exists in any of the 36 migrations
  (verified by grep); `database/migrations/0009_audit_event.sql:27-39` documents the intent
- **What:** Every FK is `NO ACTION`, and `caredesk_app` holds `DELETE` on only 22 of 55
  tenant-owned tables — never on `timeline_event`, `document_version`, `audit_event`,
  `payroll_month_close`, `payroll_entry`, `leave_entry`, `binder_export_receipt`,
  `idempotency_record` or any of the receipt/transition tables. 0009's header states that
  `audit_event` deliberately omits its tenant FK so that "erasing or anonymising a tenant"
  remains possible while "preserving minimal audit evidence" — but no such workflow exists
  anywhere in `packages/db` or the migrations.
- **Why it matters:** The absence of cascades is the right default and is why nothing can
  silently wipe customer history (a genuine strength — see "What is done well"). The flip
  side is that the product currently _cannot_ honour a deletion request: an owner connection
  attempting `delete from tenant` is blocked by ~40 FK chains, and the correct ordering has
  never been written down or tested. Under Israeli Privacy Protection Law and for any EU
  data subject in `data_region = 'eu-central'`, that is a compliance gap, and the schema
  comments show it was anticipated but not built.
- **Fix:** Write the erasure procedure as an owner-role, tested, ordered script (or a
  `SECURITY DEFINER` function callable only by an operator role) that anonymises rather than
  deletes where evidence must survive, and add it to
  `database/migrations/sensitive-record-migration-requirements.md`'s gate list. The
  `rls-check.ts` cleanup block (lines 557-579) is already a hand-derived, correct deletion
  ordering for the core tables and is a good starting point — but it covers 15 tables, not 55.
- **Confidence:** CONFIRMED.

---

### DOM-13

**[MEDIUM] `packages/schemas` is the shared contract for the early endpoints only — every money and leave endpoint defines its own**

_Area: Domain · source: [`06-domain-logic.md`](06-domain-logic.md)_

- **ID:** DOM-13
- **File:** packages/schemas/src/index.ts:1-10; apps/api/src/routes/payroll-entries.ts:10-43; apps/api/src/routes/leave-entries.ts:10-32; apps/api/src/routes/canonical-product-intelligence.ts:8-25; also scenario-expenses.ts, product-differentiation.ts, wave5.ts, regulation-rules.ts, binder-exports.ts, evidence-exports.ts, support-requests.ts, event-action-plans.ts
- **What:** `packages/schemas` exports eight contracts (employment case, tasks, documents, contacts,
  family access, workspace, billing, visa renewal) and those genuinely are shared with the web app.
  Everything added since — including all of payroll, leave, monthly close and expenses — declares its
  Zod schema locally in the route file. The web app therefore cannot import the contract it must
  satisfy, and does not: `apps/web/src/payroll-calculation.ts` and `mvp-storage.ts` carry their own
  field set (`saturdayPay`, `otherAddition`, `medicalInsuranceDeduction`, `housingDeduction`) that
  does not match the API's (`paidRestDays`, `restDayRate`, `pocketMoney`, `agreedDeductions`) —
  the adapter at `apps/web/src/product-intelligence.ts:133-152` exists purely to translate between
  the two vocabularies.
- **Why it matters:** The mismatch is already load-bearing: two names for the same money, mapped by
  hand, in the layer that decides what gets paid. Any future field added on one side silently does
  not exist on the other. The single-source-of-truth property the package was created for holds for
  the endpoints that need it least.
- **Fix:** Move the payroll/leave/close/expense schemas into `packages/schemas` and import them in
  both the route and the web client. Reconcile the two field vocabularies to one.
- **Confidence:** CONFIRMED

---

### DOM-14

**[MEDIUM] Monthly-close reconciliation tolerance is looser than the DB constraint it feeds**

_Area: Domain · source: [`06-domain-logic.md`](06-domain-logic.md)_

- **ID:** DOM-14
- **File:** apps/api/src/routes/canonical-product-intelligence.ts:20-24; database/migrations/0026_canonical_product_intelligence.sql:8-11
- **What:** The route accepts a close when
  `Math.abs(baseSalary + additions - deductions - total) < 0.01`. The DB then requires exact
  equality on `numeric(12,2)` values after each is rounded to two decimals.
- **Why it matters:** A payload inside the JS tolerance but outside the post-rounding equality is
  accepted by validation and rejected by the database — e.g. `baseSalary: 1000.126, additions: 0,
deductions: 0, total: 1000.12` (difference 0.006, passes) stores `1000.13` vs `1000.12` and
  violates `payroll_month_close_amount_reconciles`. That surfaces as an unhandled DB error, i.e. the
  bare 500 the error-envelope design exists to prevent, on the one operation the user cannot retry
  their way out of. This is the schema-more-permissive-than-the-DB class of bug exactly.
- **Fix:** Round each amount to 2 decimals in the schema `transform` and then require exact equality,
  so validation and constraint agree by construction. (Integer agorot per DOM-04 removes the class
  entirely.)
- **Confidence:** LIKELY (the DB behaviour is standard `numeric` half-away-from-zero rounding; not executed against a live database)

---

### DOM-15

**[MEDIUM] Infrastructure failures during visa-renewal completion are reported as a validation error**

_Area: Domain · source: [`06-domain-logic.md`](06-domain-logic.md)_

- **ID:** DOM-15
- **File:** packages/application/src/use-cases/manage-visa-renewal.ts:265-280
- **What:**
  ```ts
  try { await this.deps.progress.complete({...}); }
  catch { throw new VisaRenewalValidationError('COMPLETION_INVALID'); }
  ```
  A bare catch over the whole persistence call. The underlying SQL guard is good
  (`packages/db/src/visa-renewal-repository.ts:518-533` requires an active/blocked workflow, verified
  evidence, an active non-review-required evaluation, no incomplete steps, no unresolved overlap) —
  so the _rule_ is right; the error handling around it is not.
- **Why it matters:** A dropped connection, a serialisation failure, a typo in the SQL and a genuine
  "you have an unresolved overlap review" all produce the identical `COMPLETION_INVALID` code. The
  user is told their workflow is invalid when the database was merely unavailable, retries, gets the
  same message, and the real cause never reaches an operator. It also erases the distinction the
  error model was built for: domain errors vs bugs.
- **Fix:** Have the repository throw a typed `VisaCompletionRejectedError` when its guarded update
  matches zero rows, and let everything else propagate.
- **Confidence:** CONFIRMED

---

### DOM-16

**[MEDIUM] Monthly billing date drifts permanently after any month shorter than the anchor day**

_Area: Domain · source: [`06-domain-logic.md`](06-domain-logic.md)_

- **ID:** DOM-16
- **File:** database/migrations/0014_product_billing.sql:205 (`next_charge_on = (v_period + interval '1 month')::date`)
- **What:** Postgres clamps `date + interval '1 month'` to the last valid day: `2026-01-31` → `2026-02-28`.
  The next advance is computed from the clamped value, so it never returns to 31.
- **Why it matters:** A subscription anchored on the 29th, 30th or 31st permanently migrates to the
  28th after its first February, charging every subsequent customer two to three days early forever.
  Nothing detects or corrects it because the anchor is the previous charge, not the original date.
- **Fix:** Store the intended day-of-month on the subscription and compute
  `next_charge_on` from it each period (clamping only for the short month itself), rather than
  chaining from the previous value.
- **Confidence:** LIKELY (standard documented Postgres interval-arithmetic behaviour; not executed)

---

### DOM-17

**[MEDIUM] A calendar-day expiry stored at UTC midnight reads as expired for the whole of its final valid day**

_Area: Domain · source: [`06-domain-logic.md`](06-domain-logic.md)_

- **ID:** DOM-17
- **File:** packages/application/src/use-cases/manage-case-documents.ts:116-118, 91 (`if (expiry <= now.getTime()) return 'expired'`); same pattern for due dates at manage-case-tasks.ts:47-49
- **What:** `expiresOn: '2026-09-01'` is persisted as `2026-09-01T00:00:00.000Z` and compared with
  `expiry <= now`. Israel is UTC+2/+3, so that instant is 02:00/03:00 on 1 September local — and the
  status is `expired` from then onward, i.e. for essentially the entire day.
- **Why it matters:** Israeli permits and visas state a _last valid date_ (תוקף עד). Treating that
  date's start as the expiry instant reports a still-valid permit as expired a full day early, which
  in this product means an unnecessary escalation, an unnecessary bureau call, and erosion of trust
  in the alerts that matter. The same choice for task `dueAt` makes a task due today "overdue" from
  03:00 that morning. The inline comments show the timezone was thought about in one direction
  (never shifting _earlier_) but the inclusive/exclusive semantics of the boundary were not settled.
- **Fix:** Decide and document whether a stored date is the last valid day or the first invalid day,
  and compare against end-of-day in `Asia/Jerusalem` accordingly. A `packages/domain/date.ts` with
  `israelStartOfDay` / `israelEndOfDay` gives every caller one answer.
- **Confidence:** LIKELY (the comparison is certain; whether `expiresOn` means "last valid day" is a product decision I could not confirm from the code)

---

### DOM-18

**[MEDIUM] Governed rule selection picks the highest version string, not the rule effective at the as-of date**

_Area: Domain · source: [`06-domain-logic.md`](06-domain-logic.md)_

- **ID:** DOM-18
- **File:** packages/rules/src/evaluator.ts:69-81
- **What:** Among rules sharing an id that pass the effective-date filter, the winner is
  `current.version.localeCompare(rule.version, undefined, {numeric: true}) < 0` — highest version
  string, with `effectiveFrom` used only as an eligibility gate, never as the tie-breaker. Also,
  `rule.effectiveUntil < asOf` is a string comparison: if a caller passes a full timestamp
  (`'2026-01-01T10:00:00Z'`) while `effectiveUntil` is a date (`'2026-01-01'`), the comparison is
  true and the rule is treated as expired on its own final valid day.
- **Why it matters:** This is the machinery intended to make historical recalculation correct. If
  v3 is a _correction_ effective from 2027 and v2 is the rule in force during 2026, evaluating
  `asOf: '2026-06-01'` correctly excludes v3 (its `effectiveFrom` gate fires) — but if v3 were
  back-dated, or if two versions overlap in effect, the higher version number silently wins over the
  later effective date. The `asOf` mixing bug bites whichever caller first passes a timestamp
  instead of a date, and there is no runtime check that `asOf` is a plain date.
- **Fix:** Select by latest `effectiveFrom` ≤ asOf, using version only to break exact ties. Normalise
  `asOf` to `YYYY-MM-DD` on entry (or validate with `isoDateSchema`).
- **Confidence:** CONFIRMED (code read; the tie-break path is not exercised by any test)

---

### DOM-19

**[MEDIUM] Idempotency state for outbound notifications lives in a process-local Map**

_Area: Domain · source: [`06-domain-logic.md`](06-domain-logic.md)_

- **ID:** DOM-19
- **File:** packages/application/src/engagement.ts:63,79-80,90
- **What:** `NotificationOrchestrator` keeps `private readonly completed = new Map<string, DeliveryResult>()`
  keyed by `intent.idempotencyKey`, consulted before sending and written after success.
- **Why it matters:** Hidden mutable state inside the application layer, tied to one process's
  lifetime. It resets on every deploy and restart, and is not shared across instances — so the
  idempotency guarantee it appears to give does not survive either. A caregiver or family member
  receives the same WhatsApp/SMS twice after a routine restart. Every other mutation in this codebase
  goes through the durable `IdempotencyRepository`; this one does not, and its in-memory-ness is not
  documented.
- **Fix:** Use `IdempotencyRepository` (the port already exists and is tenant-scoped), or document
  the Map explicitly as a per-process de-dup optimisation and add the durable check behind it.
- **Confidence:** CONFIRMED

---

### DOM-20

**[MEDIUM] Partial-month proration hardcodes Saturday as the rest day and an undocumented divisor**

_Area: Domain · source: [`06-domain-logic.md`](06-domain-logic.md)_

- **ID:** DOM-20
- **File:** apps/web/src/payroll-calculation.ts:60-67, 89
- **What:** `countBaseDays` counts days where `getDay() !== 6`, i.e. excludes Saturdays, and
  proration is `fullSalary * paidDays / daysInMonth` with both terms excluding Saturdays. The rest
  day is a compile-time constant; there is no reference to the rule this implements and no
  effective date.
- **Why it matters:** Israeli law lets a non-Jewish employee choose their weekly rest day — a
  Christian caregiver's is typically Sunday, a Muslim's Friday. For a product whose entire user base
  employs foreign caregivers (the fixtures use `nationality: 'Philippines'`), Saturday is the wrong
  default more often than not, and the divisor changes with it: a mid-month start in a 31-day month
  divides by 26 or 27 depending on which weekday is excluded, moving the prorated salary by tens of
  shekels. The convention itself (excluding rest days from both numerator and denominator, rather
  than the calendar-day or 30-day conventions also used in Israeli practice) is a legal choice made
  silently in a browser file.
- **Fix:** Make the weekly rest day a per-case field (it belongs on `EmploymentCase`), and express
  the proration convention as a dated, sourced rule in `packages/rules` rather than a loop condition.
- **Confidence:** CONFIRMED (the hardcoding is certain; which convention is legally correct is for the legal reviewer)

---

### DR-11

**[MEDIUM] The "binder export" is a receipt plus a browser print — it is not a data export and not a recovery path**

_Area: Backup/DR · source: [`04-backup-dr.md`](04-backup-dr.md)_

- **ID:** DR-11
- **File:** `database/migrations/0031_binder_export_receipt.sql:1-12`;
  `apps/api/src/binder-export-service.ts:5-17`, `:34-38`;
  `apps/web/src/pages/EmergencyBinderPage.tsx:172`;
  `apps/api/src/evidence-export-service.ts:6-25`
- **What:** Assessed honestly: `binder_export_receipt` is exactly what its own migration
  comment says — "durable evidence that a specific, explicitly selected manifest was
  exported for a case: which sections, which document ids, by whom and when, plus a
  deterministic sha256 fingerprint" (`0031:3-7`). It stores section names, document **ids**,
  actor, timestamp and a hash. It stores **no customer data**: "never file bytes, storage
  keys, or sensitive values — ids, section names and status metadata only"
  (`binder-export-service.ts:34`, `0031:22-24`). It is append-only and deliberately carries
  no sharing/link table (`0031:9-12`).
  The export it records is a client-side browser print: `EmergencyBinderPage` calls
  `window.print()` (`apps/web/src/pages/EmergencyBinderPage.tsx:172`). Nothing on the server
  produces a data file. `evidence-export-service.ts` likewise produces a metadata-only
  manifest of audit and timeline events, explicitly excluding "document bytes, storage keys,
  message bodies, extracted field values or AI prompt/completion text" (`:11-15`).
  There is no full-tenant export endpoint — `apps/api/src/routes/` contains no export route
  beyond `binder-exports` and `evidence-exports`. The closest thing is `GET /workspace`,
  which returns the legacy MVP workspace payload to an authenticated owner: real data, but
  the compatibility blob only, with no canonical-table coverage and no document bytes.
  The internal backlog agrees this is unfinished: "secure server-side Binder export" is
  listed under capability hardening (`CareDesk_Claude_Code_Handoff_2026-08-17/04_OPEN_WORK_AND_PRIORITIES.md:56`).
- **Why it matters:** Two consequences. Operationally, a printed PDF held by the customer is
  not a restore path — it cannot be re-imported, it covers a hand-picked subset, CareDesk
  does not retain it, and it excludes the original document files. It should not be counted
  as mitigation for any finding above. Legally, the privacy notice promises data portability
  "in a clean format (CSV/JSON)" via "export from settings" (`CareDesk_Legal_Validation_P0.docx` §5)
  — a capability that does not exist, while `PILOT_RELEASE.md:38` requires export requests to
  have a named operator and a written procedure.
- **Fix:**
  1. Build a server-side, tenant-scoped export producing machine-readable JSON of the
     canonical tables plus a manifest of documents, and either the bytes or signed
     time-limited links. Record it with the existing receipt mechanism.
  2. Until it exists, do not describe the binder as an export or a backup in any
     customer-facing copy, and update the privacy notice's portability row to match reality.
  3. Treat the export as a genuine (if slow) tenant-recovery input once it round-trips —
     which requires an import path, currently absent.
- **Confidence:** CONFIRMED

---

---

### DR-12

**[MEDIUM] The document mirror is undocumented in DEPLOYMENT.md, has no backfill, and no completeness check**

_Area: Backup/DR · source: [`04-backup-dr.md`](04-backup-dr.md)_

- **ID:** DR-12
- **File:** `apps/api/src/env.ts:47-50`, `:94-116`; `apps/api/src/container.ts:425-444`;
  `.env.example:48-52`; `DEPLOYMENT.md:36-47`
- **What:** The mirror is a real control and deserves credit: production **refuses to start**
  with primary document storage configured but without an independent backup destination —
  "Production document storage requires an independent backup destination"
  (`apps/api/src/env.ts:106-116`), and all three `BACKUP_SUPABASE_*` settings must be
  supplied together (`:94-104`). `.env.example:48-52` documents them.
  But `DEPLOYMENT.md`'s "Vercel API project" environment-variable list (`:36-47`) does **not
  mention `BACKUP_SUPABASE_URL`, `BACKUP_SUPABASE_SERVICE_ROLE_KEY` or
  `BACKUP_SUPABASE_STORAGE_BUCKET` at all**. An operator following the deployment document
  faithfully will configure production and hit a startup failure whose cause is documented
  only in `.env.example` and the Zod schema.
  Three further weaknesses in the mirror itself:
  1. **No backfill.** Only objects uploaded _after_ the mirror was configured exist in the
     backup bucket. Anything uploaded before is unprotected, and nothing detects this.
  2. **No completeness check.** Nothing compares object counts or checksums between the two
     buckets. `production-release-and-recovery.md:66` requires "the Storage object count
     matches the source bucket" as part of a _manual_ backup verification; there is no
     equivalent for the live mirror.
  3. **Not an independent blast radius.** Both destinations are Supabase projects reached
     with service-role keys held by the same API process. A leaked service-role key, a
     compromised deployment, or a closed Supabase account can affect both. It is a strong
     defence against _accidental_ deletion (deletes are not propagated, `:5-6`) and a weak
     one against compromise or vendor failure.
  4. The backup project's **region is unspecified anywhere in the repo**, while
     `PILOT_RELEASE.md:6` requires an approved `PILOT_DATA_REGION` for the primary and the
     privacy notice §7 requires equivalent protection plus a DPA for any cross-border
     transfer. A second copy of every passport scan is being written to an undocumented
     destination.
- **Why it matters:** The mirror is currently the only automated backup of document bytes in
  existence (DR-07). Its silent gaps — pre-existing objects, no verification, undocumented
  region — mean the team may believe document bytes are covered when they are partially
  covered, which is worse than knowing they are not.
- **Fix:**
  1. Add `BACKUP_SUPABASE_*` to `DEPLOYMENT.md`'s API variable list with a one-line
     explanation of why production fails closed without it.
  2. Write a one-off backfill and a recurring completeness check comparing the two buckets;
     fold the result into the DR-09 reconciliation script.
  3. Document the backup project's region and include it in the data-region approval
     required by `PILOT_RELEASE.md:6` and the privacy gate at `:41-47`.
  4. Add a genuinely independent third copy (different vendor/credentials) for the off-site
     requirement at `production-release-and-recovery.md:28-29`.
- **Confidence:** CONFIRMED

---

---

### DR-13

**[MEDIUM] WORKSPACE_ENCRYPTION_KEY is a single point of unrecoverable loss for live data, history and every backup**

_Area: Backup/DR · source: [`04-backup-dr.md`](04-backup-dr.md)_

- **ID:** DR-13
- **File:** `apps/api/src/env.ts:171-186`; `packages/db/src/workspace-repository.ts:110-119`,
  `:139-149`, `:152-188`; `database/migrations/0035_workspace_version_history.sql:14-16`;
  key management procedure: NOT FOUND IN REPO
- **What:** `tenant_workspace.payload` is encrypted with AES-256-GCM under
  `WORKSPACE_ENCRYPTION_KEY` with the tenant id as AAD; production refuses to start without
  it when a database is configured (`apps/api/src/env.ts:184`). `PgWorkspaceRepository.find`
  transparently re-encrypts any plaintext row it encounters (`workspace-repository.ts:110-119`).
  `tenant_workspace_history` stores the payload "exactly as stored, which means it stays
  encrypted under `WORKSPACE_ENCRYPTION_KEY`" (`0035:14-16`).
  Encrypting at the application layer is the right call. The gap is that **no key management
  procedure exists anywhere in the repository** — no escrow, no rotation runbook, no
  key-version field on the payload envelope, and no mention of the key in
  `production-release-and-recovery.md`'s backup verification criteria (`:63-70`) or in the
  restore drill acceptance list (`:115-129`).
- **Why it matters:** Every recovery path in this audit routes through this key. Restore the
  database perfectly and lose the key, and you have restored ciphertext: the customer data
  is gone as surely as if the backup had failed. Conversely, the restore drill as currently
  written could pass while never proving the key still decrypts the restored rows, because
  decryption is not one of the seven acceptance checks. Rotation is also unaddressed: there
  is no key id in the envelope, so a rotation would need to decrypt-and-rewrite every row
  _and_ every archived history version, and history has no update grant (`0035:41-44`).
- **Fix:**
  1. Document key custody: where the key lives, who can retrieve it, and the escrow such
     that losing one person or one secret store does not lose every customer's data.
  2. Add "restored workspace payloads decrypt and match the source" to the drill acceptance
     criteria at `:115-129`.
  3. Add a key-version identifier to the encryption envelope now, while the data volume is
     small, so rotation remains possible later.
- **Confidence:** CONFIRMED

---

---

### DR-14

**[MEDIUM] RTO/RPO are stated but never measured, and the audit trail shares the database's fate with no retention policy**

_Area: Backup/DR · source: [`04-backup-dr.md`](04-backup-dr.md)_

- **ID:** DR-14
- **File:** `docs/operations/production-release-and-recovery.md:34-36`;
  `database/migrations/0009_audit_event.sql:21-39`;
  `docs/architecture/database-blueprint.md:469-480`
- **What:** Two related gaps.
  _Targets:_ RPO ≤ 24 hours and RTO ≤ 4 hours are stated explicitly (`:34-35`) and marked
  provisional for the closed pilot. Credit where due — most products this age state nothing.
  But neither has been measured, because no drill has run (DR-01), and the RPO figure is
  only meaningful for _detected_ loss (DR-03). No document distinguishes the two.
  _Audit trail:_ `audit_event` is well designed for evidence — append-only by grant
  ("An audit trail the application can rewrite is not an audit trail", `0009:21-25`), and
  deliberately without an FK to `tenant` so that erasing a tenant cannot cascade away the
  evidence of what was done to their data, "including the erasure itself" (`0009:27-39`).
  That reasoning is sound. What is missing operationally: the audit trail is in the same
  database as everything else, so it is backed up on the same schedule and rolled back by
  the same restore. Restoring to T-24h to recover lost data also erases the audit record of
  the 24 hours under investigation. There is no separate audit export, no append-only
  off-database sink, and no defined retention period — `database-blueprint.md:469-480` leaves
  retention open, while the legal document requires an audit log of all sensitive-document
  access.
- **Why it matters:** After an incident the audit trail is the only source of what happened,
  and the recovery action destroys the portion of it that matters most. For a regulated
  product this also undermines the evidentiary value the append-only design was built for.
- **Fix:**
  1. Export `audit_event` continuously (or at least daily) to append-only off-database
     storage, so a restore cannot roll it back.
  2. Before restoring, always snapshot the current database first — make this an explicit
     step in the restore runbook, not an assumption.
  3. Restate RPO/RTO in two parts: recovery-point for detected loss, and the (currently
     unbounded) exposure for undetected loss. Re-measure both from the first drill.
  4. Set an audit retention period as part of the privacy approval gate
     (`PILOT_RELEASE.md:43-44`).
- **Confidence:** CONFIRMED

---

## Minimum viable DR plan before real customer data is onboarded

Ordered. Items 1-6 are the "do not accept real PII without these" set.

1. **Separate the staging and production Supabase projects** and make the API refuse to
   start against a staging project ref. (DR-08 — cheapest removal of a whole accident class.)
2. **Run the restore drill** against synthetic data, using the acceptance criteria already
   written at `docs/operations/production-release-and-recovery.md:115-129`, plus two added
   checks: restored payloads decrypt under `WORKSPACE_ENCRYPTION_KEY`, and DB↔storage
   reconciliation is clean. **Commit the drill record with the measured wall-clock RTO.**
   (DR-01, DR-13, DR-09.)
3. **Apply migration 0035 to production and prove it**, then add `tenant_workspace_history`
   to the `/ready` object check so the safety net's absence fails readiness. (DR-05.)
4. **Ship the minimum detection control**: a daily per-tenant row-count job with alerting on
   any material drop, plus an alert on every `WORKSPACE_SHRINK_REJECTED`. Without this,
   every other control is gated on a customer complaining. (DR-03.)
5. **Enable PITR** on the production project, or record a signed, explicit acceptance that
   the recovery envelope is seven daily snapshots and that undetected loss beyond seven days
   is permanent. (DR-04.)
6. **Write the single-tenant restore procedure** and test it in the drill — restore to a
   disposable project, extract one tenant, verify, merge. Not a plan in a work item: a
   script plus a runbook page. (DR-02.)
7. **Automate the off-site logical DB backup and Storage copy** on a schedule, under
   credentials outside the Supabase account, with a missed-run alert and a named owner.
   (DR-07.)
8. **Write the reconciliation script** (rows without bytes, bytes without rows, mirror-only
   bytes) and run it after every restore and nightly. (DR-09.)
9. **Backfill the mirror bucket** for objects predating the mirror, and add
   `BACKUP_SUPABASE_*` to `DEPLOYMENT.md`. Document the backup project's region and include
   it in the data-region approval. (DR-12.)
10. **Write the erasure procedure enumerating every copy** — primary bucket, mirror bucket,
    workspace history, physical backups, off-site backups — with either a purge path or a
    disclosed retention exception per copy. Name the DPO. (DR-10.)
11. **Remove `DELETE` grants the application does not need**, and implement deletion as
    status + scheduled hard-delete once retention periods are approved. (DR-06.)
12. **Continuously export `audit_event`** to append-only off-database storage. (DR-14.)
13. **Build the server-side tenant export** so the portability promise in the privacy notice
    is true and a slow recovery input exists. (DR-11.)

## Coverage note

**Searched:** all `*.md` in the repo (including the Hebrew governance and work-plan
documents), all 36 files in `database/migrations/`, `.github/workflows/ci.yml` (the only
workflow), `package.json`, `.env.example`, `scripts/`, `apps/api/src/` (env, container,
create-server, storage adapters, export services, all routes),
`packages/application/src/ports/` and `use-cases/`, `packages/db/src/`, and the binary
`CareDesk_Legal_Validation_P0.docx` (text-extracted). Git history reviewed for incident
evidence.

**Deliberately out of scope** (assigned to other agents): API authorization logic, frontend
behaviour, DB schema/RLS correctness, release-process safety beyond its data-safety
implications, and the domain layer. RLS is referenced here only where it bears on whether a
recovery artifact leaks across tenants.

**Limits of this audit:** everything below is inferred from the repository. This audit
**cannot** verify the live infrastructure — whether 0035 is actually applied to production,
whether staging and production are now separate projects, whether the Supabase Pro retention
window is still 7 days, whether `BACKUP_SUPABASE_*` is configured in the production Vercel
project, or whether a restore drill has been performed but not recorded in the repo. Where a
finding depends on infrastructure state it is marked LIKELY rather than CONFIRMED. The one
claim I would flag for direct verification with the operator before acting: **DR-08**
(staging/production separation), because the repo states it as outstanding but that document
may lag reality.

**A closing note on tone.** The findings above are severe, but the documentation in this
repository is unusually candid about its own gaps — `production-release-and-recovery.md`
opens by saying customer data matters more than a code release, `0035`'s header narrates the
exact failure it exists to prevent, and the work plan is frank about a backup that may turn
out to be empty. The gap is execution, not awareness. That is a fixable position, and it is a
much better starting point than a repository that claimed to be covered.

---

### REL-07

**[MEDIUM] Indexes and constraints are added to live tables without `CONCURRENTLY`/`NOT VALID`, and no lock timeout bounds the damage**

_Area: Release · source: [`05-release-safety.md`](05-release-safety.md)_

- **ID:** REL-07
- **File:** `0020_sprint_zero_database_hardening.sql:8-28,32-33`; `0025_wave5_collaboration_engagement.sql:5-7`; `0026_canonical_product_intelligence.sql:8-11`; `0030_human_escalation_lifecycle.sql:18-20,36-38`. No `lock_timeout`/`statement_timeout` anywhere (grep clean).
- **What:** Four `CREATE INDEX` on existing tables (`0020:8-28`), a `UNIQUE` constraint on `tenant_membership` (`0020:32-33`), an unvalidated-then-validated FK on `task` (`0025:5-6` — no `NOT VALID`), a `CREATE INDEX` on `task` (`0025:7`), and three `ADD CONSTRAINT ... CHECK` without `NOT VALID` (`0026:8-11`, `0030:18-20`, `0030:36-38`).
- **Why it matters:** `CREATE INDEX` without `CONCURRENTLY` holds a `SHARE` lock — reads continue, **all writes block** until the index is built. `ADD CONSTRAINT ... CHECK` and a non-`NOT VALID` FK take `ACCESS EXCLUSIVE` plus a full table scan — reads _and_ writes block. On today's pilot volumes each is milliseconds. On `audit_event` after a year of a growing customer base, it is a write outage of minutes. The compounding factor is the absent `lock_timeout`: an `ACCESS EXCLUSIVE` request that cannot be granted immediately (one long-running report is enough) sits in the lock queue and **every subsequent query on that table queues behind it**, converting a slow migration into a total table outage. Note the structural constraint: `CONCURRENTLY` cannot be used at all while the runner wraps each file in a transaction (`migrate.ts:36-38`), so this needs a deliberate escape hatch, not just discipline.
- **Fix:** Set `set local lock_timeout = '3s'` and a `statement_timeout` at the top of each migration transaction (or issue them in `migrate.ts` right after `begin`) so a blocked `ALTER` fails fast and retries instead of freezing the table. Adopt `NOT VALID` + a separate `VALIDATE` for every new `CHECK`/FK — `0020:50-55` already demonstrates the pattern and even documents why. For indexes on large existing tables, add an opt-out marker (e.g. a `-- migrate:no-transaction` header the runner honours) so `CONCURRENTLY` becomes available.
- **Confidence:** CONFIRMED

---

### REL-08

**[MEDIUM] Two migrations share the number 0026 and nothing enforces uniqueness**

_Area: Release · source: [`05-release-safety.md`](05-release-safety.md)_

- **ID:** REL-08
- **File:** `database/migrations/0026_canonical_product_intelligence.sql` and `database/migrations/0026_wave5_worker_authorization.sql`; ordering determined at `packages/db/src/migrate.ts:22-24`
- **What:** Two distinct migrations carry the prefix `0026`. Ordering falls out of a lexicographic `.sort()` (`migrate.ts:24`), so `canonical` happens to run before `wave5` — deterministic, but by accident of the letter `c` preceding `w`, not by design. `migration-safety.ts` validates the _filename shape_ (`MIGRATION_PATH` at `:11`) but never checks that a number is unused, and `README.md` for migrations (`database/migrations/README.md:3-5`) states the convention as prose only.
- **Why it matters:** These two `0026`s are independent, so nothing broke. But `AGENTS.md:25-30` describes parallel agents working on separate branches, and `migration-safety.ts:97` classifies a new file as `A` (added) with no cross-branch awareness. Two agents both writing `0036_*.sql` both pass CI; whichever merges second silently becomes "later" or "earlier" depending on its filename spelling. If one depends on the other's table, the migration run fails on production with a missing-relation error — and per REL-01's mechanics, aborts the whole sequence.
- **Fix:** Add a check (in `migration-safety.ts` or a standalone `scripts/check-migration-numbers.mjs` wired into `pnpm lint`) asserting that migration numbers are unique and that a newly added migration's number is strictly greater than every number already on `origin/main`. The second half also blocks the merge-order hazard.
- **Confidence:** CONFIRMED

---

### REL-09

**[MEDIUM] No down migrations, and three migrations perform irreversible bulk writes to customer tenants**

_Area: Release · source: [`05-release-safety.md`](05-release-safety.md)_

- **ID:** REL-09
- **File:** `database/migrations/` (no `*_down.sql`, no `rollback` directory — directory listing confirms); `0019_backfill_self_service_accounts.sql:65-96`; `0030_human_escalation_lifecycle.sql:15-17`; `0032_regulation_rule_lifecycle.sql:109+`
- **What:** There is no reverse path for any migration. Three of them write customer data in bulk: `0019` creates a `tenant` + `family_account` + `tenant_membership` for every Auth user missing one; `0030:15-17` rewrites review statuses; `0032` cross-joins `tenant` to insert reviewed regulation content into **every** tenant. None batches, none verifies row counts, none is reversible.
- **Why it matters:** The team's own rule at `production-release-and-recovery.md:82` says "backfill in bounded, restartable batches and verify row counts". These three do none of that — they are single unbounded statements inside one transaction. If `0032`'s seed content turns out to be wrong (it is Hebrew legal reference text, permanently marked `requires_professional_validation = true`, per its own comment at `:102-109`), it is now in every customer's database and the only removal path is hand-written SQL against production. `production-release-and-recovery.md:110-113` correctly states that code rollback does not roll the database back — that is honest, but it leaves data-migration mistakes with no rehearsed remedy, on a project where `0035:5` records that point-in-time recovery is not enabled.
- **Fix:** Require every data-writing migration to be batched and restartable, to log affected row counts, and to ship with a written reverse statement in a comment block even if no down-migration runner exists. Keep reference content like `0032`'s seed out of migrations entirely — it is application data with a lifecycle, and `apps/api/src/regulation-rule-service.ts` already holds a parallel copy (`0032:107-108` acknowledges the duplication and asks a human to keep both in sync).
- **Confidence:** CONFIRMED

---

### REL-10

**[MEDIUM] `pnpm db:rls-test` writes to, and deletes from, production tables with a BYPASSRLS connection and no environment guard**

_Area: Release · source: [`05-release-safety.md`](05-release-safety.md)_

- **ID:** REL-10
- **File:** `package.json:13`; `packages/db/src/rls-check.ts:101-114,260-261,551,558-578`; contrast `packages/db/src/rls-check-ci.ts:19-22`
- **What:** `PILOT_RELEASE.md:10` step 4 and `database/README.md:67` both instruct running `pnpm db:rls-test` against the live Supabase project as part of release. The script connects with the owner/BYPASSRLS credential, inserts two synthetic tenants' worth of rows across ~40 tables, executes `create table rls_probe_should_fail` (`:551`), then in its `finally` block runs `drop table if exists rls_probe_should_fail` (`:558`) followed by **16 `DELETE` statements** (`:559-578`). Its CI sibling refuses any non-loopback host (`rls-check-ci.ts:19-22`); this one has no host check, no environment check, no confirmation.
- **Why it matters:** As written today it is safe — the deletes are scoped by `tenant_id` to two `randomUUID()` fixtures (`:101-114`, `:260-261`), so no customer row matches. But it is a script whose documented purpose is to run against production, which holds the one credential that bypasses every RLS policy, whose cleanup block is a wall of unqualified-looking `delete from <table>`, and which has nothing — no guard, no dry-run, no test — standing between a careless edit to one `WHERE` clause and mass deletion of customer data. `migration-safety.ts` does not scan `.ts` files, so no CI check covers it either. It also leaves DDL side effects on the production schema (`create table` / `drop table` at `:551,:558`).
- **Fix:** Add an explicit opt-in guard mirroring `rls-check-ci.ts:19-22` — refuse to run unless `CAREDESK_RLS_TEST_ALLOW_REMOTE=1` is set _and_ the operator passes the expected project ref. Assert before each cleanup `DELETE` that the target `tenant_id` is one of the two fixtures created in this process. Move the probe table into a scratch schema so a failed run cannot leave objects in `public`.
- **Confidence:** CONFIRMED (behaviour); the "safe as written" assessment is CONFIRMED by reading the fixture construction.

---

### REL-11

**[MEDIUM] Web and API deploy independently with no version negotiation or contract check**

_Area: Release · source: [`05-release-safety.md`](05-release-safety.md)_

- **ID:** REL-11
- **File:** `DEPLOYMENT.md:13-33`; `apps/web/src/api/client.ts:36-47`; `apps/web/vercel.json`; `apps/api/vercel.json`; no versioning found (grep for `apiVersion`, `X-API-Version`, `/v1/` returns only Supabase's own endpoint URLs)
- **What:** Two separate Vercel projects, each triggered by the same push to `main`, each building and deploying on its own timeline. Routes are unversioned. The web client resolves a base URL (`client.ts:36-47`) and sends requests — no version header, no capability handshake, no negotiated contract. `@caredesk/schemas` is shared, but only at compile time: each app bakes its own copy at build, so agreement holds only if both projects deploy from the same commit, which nothing enforces or verifies.
- **Why it matters:** Every promotion has a skew window of however long the slower build takes. New web + old API → the new UI calls a route that does not exist yet (404) or posts a field the old handler's Zod schema rejects (400). Old web + new API → a response shape the old client cannot parse. Neither is data loss, but both are user-visible failures during every release, and they are exactly the sort of thing that gets misdiagnosed as a broken deploy and "fixed" with a rollback — which, per REL-04, has its own hazard. There is no way to detect skew after the fact: nothing reports the commit each project is serving.
- **Fix:** Have both builds embed their git SHA and expose it (`/health` already exists at `apps/api/src/create-server.ts`). Have the web log or surface a mismatch. Longer term, version the API surface, or make the web tolerate a 404 on a not-yet-deployed route by degrading rather than erroring. At minimum, add a release step that verifies both projects report the same SHA before the release is signed off.
- **Confidence:** CONFIRMED

---

### REL-12

**[MEDIUM] No feature flags: every change is live for every customer at merge**

_Area: Release · source: [`05-release-safety.md`](05-release-safety.md)_

- **ID:** REL-12
- **File:** NOT FOUND — no flag mechanism in `apps/` or `packages/`. Aspirational references only: `docs/governance/next-delivery-wave-gap-analysis.md:168` ("Notification producers need a feature flag/kill switch"), `docs/architecture/strangler-migration.md:36` ("Feature-flag/cohort cutover"), `docs/adr/ADR-003-ai-provider-and-data-minimization.md:64` ("Kill switch and safe fallback demonstrated").
- **What:** There is no runtime flag system, no cohort mechanism, no dark-launch path. The closest analogue is env-var configuration: `BILLING_PROVIDER=disabled` (`.env.example:71`) and `BILLING_LAUNCH_DISCOUNT_PERCENT=100` (`:77`) gate the billing subsystem, and `AI_PROVIDER=mock` (`:95`) gates AI — all requiring a redeploy to change, all all-or-nothing across every tenant.
- **Why it matters:** The team's own architecture documents assume flags exist for exactly the risky work they have planned: the strangler cutover at `strangler-migration.md:36` specifies "Feature-flag/cohort cutover, monitoring, rollback rehearsal" as the gate for read cutover to normalized storage. Without flags, the only rollback lever is a full redeploy — which, per REL-04 and `production-release-and-recovery.md:110`, does not undo the schema change that shipped with it. A risky change cannot be exposed to one pilot tenant first, and cannot be switched off in seconds when it misbehaves.
- **Fix:** A minimal flag table keyed by `(tenant_id, flag_key)` behind the existing RLS model, read once per request in the container, with a global default — enough for cohort rollout and an instant kill switch, without a third-party service. Even a simple env-var-driven allowlist of tenant IDs would cover the pilot-customer-first case.
- **Confidence:** CONFIRMED

---

### WEB-14

**[MEDIUM] Infinite loading states and unhandled rejections on data load**

_Area: Frontend · source: [`02-frontend.md`](02-frontend.md)_

- **ID:** WEB-14
- **File:** apps/web/src/pages/case/ProductCompletionPanel.tsx:41-46, apps/web/src/pages/DashboardPage.tsx:146, apps/web/src/pages/OpenIssuesPage.tsx:57-59
- **What:** `void Promise.all([getCaseHealth(caseId).then(setHealth), listProfessionalReviews(caseId).then(setReviews)])` has no `.catch`; `DashboardPage` and `OpenIssuesPage` both do `void getCaseHealth(clientId).then(setHealth)` with no `.catch` — and pass the **local client id**, so the request fails on every load.
- **Why it matters:** In `ProductCompletionPanel`, a failed health fetch leaves `health === undefined` forever and the panel renders `{t('shell.loading')}` permanently — an infinite spinner with no retry, plus an unhandled rejection. On `DashboardPage` and `OpenIssuesPage` (the "overview" screen), the same-shaped id mismatch as WEB-01 means the health call fails on every visit for every user; the sections degrade to their local fallback but every page load logs an unhandled rejection, and the health-derived guidance never appears. `TimelinePage.tsx:19-21` makes the identical id mistake but at least catches it and shows "לא ניתן לטעון את ציר הזמן הקנוני" — so users see a permanent error banner on a nav-linked screen.
- **Fix:** Add `.catch` with an error state and a retry to all three, and resolve the id-space question from WEB-01 once for every caller.
- **Confidence:** CONFIRMED

---

### WEB-15

**[MEDIUM] Onboarding claims "saved" unconditionally, and a stale draft can overwrite newer profile edits**

_Area: Frontend · source: [`02-frontend.md`](02-frontend.md)_

- **ID:** WEB-15
- **File:** apps/web/src/pages/OnboardingPage.tsx:290-292, apps/web/src/pages/OnboardingPage.tsx:85-90
- **What:** A static `<aside role="status">✓ {t('onboarding.saved')}</aside>` is always rendered regardless of whether the debounced `saveMvpOnboardingDraft` succeeded; and `draft` is initialised as `restoredDraft?.profile ?? profile`, preferring an abandoned draft over the committed profile.
- **Why it matters:** (a) The reassurance most likely to be trusted is the one that is never checked. If the draft write throws (quota, private browsing — see WEB-06) the user still reads "נשמר" while nothing was written; on reload their answers are gone. (b) A user who abandons onboarding at step 3, later edits base salary and renewal dates in Settings, then reopens "עריכה מחדש של ההקמה" gets the _older_ draft snapshot restored into every field; completing the wizard writes that snapshot over the newer Settings values via `setProfile(completed)`.
- **Fix:** Drive the saved indicator from an actual write result (`'saving' | 'saved' | 'error'`). On restore, merge the draft over the current committed profile field-by-field rather than replacing it, or discard drafts older than the profile's last update.
- **Confidence:** CONFIRMED

---

### WEB-16

**[MEDIUM] Action failures are reported as load failures and replace the form region**

_Area: Frontend · source: [`02-frontend.md`](02-frontend.md)_

- **ID:** WEB-16
- **File:** apps/web/src/pages/BillingPage.tsx:40, apps/web/src/pages/BillingPage.tsx:76-141
- **What:** A single `error` boolean is set by `load()`, `submit()`, `reconnectCard()` and `cancelSubscription()`, and when true the page renders the load-error card **instead of** the plan and the payment form.
- **Why it matters:** The user fills in billing name and email, ticks the recurring-charge consent, presses "חיבור כרטיס", the checkout-session request fails, and the screen replaces the whole form with "לא ניתן לטעון את פרטי החיוב" plus a "retry" that re-fetches the subscription rather than retrying the checkout. The typed values survive in React state but are invisible until the user finds the retry, and the message describes a completely different problem than the one that occurred. `cancelSubscription` behaves the same way. `FamilyAccessPage` has the softer version of this: its notice element sits at the very bottom of the page (line 306), so on a phone a failed invite renders an alert the user never scrolls to, with no focus management.
- **Fix:** Separate `loadError` from `actionError`; render action errors inline next to the control that failed and move focus to them.
- **Confidence:** CONFIRMED

---

### WEB-17

**[MEDIUM] Deleting a client leaves uploaded identity documents behind, and the "backup" export is unencrypted plaintext PII**

_Area: Frontend · source: [`02-frontend.md`](02-frontend.md)_

- **ID:** WEB-17
- **File:** apps/web/src/storage/mvp-storage.ts:239-246, apps/web/src/storage/document-file-store.ts:95-103, apps/web/src/pages/ClientsPage.tsx:19-27
- **What:** `deleteMvpClient` removes only `localStorage` keys ending in `.client.<id>`; it never touches the `caredesk.mvp.files.v1` IndexedDB store (which is keyed by document id and **not scoped by client**) and never calls `deleteWorkspaceFile` for the client's server-side uploads. `clearLocalDocumentFileCache` resolves its promise on `request.onblocked` (line 101) as if the delete had succeeded. `exportMvpClient` writes every decrypted business key to a plain JSON download.
- **Why it matters:** A user who taps "מחיקת תיק ההעסקה ואת כל הנתונים המקומיים שלו" and confirms is told the local data is gone, but passport and ID scans stay in IndexedDB indefinitely (local mode) and in server storage (cloud mode). Separately, when a second tab holds the database open, `deleteDatabase` fires `onblocked` and the code reports success — so the account-switch path in `startWorkspaceSync` (line 351) and the sign-out path in `stopWorkspaceSync` (line 405, not even awaited) can leave the previous account's document blobs on disk while account B is signed in. Finally, the "גיבוי" button produces a file containing Israeli ID numbers, passport numbers, medications and payroll history in clear text with no warning about where the user is about to store it.
- **Fix:** Scope the IndexedDB store per client and delete its records in `deleteMvpClient`/`resetMvpClient`, plus issue `deleteWorkspaceFile` for each of the client's documents; treat `onblocked` as a failure and surface it rather than resolving; await `clearLocalDocumentFileCache()` in `stopWorkspaceSync`; add a one-line warning next to the backup button that the file is unencrypted.
- **Confidence:** CONFIRMED

---

### WEB-18

**[MEDIUM] The device cache key lives in sessionStorage while the data lives in localStorage — in local-only mode that is permanent loss**

_Area: Frontend · source: [`02-frontend.md`](02-frontend.md)_

- **ID:** WEB-18
- **File:** apps/web/src/storage/business-storage-crypto.ts:14-35, apps/web/src/auth/client.ts:9-14
- **What:** `sessionKey()` stores the AES-GCM key in `sessionStorage` (`caredesk.cache-key.v1`) while every business value is encrypted into `localStorage`, so the key dies with the browser session and the ciphertext does not.
- **Why it matters:** The team already documented this happening in production (auth-context.tsx:110-117: "27 local keys none of which decrypted"). With Supabase configured the server copy rescues it. But `getBrowserAuthClient()` returns `null` whenever `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` are absent, and `resolveAuthGateState` then runs the app in `local-bypass` mode with no server at all — `ClientsPage` even advertises "המידע נשמר במכשיר זה בלבד". In that mode, closing the browser makes every stored profile, payroll record, task and medication permanently unreadable, and `readMvpProfile` swallows the failure (`catch { return emptyMvpProfile }`) so the user is shown an empty, freshly-set-up-looking account rather than an error. `readList`, `readClientsRaw` and `readMvpOnboardingDraft` do the same.
- **Fix:** Derive the cache key deterministically (e.g. from the authenticated user id via WebCrypto) or persist it alongside the data with an explicit device-trust decision; and when `unreadableKeys > 0` in a mode with no server copy, show an explicit "the data on this device cannot be read" screen instead of an empty workspace.
- **Confidence:** CONFIRMED

---

### WEB-19

**[MEDIUM] Legacy plaintext values are read back forever and never re-encrypted**

_Area: Frontend · source: [`02-frontend.md`](02-frontend.md)_

- **ID:** WEB-19
- **File:** apps/web/src/storage/business-storage-crypto.ts:45-46
- **What:** `decryptBusinessStorageValue` returns `stored` verbatim when it does not carry the `caredesk-encrypted-v1:` prefix.
- **Why it matters:** The comment calls this a one-time migration, but nothing performs the migration: a plaintext key is only re-encrypted if some screen happens to write that exact key again. A user who was on the app before encryption shipped keeps their profile (ID number, passport number, addresses, phone numbers) in clear text in `localStorage` indefinitely, and `captureMvpWorkspace` happily uploads it as if it had been protected. It also means an attacker with local file access can plant readable values that the app will accept as its own data.
- **Fix:** On first read after hydration, rewrite every non-prefixed `caredesk.mvp.*` key through `writeBusinessItem`, and then reject unprefixed values.
- **Confidence:** CONFIRMED

---

### WEB-20

**[MEDIUM] API base URL falls back to `:4000` on the page's own host, and no security headers are set**

_Area: Frontend · source: [`02-frontend.md`](02-frontend.md)_

- **ID:** WEB-20
- **File:** apps/web/src/api/client.ts:36-45, apps/web/vercel.json:1-11
- **What:** With `VITE_API_BASE_URL` unset, `resolveApiBaseUrl()` returns `${protocol}//${hostname}:4000`; `vercel.json` defines a `/api/:path*` rewrite the client never uses and sets no response headers.
- **Why it matters:** A production deploy that forgets the env var sends every authenticated request to `https://care-platform-web.vercel.app:4000`, which never answers. The user does not get an explanatory screen — they get `storage-error` or a permanent "השמירה בענן נכשלה" banner with a retry that can never succeed. Separately, an app that holds Israeli ID numbers and passport scans ships with no `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy` or `Permissions-Policy`, so it can be framed for clickjacking and full URLs leak in the `Referer` to the Google Fonts origin the page already loads.
- **Fix:** Fail loudly at startup when the API base URL is unresolvable in a non-local deployment (or route through the existing `/api` rewrite), and add a `headers` block to `vercel.json` with at least `frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin` and HSTS.
- **Confidence:** CONFIRMED

---

### WEB-21

**[MEDIUM] i18n is bypassed on almost every business screen, and the English locale is unreachable**

_Area: Frontend · source: [`02-frontend.md`](02-frontend.md)_

- **ID:** WEB-21
- **File:** apps/web/src/pages/PayrollPage.tsx:1, packages/i18n/src/init.ts:16-24
- **What:** The repo bans hardcoded Hebrew literals (`eslint.config.js:59-66`), and 19 files disable that rule at the top — including `AppShell`, `PayrollPage`, `TasksPage`, `DocumentsPage`, `EmployeePage`, `TimelinePage`, `ClientsPage`, `EmergencyBinderPage`, `CanonicalPayrollIntelligence` and `PayrollIntelligence`, i.e. the primary business surfaces. Meanwhile `initI18n` hard-codes `lng: DEFAULT_LOCALE` with no switcher, and `isRtlLocale`/`directionFor` (locales.ts:37-43) are exported but never called — `dir="rtl"` is static in `index.html`.
- **Why it matters:** `he.json` and `en.json` have exact 986-key parity, so a full English translation exists and is dead code that no test or screen exercises. If it is ever switched on, the untranslated screens above will render Hebrew inside an English UI, and the physical-direction CSS (`global.css:1826` `.timeline:before { right: 126px }`, `:2551`, and the `text-align: right` table rules at `:2064`/`:2295`) will lay out backwards. Group also covers accessibility gaps concentrated on those same non-i18n screens: `PayrollPage`'s step indicators are `aria-hidden` divs with no programmatic current-step announcement, `FamilyAccessPage`'s result notice renders far below the form with no focus move, and `CollaborationPanel`'s `<select>`s carry English `aria-label`s built from enum keys.
- **Fix:** Treat the disable comments as a tracked debt list and extract those screens; either wire a language switcher through `directionFor()` and logical CSS properties (`inset-inline-start`, `text-align: start`) or drop `en.json` so the parity test stops implying a working English build.
- **Confidence:** CONFIRMED

---

### API-13

**[LOW] Professional-review creation replays a stored row without comparing the request hash**

_Area: Backend API · source: [`01-backend-api.md`](01-backend-api.md)_

- **ID:** API-13
- **File:** apps/api/src/routes/product-differentiation.ts:536
- **What:** `insert into professional_review_request … on conflict (tenant_id, idempotency_key) do update set idempotency_key=excluded.idempotency_key returning …` returns the pre-existing row for a reused key regardless of whether the new body matches it.
- **Why it matters:** Every other idempotent route in the API rejects a reused key carrying a different payload with `409 IDEMPOTENCY_CONFLICT` (payroll, leave, scenario, binder, regulation, automation receipts). Here a client that reuses a key by accident — e.g. a UUID regenerated per mount rather than per submission — silently receives someone else's earlier escalation, including its `reason`, `summary` and `employmentCaseId`, which may belong to a _different case_ in the same tenant (the returning clause is not filtered by `employment_case_id`). The caller believes its new escalation was recorded; it was not.
- **Fix:** Store and compare a `request_hash` as the other services do, returning 409 on mismatch, and constrain the replay lookup to the `:caseId` in the path.
- **Confidence:** CONFIRMED

---

### API-14

**[LOW] Development in-memory fallback stores are shared across tenants and filtered only by resource id**

_Area: Backend API · source: [`01-backend-api.md`](01-backend-api.md)_

- **ID:** API-14
- **File:** apps/api/src/routes/case-documents.ts:180 and 337-342 (also apps/api/src/routes/product-differentiation.ts:135-137, 481, 590)
- **What:** `memoryIntakeReviews`, `memoryReviews`, `memoryTransitions` are module/closure-scoped arrays and maps shared by the whole process; the read paths filter on `documentId`/`caseId`/`reviewId` only, never on `actor.tenantId`.
- **Why it matters:** These branches run whenever `container.pool` is undefined. Today the preceding `listDocuments`/`authorizeCase` call gates on tenant so a cross-tenant read is not reachable, and the branch is not used in production — but the isolation is incidental rather than enforced, so any future reordering or a new read path over the same store leaks across tenants. The `idempotency` map in product-differentiation.ts _is_ keyed by tenant, showing the intended discipline.
- **Fix:** Key these stores by `${tenantId}:${id}` and filter reads on the actor's tenant, matching `idempotency`'s `cacheKey`.
- **Confidence:** CONFIRMED

---

### API-15

**[LOW] Uploaded content type is client-declared and never verified against the bytes**

_Area: Backend API · source: [`01-backend-api.md`](01-backend-api.md)_

- **ID:** API-15
- **File:** packages/schemas/src/case-documents.ts:32 and packages/schemas/src/workspace.ts:35, consumed at apps/api/src/storage/supabase-document-storage.ts:39-55
- **What:** `mediaType` is validated against an allow-list but the base64 `content` is never checked for a matching magic number; the declared value is passed straight to Supabase as the stored object's `content-type` and is what the signed URL will later serve.
- **Why it matters:** A caller with `document:create` can store arbitrary bytes labelled `application/pdf` or `image/png`. The API's own CSP and `nosniff` headers (plugins/security-headers.ts) do not cover the Supabase storage origin the signed URL points at, so whatever is served there is served with the attacker-chosen type. The blast radius is limited (the allow-list already excludes SVG, archives and Office macros, and the uploader must already be an authorized tenant member), which is why this is LOW rather than higher.
- **Fix:** Sniff the leading bytes after `decodeBase64` and reject an upload whose magic number does not match the declared `mediaType`, before `putObject` is called.
- **Confidence:** CONFIRMED

---

### API-16

**[LOW] Worker invitation accepts a case id and worker id it never validates, and a rejected one reads as 403**

_Area: Backend API · source: [`01-backend-api.md`](01-backend-api.md)_

- **ID:** API-16
- **File:** apps/api/src/routes/wave5.ts:123-138 and apps/api/src/collaboration/wave5-service.ts:293-339
- **What:** `POST /worker/invitations` takes `caseId` and `workerId` from the request body and inserts them into `worker_portal_access` with the actor's tenant id, with no server-side check that either belongs to that tenant.
- **Why it matters:** Cross-tenant use is blocked only by the composite foreign keys `(tenant_id, employment_case_id)` and `(tenant_id, caregiver_id)` in `database/migrations/0025_wave5_collaboration_engagement.sql:44-47` — the API layer contributes nothing. The FK violation is then caught by the route's bare `catch` and returned as `403 FORBIDDEN`, so a manager who mistypes a case id is told they lack permission. If those FKs are ever relaxed (a `not valid` constraint, a table rewrite), this becomes a live cross-tenant write with no second line of defence.
- **Fix:** Verify both ids inside the same transaction before the insert (`select 1 from employment_case where id=$1` / `caregiver where id=$1`, which RLS already scopes to the tenant) and return 404/422 explicitly.
- **Confidence:** CONFIRMED

## What is done well

- Tenant authority is genuinely server-derived everywhere. `makeAuthenticate` resolves the tenant from the verified session's membership (plugins/authenticate.ts:57-67) and no route reads a tenant id from body, query or header — I checked all 23 route files.
- Cross-tenant probing is consistently reported as an indistinguishable `404` rather than `403`, with the reasoning written down at the call sites (case-contacts.ts:100-102, case-documents.ts:167-169, binder-exports.ts:115).
- Zod validation is applied to the body _and_ the path params on every mutating route, with `.strict()` on the payload schemas that matter (payroll, leave, scenario, intake review), so mass assignment is closed off.
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
- No test covers a payroll or scenario-expense save that **omits** `version` against an existing row (API-03); the existing tests only assert that a _stale_ version is rejected.
- No test covers a partial failure inside the automation commit loop (API-04); the concurrency tests only cover the happy path and the duplicate-claim path.

---

### DB-17

**[LOW] Two migrations share the `0026` prefix**

_Area: Database · source: [`03-database.md`](03-database.md)_

- **ID:** DB-17
- **File:** `database/migrations/0026_canonical_product_intelligence.sql`,
  `database/migrations/0026_wave5_worker_authorization.sql`
- **What:** `runMigrations` sorts filenames lexicographically (`migrate.ts:22-24`) and keys
  `schema_migrations` on the full filename, so both apply and both record distinct versions —
  there is no functional collision today. The ordering between them is decided by the suffix
  (`canonical…` before `wave5…`), which is accidental rather than intended.
- **Why it matters:** It defeats the "NNNN is the total order" invariant that the migration
  numbering and `migration-safety.ts`'s `MIGRATION_PATH` regex assume, and makes a future
  ordering-dependent pair between them silently wrong.
- **Fix:** Leave the applied files alone (`migration-safety.ts:97-103` correctly makes applied
  migrations immutable). Add a `migration-safety` rule rejecting a new file whose 4-digit
  prefix already exists.
- **Confidence:** CONFIRMED.

---

### DB-18

**[LOW] Inconsistent handling of an empty `app.tenant_id`: `::uuid` vs `nullif(…, '')::uuid`**

_Area: Database · source: [`03-database.md`](03-database.md)_

- **ID:** DB-18
- **File:** `database/migrations/0004_force_rls_and_with_check.sql:35-36` (and 50 further
  policies) vs `database/migrations/0015_lock_down_supabase_public_schema.sql:36` and
  `database/migrations/0017_restore_missing_pilot_workspace.sql:24-25,50-51`
- **What:** Almost every policy uses `current_setting('app.tenant_id', true)::uuid`. Three
  use `nullif(current_setting('app.tenant_id', true), '')::uuid`. `rls-check.ts:411-416`
  documents that the empty-string case is real: "PostgreSQL can expose an unset
  transaction-local custom setting as an empty string after a pooled connection is reused."
- **Why it matters:** With the bare cast, `''::uuid` raises `invalid input syntax for type
uuid` mid-statement rather than evaluating to false. That is still fail-closed (no data
  leaks), but it aborts the transaction and surfaces as a 500 rather than an empty result —
  and inside a multi-statement transaction it discards work already done in that transaction.
  The three `nullif` variants degrade cleanly to "no rows"; the other 50 do not.
- **Fix:** Standardise on `nullif(current_setting('app.tenant_id', true), '')::uuid` across
  all policies in one new migration. Behaviour is identical when the GUC is a valid UUID.
- **Confidence:** CONFIRMED.

---

### DB-19

**[LOW] `document_intake_review.confirmed_fields`, `event_action_plan.answers` and `automation_execution_receipt.response` are unconstrained jsonb with a comment-only privacy contract**

_Area: Database · source: [`03-database.md`](03-database.md)_

- **ID:** DB-19
- **File:** `database/migrations/0024_wave4_automation.sql:1-2,13,31`,
  `database/migrations/0029_automation_execution_receipt.sql:23`
- **What:** 0024 opens with "Durable review/confirmation evidence only. Raw OCR, prompts,
  document content, and provider responses are deliberately excluded." That rule is enforced
  nowhere in the schema: `confirmed_fields jsonb not null default '{}'`, `answers jsonb not
null`, `response jsonb` have no shape constraint, no key allowlist and no size cap. Compare
  `audit_event`, where the same privacy contract is made mechanical with three explicit
  length CHECKs (0009:93-100) and the header says exactly that: "Length caps are the privacy
  contract made mechanical".
- **Why it matters:** The single line of defence today is one Zod schema —
  `intakeReviewBodySchema` at `apps/api/src/routes/case-documents.ts:36-60`, which currently
  admits only field _keys_ (`'holder_name' | 'issue_date' | 'expiry_date'`) and validation
  metadata, no values. So there is no PII in these columns right now. But the intake flow
  exists to process passports and visas: the moment someone widens that Zod schema to carry an
  extracted value, passport and permit numbers land in a plaintext, uncapped jsonb column, in
  direct contradiction of
  `database/migrations/sensitive-record-migration-requirements.md:10-12` ("Store sensitive
  values as application-encrypted ciphertext … PostgreSQL, backups, replicas, logs, audit
  rows, and analytics exports must never receive plaintext").
- **Fix:** Give these columns the same mechanical treatment `audit_event` got: a size cap
  (`check (pg_column_size(confirmed_fields) <= 4096)`) and, for `confirmed_fields`, a CHECK
  that the object contains only the known metadata keys. That way the privacy contract fails
  the write rather than relying on a route schema staying narrow forever.
- **Confidence:** CONFIRMED.

---

### DB-20

**[LOW] `PgWorkspaceFileRepository.delete` drops the only record of a private storage key**

_Area: Database · source: [`03-database.md`](03-database.md)_

- **ID:** DB-20
- **File:** `packages/db/src/workspace-file-repository.ts:80-90`;
  `database/migrations/0012_workspace_files.sql:4-17`
- **What:** `workspace_file` is described as holding "the opaque key" for bytes that "live
  only in a private storage bucket". The repository's `delete` issues a hard
  `delete from workspace_file … returning …` — there is no soft-delete status column and no
  tombstone, unlike `scenario_expense` (0034:13, "No delete grant: removal is a soft status
  change") and `leave_entry` (0033:15-17, "Ledger rows are never hard-deleted").
- **Why it matters:** If the row is deleted and the subsequent object-storage delete fails
  (network error, permissions, a crash between the two), the blob remains in the bucket with
  no record anywhere of which tenant it belongs to or that it exists. It cannot be found, cannot
  be included in an erasure request, and cannot be reconciled — a permanent orphaned copy of
  customer document data outside the schema's reach.
- **Fix:** Follow the house convention: add a `status text not null default 'active' check
(status in ('active','deleted'))` column, soft-delete, and drive object-storage cleanup from
  a reconciliation sweep over `status = 'deleted'` rows that only removes the row once the
  object is confirmed gone.
- **Confidence:** CONFIRMED.

## What is done well

- **RLS is complete and correct.** All 55 tenant-owned tables have `ENABLE` + `FORCE` and a
  `FOR ALL` policy with both `USING` and `WITH CHECK`. Not one has a SELECT policy without a
  write check. Migration 0004's header is an unusually honest post-mortem of the two real
  defects (`ENABLE` not applying to the owner; `USING` without `WITH CHECK`), and 0005 goes
  further by identifying that even `FORCE` is defeated by `BYPASSRLS` and creating a
  `NOBYPASSRLS` application role. That is the correct three-layer analysis and it is rare to
  see it worked all the way through.
- **Composite same-tenant foreign keys throughout.** Rather than `references employment_case
(id)`, essentially every reference is `foreign key (tenant_id, x_id) references t
(tenant_id, id)`, backed by explicit `unique (tenant_id, id)` candidate keys. This makes a
  cross-tenant reference structurally impossible even if RLS were bypassed entirely — real
  defence in depth, not a slogan. 0006:8-12 and 0020:31-33 show the pattern being extended
  deliberately as new referencing tables arrive.
- **No `ON DELETE CASCADE` anywhere.** Zero occurrences of `ON DELETE` in 3,220 lines of DDL.
  Nothing in this schema can silently wipe audit events, documents, timeline entries or
  payroll history when a parent row goes away.
- **Money is modelled correctly.** `numeric(12,2)` for payroll and expenses, integer agorot
  for product billing (`price_agorot`, `amount_agorot`), with range CHECKs on every one. No
  float, `real`, `double precision` or `money` column exists. `payroll_month_close` even has a
  reconciliation CHECK (0026:8-11).
- **Append-only is enforced by grant, not by convention.** `audit_event`, `timeline_event`,
  `document_version`, `payroll_month_close`, `binder_export_receipt`,
  `worker_payment_acknowledgement`, `workflow_completion`, both transition tables and
  `tenant_workspace_history` all hold `select, insert` only. A tenant cannot delete its own
  audit rows: there is no DELETE grant and no `SECURITY DEFINER` function that deletes.
- **The `audit_event` privacy contract is mechanical, not aspirational.** Deliberately no
  jsonb payload column, plus three length CHECKs and a denial-requires-reason CHECK, with a
  header explaining that the caps exist so "a short summary cannot hold a document, a bank
  statement or a model prompt". The reasoning for omitting the tenant FK (0009:27-39) is one
  of the best-argued schema comments I have read.
- **Sensitive fields are deferred rather than fudged.** 0003's header explicitly refuses to
  add passport-number and bank-detail columns until the encrypted-field design lands, and
  `sensitive-record-migration-requirements.md` writes down the eight gates such a design must
  clear. `worker_portal_invitation` stores `token_hash` with a 32-char minimum, never a token.
  `product_subscription` stores an app-encrypted `sealed_payment_token` with a CHECK that the
  token, provider id and last4 are all present or all absent.
- **Constraint craftsmanship.** `task_has_exactly_one_title check ((title is null) <> (title_key
is null))`, `task_completed_at_matches_status check ((status = 'completed') = (completed_at
is not null))`, `document_version_verification_evidence`, `worker_access_state`,
  `regulation_rule_review_consistent`, partial unique indexes for "at most one active X"
  (`tenant_membership_active_unique`, `case_contact_role_single_primary`,
  `case_responsibility_current`, `worker_access_active_case`). These are the constraints that
  prevent nonsense states, and they are everywhere.
- **`withTenant()` is the right abstraction** — transaction-local role and tenant, both
  unable to leak to the next borrower of a pooled connection, with a comment
  (`pool.ts:28-53`) that explains why the apparently redundant `SET LOCAL ROLE` is kept.
- **`pool.ts:12-13` disables node-postgres's `date` parser** so a visa expiring 2026-09-01
  cannot come back as 2026-08-31T21:00:00Z. That is a real compliance bug caught and fixed at
  the type-parser level.
- **`rls-check.ts` is a genuine live isolation test**, not a unit test: two synthetic tenants,
  assertions for read/update/delete/insert-with-foreign-tenant-id, a missing-tenant-context
  check, a "can the app role reshape the schema" check, and a `pg_policy` introspection check
  that both `polqual` and `polwithcheck` are non-null. It cleans up after itself and uses
  `example.invalid` addresses.
- **`migration-safety.ts` strips comments and string literals before pattern matching**
  (lines 64-69), so a migration that _explains_ a `DROP TABLE` in prose is not flagged. That
  is the difference between a lint rule people keep and one they disable.
- **`PgWorkspaceRepository.save` gets optimistic concurrency right**: the shrink guard reads
  with `FOR UPDATE` inside the same transaction as the write, and the create path uses
  `on conflict (tenant_id) do nothing` so it cannot overwrite. The re-encryption pass in
  `find` uses a compare-and-set (`where payload = $3::jsonb`) so two concurrent readers cannot
  race. `PgTaskRepository.completeTask` uses `where status <> 'completed'` for idempotency
  rather than rewriting the original completion time.
- **`sql-literal.ts`** correctly identifies `ALTER ROLE … PASSWORD` as the one place a bind
  parameter is impossible, delegates escaping to `pg.escapeLiteral`, rejects NUL and control
  characters instead of silently truncating, and keeps the helpers pure so they are unit-testable.

## Coverage note

**Read in full:** all 36 files in `database/migrations/` (0001-0035, including both `0026_*`
files), `database/migrations/README.md` (via `database/README.md`),
`database/migrations/sensitive-record-migration-requirements.md`, `database/README.md`,
`database/rls-test-harness-design.md`, `database/seed/README.md`,
`database/docker-compose.yml`, and all 34 `.ts` files under `packages/db/src`
(implementation files read line by line; the 11 `*.test.ts` files were skimmed for behavioural
assertions only).

**Read partially, for cross-checking only** (owned by other reviewers — findings referencing
them are flagged as such): `apps/api/src/container.ts`, `apps/api/src/env.ts`,
`apps/api/src/index.ts`, `apps/api/src/routes/case-documents.ts`,
`apps/api/src/payroll-entry-service.ts`, `apps/api/src/regulation-rule-service.ts`,
`apps/api/src/collaboration/wave5-service.ts`, `apps/api/src/binder-export-service.ts`,
`apps/api/src/evidence-export-service.ts`, `apps/api/src/leave-entry-service.ts`,
`apps/api/src/scenario-expense-service.ts`, and five files under
`packages/infrastructure/src/mocks/`. DB-01, DB-03 and DB-15 straddle the boundary: the
defect is in API/infrastructure code, but the property at risk — tenant isolation and
constraint enforcement at rest — is this review's subject, so they are reported here.

**Not verified against a live database.** Every claim above is derived from static reading of
the migrations and code. Three findings need a query against the running Supabase instance to
close out, and each names the exact query: DB-05 (`tenant_workspace_history` plaintext count),
DB-07 (resolved reviews without a note), DB-13 (`anon`/`authenticated` grants). I did not run
`pnpm db:migrate`, `pnpm db:rls-test`, or `pnpm db:migration-safety` — no database was
available and the task was read-only.

**Explicitly checked and found clean** (negative results, recorded so they are not re-checked):
no `ON DELETE CASCADE` or any `ON DELETE` clause anywhere; no `float`/`real`/`double
precision`/`money` column; no policy after 0004 missing `WITH CHECK`; no `DELETE` grant on any
append-only evidence table; no `SECURITY DEFINER` function that deletes tenant data; all
`SECURITY DEFINER` functions pin `search_path` and are revoked from `PUBLIC` before being
granted to `caredesk_app` only; `0026_wave5_worker_authorization.sql` places `pg_temp` last in
its `search_path`, which is the safe ordering.

**Not covered by this review** (other reviewers' scope): API route authorization, frontend,
backup/DR procedures, the release and migration-safety CI pipeline, and the domain layer.

---

### DOM-21

**[LOW] Domain failures are returned as `null`, conflating distinct outcomes**

_Area: Domain · source: [`06-domain-logic.md`](06-domain-logic.md)_

- **ID:** DOM-21
- **File:** packages/application/src/use-cases/manage-case-tasks.ts:80-93; get-employment-case.ts:22-33; manage-workspace.ts:47
- **What:** `CompleteCaseTask` returns `null` for "does not exist", "belongs to another tenant" and
  "already complete" (its own docstring says so). `SaveWorkspace` returns `null` for an optimistic-
  concurrency loss. The codebase has good typed errors elsewhere (`FamilyMemberConflictError`,
  `BillingSetupNotFoundError`, `VisaRenewalValidationError`), so this is inconsistent rather than
  absent.
- **Why it matters:** Hiding cross-tenant existence behind `null` is deliberate and right; folding
  "already complete" into the same value is not. The caller cannot distinguish a benign double-click
  from a stale-version save that lost a user's work, and both map to the same HTTP response.
- **Fix:** Return a discriminated result (`{ ok: true, task } | { ok: false, reason: 'not_found' | 'already_complete' | 'version_conflict' }`),
  keeping not-found deliberately indistinguishable from wrong-tenant.
- **Confidence:** CONFIRMED

---

### DOM-22

**[LOW] Non-deterministic `new Date()` defaults in otherwise pure functions**

_Area: Domain · source: [`06-domain-logic.md`](06-domain-logic.md)_

- **ID:** DOM-22
- **File:** packages/application/src/automation/document-intake.ts:43 (`now = new Date()`); apps/web/src/quarterly-national-insurance.ts:122 (`today = new Date()`)
- **What:** Two functions default a time parameter to wall-clock time. Everything else in the
  application layer takes an explicit `Clock` port or a `today: string`.
- **Why it matters:** A default that reads the clock makes the function untestable without freezing
  time and unreproducible in an audit context — the same inputs no longer give the same output.
  For DOM-03 this default is part of a BLOCKER; on its own it is a latent hazard.
- **Fix:** Make the parameter required, as `projectComplianceTimeline` already does.
- **Confidence:** CONFIRMED

---

### DOM-23

**[LOW] `eligibleChannels` uses a single-argument comparator**

_Area: Domain · source: [`06-domain-logic.md`](06-domain-logic.md)_

- **ID:** DOM-23
- **File:** packages/application/src/engagement.ts:50
- **What:** `channels.sort((a) => (a === preference.preferredChannel ? -1 : 1))` ignores `b`, so it
  is not a valid comparator. I checked all six orderings for the three-channel case and V8 currently
  produces the intended result, so nothing is wrong today.
- **Why it matters:** The outcome depends on the engine's sort implementation, not on the code. It
  is one added channel or one engine change away from silently choosing the wrong delivery channel.
- **Fix:** `(a, b) => Number(b === preferred) - Number(a === preferred)`.
- **Confidence:** CONFIRMED

---

### DOM-24

**[LOW] A zero-total payroll month can be recorded but can never be closed**

_Area: Domain · source: [`06-domain-logic.md`](06-domain-logic.md)_

- **ID:** DOM-24
- **File:** apps/api/src/routes/canonical-product-intelligence.ts:15 (`total: z.number().positive()`); database/migrations/0026:4 (`check (total_amount > 0)`); contrast database/migrations/0028:25 (`total between -10000000 and 10000000`)
- **What:** `payroll_entry` permits a total of zero or negative; `payroll_month_close` requires
  strictly positive. Nothing else about the close is guarded: there is no check that the month is in
  the past, that `payment_date` relates to `payroll_month`, or that earlier months were closed first.
- **Why it matters:** A month in which the caregiver was absent unpaid, or in which advances exceeded
  salary (see DOM-07), produces an entry that the close endpoint will reject forever. The month stays
  permanently open, and `hasOpenMonth` (product-intelligence.ts:121) nags about it indefinitely with
  no way for the user to resolve it. Separately, a future month can be closed today.
- **Fix:** Allow `total_amount >= 0` on the close (or `<> null`), and add a guard that
  `payroll_month <= current month` in Israel time.
- **Confidence:** CONFIRMED

## Money & date handling assessment

**Currency — two representations, one of them unsafe.**

_Product billing_ (what the family pays CareDesk) is done properly: integer agorot end to end
(`priceAgorot`, `vatRateBps`, `amount_agorot integer`), VAT split so the parts sum to the whole
(`vat = price - round(price / (1 + vatBps/10000))`), no float in the charge path. If the rest of the
system looked like this there would be nothing to report. The one flaw is DOM-09, where the
_displayed_ discounted price and the _charged_ price are computed by different code in different
languages and disagree.

_Caregiver payroll and forecasting_ (the money that actually matters, and the regulated part) is
floating-point shekels. `numeric(12,2)` in Postgres is exact, but every value crosses the boundary
through a JS `number` in both directions (`Number(row.total_amount)`,
`input.total` written straight back), and all arithmetic — `calculateMonthlyPayroll`,
`projectPayrollAnalytics`'s running `cumulative`, `projectFutureCost`'s sums — happens in binary
floating point.

Rounding has no single decision behind it. There are three behaviours in the codebase:
`Math.round(x * 100) / 100` (proration), `Math.round((x + Number.EPSILON) * 100) / 100`
(`roundMoney`), and no rounding at all (`calculateMonthlyPayroll`, which lets Postgres round at
insert time). The EPSILON variant does not do what it looks like it does —
`roundMoney(1.015) === 1.02` but `roundMoney(8.165) === 8.16` — so half-agora cases round in
different directions within the same month. Nobody has written down half-up vs banker's, and the
effective answer is "whichever layer happens to round first".

**Verdict: not safe for payroll.** The errors are small in magnitude but unbounded in direction and
unreproducible, which is the property an audit trail cannot tolerate. Fix by moving all money to
integer agorot in `packages/domain` with one documented rounding function applied once, at the point
a value becomes payable.

**Dates and timezones — correct in the application layer, wrong at the two edges that matter.**

The good part is real and deliberate. `packages/application/src/product-intelligence.ts` is
scrupulous: `utcDay()` normalises via `Date.UTC`, `today` is an explicit `string` parameter, month
arithmetic uses `Date.UTC(y, m + offset, 1)` which handles year rollover and month lengths correctly,
and month-end is computed as `setUTCMonth(m + 1, 0)`. `isoDateSchema` genuinely validates calendar
dates (rejecting `2026-02-29`, `2025-04-31`) rather than just matching a regex. The tenant fixture
carries `timezone: 'Asia/Jerusalem'`. Date-only values are stored as strings, not `Date` objects.

The two failures are at the edges:

1. **Host-local time in the legal-deadline rule.** `quarterly-national-insurance.ts` calls
   `new Date()` by default and reads `getFullYear/getMonth/getDate`. Nothing anywhere converts to
   `Asia/Jerusalem`. Israel is UTC+2/+3 with DST, so a UTC host is 2–3 hours behind Israel's calendar
   date every night — and this is the code that decides whether a statutory payment is late
   (DOM-03).

2. **Calendar days pinned to UTC midnight, compared as instants.** `expiresOn` and `dueDate` become
   `T00:00:00.000Z` and are compared with `<= now`, so a permit valid _through_ 1 September reads
   expired throughout 1 September Israel time (DOM-17). The comment at manage-case-tasks.ts:47 shows
   the author reasoned about one direction of the shift; the inclusive/exclusive question was never
   settled.

DST specifically: nothing performs local-midnight arithmetic across a DST boundary (all the
month/day maths is UTC-based or uses `date` types in SQL), so there is no DST-specific
miscalculation. The exposure is the constant 2–3 hour offset, not the twice-yearly transition.
`deriveBillingAccessState`'s `Math.floor((now - anchor) / 86_400_000)` inherits the same offset —
the grace window flips at 02:00/03:00 Israel time rather than midnight, which is harmless here but
is the same latent pattern.

**Verdict: one shared date module short of correct.** Add `packages/domain/date.ts` with
`israelToday(instant)`, `israelStartOfDay`, `israelEndOfDay`, forbid `new Date()` in rule code via
lint, and route every deadline comparison through it.

## Rule-versioning assessment

`packages/rules` contains a well-designed governance model — `GovernedRule` carries `effectiveFrom`,
`effectiveUntil`, `status`, and a `source` with `authority` / `lastReviewedAt` / `reviewStatus`, and
`evaluateGovernedRules(rules, facts, asOf)` filters on all of it and returns provenance with every
result. `StartVisaRenewalWorkflow` refuses to start unless the evaluation is `active`,
`reviewRequired === false` and carries at least one source reference. The intent is exactly right.

**No rule in the product uses it.** `evaluateGovernedRules` is called only from its own test file.

The legal/statutory constants that do exist are hardcoded, undated and unsourced:

| Constant                                                                  | Location                                                                                                                                      | Effective-dated?        | Sourced? |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------- |
| National-insurance payment deadline = 15th of the month after quarter end | `apps/web/src/quarterly-national-insurance.ts:107` (and the `.replace(/15$/,'09')` / `'14'` string surgery at :133-136 for the warning bands) | No                      | No       |
| NI quarter boundaries (Jan–Mar, Apr–Jun, …)                               | same file, :36-41, :88-92                                                                                                                     | No                      | No       |
| Weekly rest day = Saturday                                                | `apps/web/src/payroll-calculation.ts:63` (`getDay() !== 6`)                                                                                   | No                      | No       |
| Partial-month proration divisor = non-Saturday days in month              | same file, :67, :89                                                                                                                           | No                      | No       |
| Document "expiring soon" window = 30 days                                 | `packages/application/src/use-cases/manage-case-documents.ts:47`                                                                              | No                      | No       |
| Billing terms version `'2026-08-04'`                                      | `packages/domain/src/status.ts:85`                                                                                                            | Versioned (good)        | n/a      |
| VAT rate                                                                  | `vatRateBps` — per-subscription DB column, not hardcoded                                                                                      | Per-row, but no history | n/a      |

What is **absent** rather than wrongly hardcoded — and this is a deliberate, defensible choice the
code states repeatedly ("this table stores inputs and totals; it does not assert that any calculation
is legally correct", migration 0028:1-2; "never invent entitlement", collaboration.ts:83): there is
no severance calculation, no notice-period rule, no leave-accrual or entitlement engine, no pension
or severance contribution rates, no הבראה rate, and no NI rate or ceiling. The user types every
figure. `projectSharedLeave` returns `availableBalance: null` until an approved rule supplies one,
and `createEventPlan` responds to `caregiver_resigned` / `employer_termination` / `recipient_died`
with "review payroll" and "request professional review" rather than a computed severance figure.
For a pilot this is the honest answer.

**Assessment:** the constants above are the ones that will silently become wrong. The NI deadline is
the sharpest: it is a statutory date, it is hardcoded in a browser file, it has no effective-from,
and it is used to tell families whether they are late. When (not if) a payment window changes, every
historical view recomputes with the new deadline and the record of whether a family was late in a
past quarter changes retroactively. Move it into `packages/rules` as a `GovernedRule` with a real
`source` and an `effectiveFrom` — the machinery is already built and tested, it just has no rules in
it. The 30-day expiry window and the Saturday rest day belong there too (the latter arguably as
per-case configuration rather than a rule).

Two defects in the governance machinery itself, for when it is finally used: DOM-18 (version-string
tie-break beats effective date; `effectiveUntil` string comparison breaks if `asOf` carries a time).

## What is done well

- **`authorizeOrThrow` (packages/application/src/use-cases/authorize.ts).** One place to check
  permission, structurally impossible to refuse without auditing the refusal, with the audit write
  wrapped so a logging failure can neither open the gate nor turn a 403 into a 500. The docstring
  explains the incident it was built for. This is the single best piece of code in the review, and
  it is undermined only by the paths that don't use it (DOM-12).
- **The workspace shrink guard (ports/workspace-repository.ts:15-50).** A server-side refusal to
  commit a save that blanks a populated account, motivated by a real data-loss incident that the
  test file documents in full, with a threshold deliberately chosen so ordinary editing never trips
  it. Excellent defensive design and excellent commit archaeology.
- **Append-only receipts with linked evidence.** `payroll_month_close` grants only `select, insert`,
  and each close row carries the ids of the timeline and audit events written in the same
  transaction. That is the right shape for a regulated record — DOM-01 is a hole in the perimeter
  around it, not a flaw in the design.
- **Refusing to invent legal truth.** `projectSharedLeave` returns `null` for a balance rather than
  computing one; `StartVisaRenewalWorkflow` refuses to start on an unverified rule;
  `payroll_entry`'s migration comment states plainly that it asserts nothing about legal
  correctness; `SAFE_RULE_OUTPUTS` restricts rule effects to suggestions and reviews. Given how easy
  it would be to ship a plausible-looking severance number, the discipline here is notable.
- **Determinism where it was attempted.** `projectComplianceTimeline`, `projectCaseHealth` and
  `projectFutureCost` take every input explicitly including `today`, do no IO, and are genuinely
  pure. `projectFutureCost` even validates its own inputs (`finite and non-negative`) and returns
  per-component provenance with `ACTUAL` / `FORECAST` / `UNKNOWN` status so a number can be
  explained. The bugs in it (DOM-05, DOM-06) are arithmetic, not architectural.
- **The base64 decoder (manage-case-documents.ts:59-83)** is hand-rolled specifically to keep the
  application layer runtime-agnostic, and throws on malformed input rather than silently writing a
  truncated file. The reasoning is documented.
- **Branded ids** (`TenantId` vs `UserId` etc.) make a whole class of parameter-swap bug a compile
  error.
- **`mvp-profile-architecture.test.ts`** is an architectural fitness function that pins the legacy
  browser-local model to a reviewable allowlist, with a comment saying new business data belongs in
  the domain layer. The team already knows about the problem this review found; the test is the
  guardrail against it growing.

## Coverage note

`find packages -name '*.test.ts' -o -name '*.spec.ts'` returns 42 files. The in-scope packages pass:
`packages/application` runs 6 files / 37 tests green in ~1s.

**What is well covered:** schema validation is genuinely thorough — `validation-hardening.test.ts`
tests impossible calendar dates (`2026-02-29`, `2025-04-31`, `2026-13-01`) against _every_ mutation
entry point, real leap dates, five classes of malformed email, reversed date ranges, and Hebrew/
English mixed text. The shrink guard has eight tests including the exact threshold. The billing
collection use case tests the succeed/fail/audit orchestration. Rule status-gating and effective-date
boundaries are tested.

**What is not covered — the money and the state machines:**

- **Rounding.** No test anywhere asserts a half-agora case. `roundMoney(8.165)` returning `8.16`
  while `roundMoney(1.015)` returns `1.02` is invisible to the suite. There is no test that the
  displayed total equals the stored total.
- **`projectFutureCost` double-count (DOM-05).** No test constructs an expense that is both
  `frequency: 'monthly'` and carries a `dueDate` — the exact combination that breaks. The suite has
  eight `projectFutureCost` tests and none covers it.
- **`projectFutureCost` actual-month expense drop (DOM-06).** Tests cover a month with an actual, and
  a month with a known expense, but never a month with both.
- **Closed-month immutability (DOM-01).** There is no test asserting that saving a `payroll_entry`
  for a closed month is rejected — because no code rejects it. This is the single most valuable
  missing test in the repository.
- **Total reconciliation (DOM-02).** No test submits a `total` inconsistent with its components.
- **Timezone and DST.** Zero tests reference `Asia/Jerusalem`, a timezone offset, or a DST boundary.
  The quarterly-NI deadline logic (DOM-03) is tested — if at all — only with the host's timezone,
  so the failure is invisible on a CI runner and on the developer's machine alike. No test freezes
  the clock at 00:30 Israel / 22:30 UTC, which is where the bug lives.
- **Overdue-quarter disappearance (DOM-03b).** No test advances `today` past a missed deadline into
  the following month to assert the quarter is still surfaced.
- **Month boundaries in payroll.** `projectPayrollAnalytics` is tested with two months; there is no
  December→January rollover test, no test of a month absent from the middle of a year, and no test
  of a month whose entries are dated on the 1st or the 31st.
- **Zero and negative values.** `projectFutureCost` rejects negatives (tested), but
  `calculateMonthlyPayroll`'s `Math.max(0, …)` clamp and `safeAmount`'s NaN→0 coercion (DOM-07) have
  no test asserting the intended behaviour — so neither is pinned, and neither is questioned.
- **Leave-ledger day/range consistency (DOM-11).** No test submits `days: 200` for a three-day range.
- **Compliance-status ageing (DOM-08).** `deriveComplianceStatus` is unit-tested at three points
  (`manage-case-documents.test.ts:109-111`) and the function is correct; what is untested is that
  nothing ever _calls_ it again. An integration test asserting that a document listed after its
  expiry reports `expired` would fail today.
- **State machines.** `isAllowedTransition` has three tests and no production callers — the only
  fully-tested dead code in the repo. The employment-case lifecycle has no transition test because
  it has no transitions. The visa-renewal completion guard is real but lives in SQL, so it is covered
  only by DB-backed tests (`packages/db/src/visa-renewal-progress-repository.test.ts`), not by any
  unit test the domain layer can run.

The pattern is consistent: **validation is tested, calculation is not.** The suite would catch a
malformed date in a request body and would not catch the wrong salary being paid.

---

### REL-13

**[LOW] Applied-migration immutability is measured against `main`, not against what production actually ran**

_Area: Release · source: [`05-release-safety.md`](05-release-safety.md)_

- **ID:** REL-13
- **File:** `packages/db/src/migration-safety.ts:97-102`; `packages/db/src/migration-safety-cli.ts:10-21`
- **What:** The immutability rule rejects any migration whose git status is not `A` relative to the comparison base — `origin/$GITHUB_BASE_REF` in CI (`migration-safety-cli.ts:16-18`), `HEAD^` locally (`:20`). This works, and history confirms it: no migration in this repo has ever been edited after reaching `main`. The two files with multiple commits (`0024`: `254a5cd` after `33bbd05`, PR #41; `0035`: `ea3ca81` after `1e94dff`, PR #102) were both edited _within their own PR before merge_, which is legitimate and correctly permitted.
- **Why it matters:** The check equates "not yet merged" with "not yet applied". But migrations are applied manually by an operator from a local checkout (`PILOT_RELEASE.md:8`, `database/README.md:39`) — which may be a feature branch. If someone runs `pnpm db:migrate` from an unmerged branch against a shared or production database and then edits that migration before merge, the check reports `A` and passes, while the database holds the earlier text forever. `0024` is the live illustration: `254a5cd` rewrote its RLS policies from `app.current_tenant_id()` to `current_setting('app.tenant_id', true)::uuid`. Had the pre-edit version been applied anywhere, that database now has policies that differ from the committed file and — because of REL-01 — no ledger row recording which version it got.
- **Fix:** Make the ledger record a content hash: extend `schema_migrations` with a `checksum` column, have the runner compute and store it, and have `/ready` or a `db:verify` command compare stored checksums against the files on disk. That detects drift regardless of git state. Separately, document that migrations are applied only from `main`.
- **Confidence:** CONFIRMED (mechanism); NEEDS-VERIFICATION whether any migration was ever applied from an unmerged branch — that is operator history, not repo state.

---

### REL-14

**[LOW] The migration connection disables TLS certificate verification**

_Area: Release · source: [`05-release-safety.md`](05-release-safety.md)_

- **ID:** REL-14
- **File:** `packages/db/src/pool.ts:20-26`, specifically `ssl: { rejectUnauthorized: false }` at `:23`
- **What:** Every pool — including the owner/admin pool that `cli.ts:30` uses to apply migrations to production Supabase — connects with certificate verification disabled. The comment at `:16-19` acknowledges it: "we require TLS but don't pin a CA here (the managed endpoint is trusted); tighten to a pinned CA before production."
- **Why it matters:** Mostly a security finding and largely another agent's scope, but it lands on the deploy path: this is the connection that carries DDL and the owner credential to production. An attacker positioned between the operator and Supabase can present any certificate.
- **Fix:** Pin Supabase's CA bundle and set `rejectUnauthorized: true` for the admin connection at minimum. The TODO is already written at `pool.ts:19`.
- **Confidence:** CONFIRMED

---

### REL-15

**[LOW] No release artifact ties a deployed build to the schema version it requires**

_Area: Release · source: [`05-release-safety.md`](05-release-safety.md)_

- **ID:** REL-15
- **File:** `DEPLOYMENT.md:8`; `PILOT_RELEASE.md:37`; `docs/operations/production-release-and-recovery.md:95-113`
- **What:** The release record captures the promoted commit SHA (`DEPLOYMENT.md:8`) and "the last known-good commit and Vercel rollback deployment" (`PILOT_RELEASE.md:37`). Nothing records which migration numbers were applied for that release, or which range of migrations a given build tolerates.
- **Why it matters:** This is what makes "roll back to the last known-good commit" a guess rather than a decision. An operator at 2am cannot answer "does build X work against schema 0035?" without reading migrations. Given REL-04, the answer is sometimes no.
- **Fix:** Add two lines to the release record: highest applied migration, and the oldest build SHA still compatible with it. Embed the required migration version in the build (see REL-05's fix) so the answer is mechanical.
- **Confidence:** CONFIRMED

## Safe-release checklist this repo should adopt

Ordered so that the first four are prerequisites for shipping anything, and the rest harden the
process afterwards.

**Before the next release can happen at all**

1. Reconcile the production `schema_migrations` ledger for `0024`, `0027`, `0030` — after a verified
   backup, in one reviewed transaction, having first confirmed the five affected tables exist and
   match the committed DDL. (REL-01)
2. Move the ledger insert into `packages/db/src/migrate.ts` with `on conflict do nothing`, and add a
   CI test that runs `runMigrations` twice and asserts the second call returns `[]`. (REL-01)
3. Stand up a separate Supabase project for staging, scope every Vercel variable per environment,
   and remove the hardcoded production API host from `apps/web/vercel.json:8`. (REL-02)
4. Add an environment guard and a `--dry-run` to `pnpm db:migrate`, and an advisory lock around the
   apply loop. (REL-03)

**Every migration, enforced in CI rather than reviewed by eye**

5. Exactly one `insert into schema_migrations` per file, naming its own version.
6. Migration numbers unique, and strictly greater than every number on `origin/main`. (REL-08)
7. `set local lock_timeout` and `statement_timeout` at the head of every migration transaction, so a
   blocked `ALTER` fails fast rather than freezing the table behind it. (REL-07)
8. New `CHECK` and FK constraints added `NOT VALID`, validated in a separate statement — the pattern
   `0020:50-55` already establishes. (REL-04, REL-07)
9. Scanner rules for `UPDATE ... SET`, `CREATE INDEX` without `CONCURRENTLY` on a pre-existing table,
   `ADD CONSTRAINT` without `NOT VALID`, and destructive SQL inside `execute '<literal>'`. (REL-06)
10. Data-writing migrations batched, restartable, and row-count-verified, with the reverse statement
    written in a comment even absent a down-runner. (REL-09)

**Every release**

11. `/ready` compares `max(schema_migrations.version)` against the version the build requires, so a
    behind-schema database fails the deployment gate. (REL-05)
12. Both Vercel projects report the same git SHA before sign-off. (REL-11)
13. Release record names: promoted SHA, highest applied migration, oldest still-compatible build SHA.
    (REL-15)
14. Verified backup taken before any migration touches production — the procedure at
    `production-release-and-recovery.md:38-70` is already written; it needs to be executed and its
    checksum record filed, not rewritten.
15. Migrations applied only from `main`, never from a feature branch. (REL-13)

**Structural, worth doing before the customer base grows**

16. A `checksum` column on `schema_migrations` plus a `db:verify` command, so schema drift is
    detectable rather than assumed away. (REL-13)
17. A minimal per-tenant feature flag table, giving cohort rollout and a sub-minute kill switch that
    does not require a redeploy. (REL-12)
18. An opt-out marker letting a specific migration run outside a transaction, so `CREATE INDEX
CONCURRENTLY` becomes available for large tables. (REL-07)

## Coverage note

**Read in full:** `package.json`, `packages/db/src/migrate.ts`, `cli.ts`, `pool.ts`,
`migration-safety.ts`, `migration-safety-cli.ts`, `rls-check-ci.ts`, `packages/db/package.json`,
`.github/workflows/ci.yml`, all four `scripts/check-*.mjs`, `DEPLOYMENT.md`, `PILOT_RELEASE.md`,
`AGENTS.md`, `.env.example`, both `vercel.json`, `docs/operations/production-release-and-recovery.md`,
`database/README.md`, `database/migrations/README.md`, `database/seed/README.md`,
`apps/web/src/environment.ts`, and migrations `0001`, `0016`, `0017`, `0020`, `0026` (both), `0030`,
`0035`.

**Read in part:** `packages/db/src/rls-check.ts` (fixture construction, guards, cleanup block),
`apps/api/src/container.ts` (readiness), `apps/web/src/api/client.ts` (base URL resolution),
`apps/api/src/routes/product-differentiation.ts` (escalation status writes), `0019`, `0024`, `0027`,
`0032`, `docs/governance/RELEASE-GATE.md`, `docs/governance/VERIFY-PRODUCTION.md`.

**Scanned systematically:** all 36 files in `database/migrations/*.sql` via targeted greps for
`drop`, `truncate`, `delete from`, `alter column`, `set not null`, `rename`, `create index`,
`not null default`, `add column`, `update ... set`, `insert into`, `commit`, `concurrently`,
`create type`, `alter type`, `vacuum`, `create extension`, plus a per-file count of
`insert into schema_migrations`. Git history checked per migration file for post-merge edits.

**Verified negatives (searched, genuinely absent):** feature-flag mechanism; API version prefix or
version header; down/rollback migrations; `pg_advisory_lock` in the runner; `lock_timeout` /
`statement_timeout`; seed script under `database/seed/`; `VERCEL_ENV` handling in either app; any
`db:migrate` invocation in a Vercel build command.

**Not verified — outside repo state, needs a human with dashboard access:**

- Whether `required-quality-gates` (`ci.yml:210`) is actually configured as a required status check
  in GitHub branch protection. The job is correctly written to fail unless all seven upstream jobs
  succeed (`:232-239`), but a workflow cannot enforce its own requiredness.
- Vercel per-environment variable scoping — specifically whether `DATABASE_URL` and the Supabase
  variables on the API project are set to "All Environments" (the dashboard default when adding a
  variable, and the condition that would make REL-02 immediately exploitable) or scoped to
  Production only.
- Whether any migration has ever been applied to a shared database from an unmerged branch (REL-13).
- The current production `schema_migrations` contents — the REL-01 analysis predicts `0024`, `0027`
  and `0030` are absent; confirming that before the next release is the single highest-value check
  in this report.

**Explicitly out of scope, covered by other agents:** API route logic and authorization, frontend
behaviour, RLS policy correctness (assessed here only where a migration's lock or ordering profile
depends on it), backup/DR adequacy, and the domain layer.

---

### WEB-22

**[LOW] A regulation-rule admin console is rendered inside consumer Settings**

_Area: Frontend · source: [`02-frontend.md`](02-frontend.md)_

- **ID:** WEB-22
- **File:** apps/web/src/pages/SettingsPage.tsx:568
- **What:** `<RegulationRulesAdmin />` — a draft → in_review → approved → active → retired lifecycle editor for regulatory rule content — renders unconditionally at the bottom of every user's Settings page, with no role check on the client.
- **Why it matters:** The target user is a family employer, not a content reviewer. If the server permits the read they can see and attempt to transition regulation rules; if it denies it they get a permanent `role="alert"` load-error at the bottom of their Settings page (the e2e fixture explicitly stubs this endpoint with `[]` "so the page is free of load-error alerts" — meaning the real behaviour is a visible error). Either way the screen is in an impossible state for its audience.
- **Fix:** Gate on an explicit role from the API and render nothing (not an error) when the user is not a reviewer; move the console to its own route.
- **Confidence:** CONFIRMED

---

### WEB-23

**[LOW] `canonicalVersion` optimistic-lock field is declared and documented but never written or read**

_Area: Frontend · source: [`02-frontend.md`](02-frontend.md)_

- **ID:** WEB-23
- **File:** apps/web/src/storage/mvp-storage.ts:551-552
- **What:** `MvpPayrollRecord.canonicalVersion?: number` is commented "Server optimistic-lock version", but `grep -rn canonicalVersion apps/web/src` returns only this declaration; `PayrollPage.savePayroll` (line 525) does not carry `existing?.canonicalVersion` forward.
- **Why it matters:** Dead scaffolding that reads as implemented safety. If a future canonical cutover starts consuming it, records saved through today's `PayrollPage` will carry no version and will either be rejected or overwrite server state unconditionally.
- **Fix:** Remove the field, or populate it from `savePayrollEntry`'s response and preserve it on every local re-save.
- **Confidence:** CONFIRMED

## Save-path matrix

| Screen                       | Mutation                                                | Validated?                                                 | Error surfaced to user?                             | Input recoverable on failure?                        | Verdict                                                           |
| ---------------------------- | ------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| OnboardingPage               | debounced `saveMvpOnboardingDraft` (localStorage)       | n/a (draft may be invalid)                                 | No — static "נשמר" always shown                     | Yes (draft), unless the write threw                  | **Fails** — unconditional success claim (WEB-15)                  |
| OnboardingPage               | `complete()` → `setProfile` (localStorage + sync)       | Yes, per-step + `currentValid` gate                        | No — throw is uncaught → white screen               | No                                                   | **Fails** (WEB-06); stale draft can overwrite newer data (WEB-15) |
| SettingsPage                 | submit → `setProfile(draft)`                            | Yes (`profileIsValid` disables submit)                     | No error path at all                                | State survives, but untouched fields are overwritten | **Fails** (WEB-03)                                                |
| EmployeePage                 | submit → `setProfile(draft)`                            | `required` only                                            | No                                                  | Draft survives in state                              | Weak — whole-object write                                         |
| PayrollPage                  | wizard → `saveMvpPayroll` + `saveMvpEmploymentExpenses` | Yes, thorough per-step + full re-validation on save        | Validation yes (`role="alert"`); storage failure no | **No** — no draft, no nav guard                      | **Fails** (WEB-02, WEB-06)                                        |
| PayrollPage                  | `saveSalarySettings`                                    | Yes (base salary > 0, effective date)                      | Yes (`message`)                                     | Yes                                                  | OK                                                                |
| PayrollPage                  | `saveExpense` / `toggleExpense` / `removeExpense`       | Partial (category + due date)                              | Validation yes; storage failure no                  | Draft survives                                       | Weak (WEB-06)                                                     |
| PayrollIntelligence          | `closeCanonicalPayrollMonth`                            | Guard only (`total > 0`, date set)                         | **No — nothing at all**                             | n/a                                                  | **Fails** (WEB-01)                                                |
| CanonicalPayrollIntelligence | `savePayrollEntry`                                      | No client validation beyond `Number()`                     | Yes (`role="alert"`, 409 handled)                   | Draft survives the save, but not a sibling refetch   | **Fails** (WEB-04)                                                |
| CanonicalPayrollIntelligence | `createScenarioExpense` / `deleteScenarioExpense`       | Yes (label + amount)                                       | Yes (`expenseError`)                                | Yes                                                  | OK, but wipes the payroll draft (WEB-04)                          |
| DocumentsPage                | `saveDocumentFile` + `saveMvpDocuments`                 | Yes (size, MIME, file present)                             | Yes, but always blames device storage               | Yes                                                  | **Fails** — double-submit (WEB-08)                                |
| DocumentsPage                | `removeDocument` / `openDocument`                       | Confirm dialog                                             | **No** — unhandled rejection                        | n/a                                                  | **Fails** (WEB-07)                                                |
| TasksPage                    | `saveMvpTasks` (create/edit/toggle/delete)              | `required` only                                            | Success message only; storage failure uncaught      | Draft survives                                       | Weak (WEB-06)                                                     |
| MedicationsPage              | `saveMvpMedications`                                    | Name non-empty                                             | Success only                                        | Draft survives                                       | Weak (WEB-06)                                                     |
| ReminderRecipientsSection    | `saveMvpReminderRecipients`                             | Name non-empty; consent gate is correct                    | Success only                                        | Draft survives                                       | Weak (WEB-06)                                                     |
| CaseContactsSection          | `addCaseContact`                                        | Yes (zod resolver)                                         | Yes (`Alert`), `isSubmitting` guard                 | Yes (values preserved by design)                     | Good, except refetch conflation + no idempotency (WEB-09)         |
| CaseTasksSection             | `createCaseTask` / `completeCaseTask`                   | Yes (zod)                                                  | Yes, per-action                                     | Yes                                                  | Same caveat (WEB-09)                                              |
| CaseDocumentsSection         | `uploadCaseDocument`                                    | Yes (zod + size + MIME)                                    | Yes                                                 | Yes                                                  | Same caveat (WEB-09)                                              |
| VisaRenewalSection           | `startVisaRenewal`                                      | Yes (zod, UUID shapes)                                     | Yes, 4 distinct codes                               | Yes                                                  | Good error handling; unusable inputs (WEB-12)                     |
| CollaborationPanel           | responsibility / task assignee PUT                      | None                                                       | **No**                                              | n/a (select snaps back)                              | **Fails** (WEB-07)                                                |
| CollaborationPanel           | worker-request status PATCH                             | None                                                       | **No**                                              | n/a                                                  | **Fails** (WEB-07)                                                |
| ProductCompletionPanel       | `confirmAssistantChecklist`                             | None                                                       | **No**                                              | n/a                                                  | **Fails** (WEB-07)                                                |
| ProductCompletionPanel       | `createProfessionalReview` (escalate)                   | None                                                       | **No**                                              | n/a                                                  | **Fails** (WEB-07)                                                |
| ProductCompletionPanel       | `transitionProfessionalReview`                          | Note ≥3 chars for `resolved`                               | Yes (`transitionError`)                             | Yes (notes kept in state)                            | OK                                                                |
| AutomationPanel              | `confirmAssistantChecklist`                             | Date-order validation                                      | Yes (saving/saved/error)                            | Yes                                                  | **Good — reference implementation**                               |
| FamilyAccessPage             | invite / role change / revoke                           | HTML constraints only                                      | Yes, 5 distinct codes                               | Fields cleared before refetch on invite              | Mostly good (WEB-09, WEB-16)                                      |
| BillingPage                  | `startBillingPaymentMethodSetup` / cancel               | Consent + provider gates, `busy` guard                     | Yes, but as a _load_ error replacing the form       | State survives, form hidden                          | **Fails** (WEB-16)                                                |
| EmergencyBinderPage          | `createBinderExport`                                    | Selection non-empty, in-flight guard                       | Yes — explicit "unrecorded print" labelling         | n/a                                                  | **Good**                                                          |
| RegulationRulesAdmin         | create / transition rule                                | Yes (`draftIsValid`)                                       | Yes, per-action, `busy` guard                       | Yes                                                  | **Good**                                                          |
| WorkerPortalPage             | acknowledge payment / new request / preferences         | `required`/`maxLength` only                                | **No, on all three**                                | Message text survives; nothing else                  | **Fails** (WEB-07)                                                |
| LoginPage                    | sign in / sign up / reset / magic link                  | Yes (`validateRegistration`)                               | Yes, per-action statuses                            | Yes                                                  | **Good** — `submittingRef` double-submit guard                    |
| workspace-sync               | `saveWorkspace` (background)                            | Snapshot guards (`unreadableKeys`, empty-before-hydration) | Yes — shell banner + retry                          | Yes (`dirty` flag persisted to meta)                 | **Good**                                                          |

## What is done well

- **`workspace-sync.ts` is the strongest file in the frontend.** `wouldDestroyRemoteData` refuses to PUT an empty or partially-decryptable snapshot over a populated server workspace, `hydratedThisSession` correctly distinguishes "the customer has no data" from "we have not read the server yet", generation counters prevent a stale response from clobbering a newer session, the `VERSION_CONFLICT` retry only proceeds when the remote fingerprint is unchanged, and `pauseWorkspaceSync` vs `stopWorkspaceSync` correctly separates transient auth loss from explicit sign-out. The comments explain _why_, with production evidence.
- **Account isolation genuinely works for the localStorage layer.** `canUseCachedWorkspace` gates on an owner marker _and_ decryptability, and `startWorkspaceSync` clears the cache, the IndexedDB store and the crypto key before any UI can render another account's data. I could not construct a path where account B reads account A's `caredesk.mvp.*` values.
- **`packages/ui`** is small, documented and accessibility-first: every component's doc block states its states, ARIA contract and RTL behaviour; `Alert` correctly splits `role="alert"` from `role="status"` by severity; `Skeleton` announces once through a visually-hidden live region; `TextField` requires a real label and links errors via `aria-describedby`.
- **`AutocompleteField`** is a correct WAI-ARIA combobox (arrow keys, `aria-activedescendant`, `onMouseDown` before blur) that allows free text rather than acting as a whitelist.
- **`AutomationPanel.confirmPlan`** is exactly the save shape the rest of the app should copy: explicit `saving`/`saved`/`error` states, disabled while in flight, distinct `role="status"`/`role="alert"` messages.
- **`EmergencyBinderPage.exportBinder`** records a server-side receipt before printing and, when the server is unreachable, uses `flushSync` to label the printed page as an unrecorded local copy — an honest failure mode rather than a silent one.
- **Onboarding's draft persistence** (synchronous restore inside `useState` initialisers, immediate write on radio taps, wizard-only choices stored separately from the committed profile) is thoughtful, and the reason the payroll wizard's total absence of the same is so conspicuous.
- **`ReminderRecipientsSection`'s per-recipient consent model** (`consentAt`/`consentBy` timestamps, `canReceiveReminders` as the single send gate, a status column that says _why_ someone will not be contacted) is a correct treatment of third-party health data.
- **CSS discipline for the audience**: 44/48 px minimum touch targets appear consistently, there is a `--ui-scale` font-size control persisted across reloads, a skip link, and a dedicated responsive width-matrix release gate.

## Coverage note

Unit coverage is broad by file count (40+ `.test.tsx`) and genuinely strong on pure logic — `payroll-calculation`, `payroll-report`, `quarterly-national-insurance`, `israeli-id`, `onboarding-fields`, `reminders/schedule` and `workspace-sync` (which does test hydration failure, version conflict and the unreadable-cache guard). The gaps sit precisely on the failing save paths above.

- **No test covers a failed mutation for the screens that swallow errors.** `grep` for `mockRejected`/`Promise.reject` shows failure-path tests exist for auth, billing, binder, regulation rules, canonical payroll and the case sections — but not for `PayrollIntelligence.closeMonth`, `ProductCompletionPanel`, `CollaborationPanel`'s PUT/PATCH handlers, `WorkerPortalPage`'s three mutations, or `DocumentsPage.removeDocument`/`openDocument`. Every WEB-07 instance is untested.
- **The e2e fixtures structurally hide WEB-01/WEB-14.** `canonical-product-intelligence.ts` routes `/cases/[^/]+/timeline`, `/cases/[^/]+/health` and `/cases/[^/]+/payroll-month-closes` by wildcard regex, so passing the local MVP client id where a canonical case id is required returns 200 in every test. No test asserts that the id sent to a `/cases/…` endpoint is a case id.
- **The reused-idempotency-key bug is one assertion away.** `launch-readiness.spec.ts:361` asserts `closeMutationCount() === 1` after closing a single month; the fixture already tracks `closeMutations` and `responsesByKey`. Closing a _second_ month in the same page session and asserting `closeMutationCount() === 2` would fail today.
- **No test exercises navigation away from a dirty form.** `atm-onboarding-mobile.spec.ts` covers draft autosave and step resume for onboarding, but nothing navigates away from a half-filled payroll wizard or Settings form and returns; WEB-02 and WEB-03 would both be caught by such a test.
- **No test covers a storage write failure.** Stubbing `localStorage.setItem` to throw would immediately expose WEB-06 (white screen) and WEB-15 (false "saved").
- **`SettingsPage.test.tsx:179` asserts the wrong half of the invariant** — that the edited field survives a late profile — without asserting that the _untouched_ hydrated fields survive the subsequent save. Extending that one test is the cheapest way to pin WEB-03.
- **Only one e2e test injects an HTTP error** (`login-progress.spec.ts`, a 400 on sign-in). There is no offline/500 e2e for any save path, and no test asserts that a failed sign-out tells the user anything (WEB-10).
- `OpenCasePage` has a test file but no route — its coverage is entirely notional (WEB-11).

---
