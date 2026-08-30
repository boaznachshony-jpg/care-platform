# Domain / Business Logic Review

Scope reviewed: `packages/domain`, `packages/application`, `packages/schemas`, `packages/rules`,
`packages/workflows`, `packages/config`, `packages/testing` (~6,000 LOC, read in full).

Because the money and legal-deadline logic is **not** in those packages, I followed it to where it
actually lives (`apps/api/src/payroll-entry-service.ts`, `apps/api/src/product-intelligence/`,
`apps/web/src/payroll-calculation.ts`, `apps/web/src/quarterly-national-insurance.ts`,
`database/migrations/0023/0026/0028/0033`) and reviewed the *rules* there. Route plumbing, RLS and
migration mechanics are left to the agents who own them; the findings below are about the
calculations and state machines themselves.

## Summary

The layering is genuinely good where it exists: deny-by-default authorization funnelled through one
audited helper, branded ids, ports/adapters, deterministic projections, append-only receipts, an
explicit refusal to invent legal entitlements. Nothing here is sloppy by accident — the comments show
a team that thought about this.

But the domain layer stops short of the domain. `packages/domain` defines
`PAYROLL_PERIOD_STATUSES`, `PAYMENT_RECORD_STATUSES` and `EMPLOYMENT_CASE_STATUSES` as vocabulary and
then never implements a payroll aggregate, a payment, or a single case-status transition.
`packages/rules` is an empty shell with a well-designed `GovernedRule` type (effectiveFrom /
effectiveUntil / source / reviewStatus) that **no rule in the product uses**.
`packages/workflows`' only state machine, `isAllowedTransition`, is dead code — referenced solely by
its own test.

Meanwhile the real business rules landed in three places the domain layer cannot see or test:
the browser (`payroll-calculation.ts`, `quarterly-national-insurance.ts`), raw SQL strings in API
services, and DB check constraints. The consequences are concrete and confirmed below: a closed
payroll month can still be edited, the salary total the server stores is whatever the browser sent,
a missed national-insurance quarter silently disappears from the UI, and the annual cost forecast
double-counts some expenses and drops others.

Money is represented two incompatible ways (integer agorot for product billing, floating-point
shekels for caregiver payroll and forecasting), and the one rounding helper in the codebase is a
`Number.EPSILON` hack that rounds `1.015` up and `8.165` down.

Highest-value fixes, in order: (1) refuse to write a `payroll_entry` for a closed month;
(2) recompute the payroll total server-side instead of trusting the client's number; (3) move the
quarterly-NI deadline off host-local `new Date()` and stop hiding overdue quarters; (4) pick one
money representation (minor units, integer) and one rounding rule, and put both in `packages/domain`.

## Findings

### [BLOCKER] A closed payroll month is still fully editable
- **ID:** DOM-01
- **File:** apps/api/src/payroll-entry-service.ts:97-149 (write path); database/migrations/0028_canonical_payroll_entry.sql:43 (`grant select, insert, update`); apps/web/src/storage/mvp-storage.ts:703 (`saveMvpPayroll`)
- **What:** `payroll_month_close` is correctly append-only (`grant select, insert` only, migration
  0023:39, with a `unique (tenant_id, employment_case_id, payroll_month)` so a month cannot be closed
  twice). But the *underlying facts* are not frozen with it. `PayrollEntryService.save` does an
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

### [BLOCKER] The stored salary total is whatever the browser computed — never recalculated server-side
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

### [BLOCKER] Quarterly national-insurance deadline uses the host timezone, and an overdue quarter silently vanishes
- **ID:** DOM-03
- **File:** apps/web/src/quarterly-national-insurance.ts:67-82,122-145
- **What:** Two defects in the only encoded legal deadline in the product.
  (a) `createQuarterlyInsuranceTask(today = new Date())` defaults to wall-clock time and
  `localIso()` reads `getFullYear/getMonth/getDate` — **host local timezone**, not Asia/Jerusalem.
  (b) `relevantQuarter()` returns the previous quarter only during the first month of a quarter
  (`month % 3 === 0`). From the 1st of the second month it switches to the *current*, not-yet-ended
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

### [HIGH] Currency is floating-point shekels in payroll/forecast, integer agorot in billing, with an EPSILON rounding hack
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

### [HIGH] The cost forecast double-counts a recurring expense that also carries a due date
- **ID:** DOM-05
- **File:** packages/application/src/product-intelligence.ts:182-187, 286-287
- **What:** `knownExpenses` sums every expense whose `dueDate` falls in the month; `recurring` sums
  every `frequency: 'monthly'` expense in window. `forecastTotal = projected(salary + recurring) +
  knownExpenses + scenarioTotal` — an expense that is *both* monthly and dated lands in both sums.
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

### [HIGH] Known expenses are silently dropped from any month that has an actual payroll
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
  renewal due in a month whose salary happens to be closed disappears from that month's total *and*
  from the 12-month total and the reserve recommendation. A family planning its cash reserve is
  under-told by exactly the expenses that are hardest to absorb (the lumpy annual ones). The row
  also self-contradicts: `known: 500, total: 95`.
- **Fix:** `total = actualPayroll + knownExpenses + scenarioTotal`. The actual replaces the *salary
  forecast*, not the whole month.
- **Confidence:** CONFIRMED

### [HIGH] Payroll inputs silently coerce negatives and NaN to zero, and the net is clamped at zero
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

### [HIGH] Document compliance status is computed once at upload and never recomputed
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

### [HIGH] A partially-discounted subscription is displayed with a price and then never charged at all
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

### [HIGH] There is no employment-case state machine, and the one state machine that exists is dead code
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

### [HIGH] Leave-ledger day counts are unconstrained by their own date range, and a cancelled entry can be un-cancelled
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

### [HIGH] Payroll, leave and month-close authorization bypasses the audited `authorizeOrThrow` path
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

### [MEDIUM] `packages/schemas` is the shared contract for the early endpoints only — every money and leave endpoint defines its own
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

### [MEDIUM] Monthly-close reconciliation tolerance is looser than the DB constraint it feeds
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

### [MEDIUM] Infrastructure failures during visa-renewal completion are reported as a validation error
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
  so the *rule* is right; the error handling around it is not.
- **Why it matters:** A dropped connection, a serialisation failure, a typo in the SQL and a genuine
  "you have an unresolved overlap review" all produce the identical `COMPLETION_INVALID` code. The
  user is told their workflow is invalid when the database was merely unavailable, retries, gets the
  same message, and the real cause never reaches an operator. It also erases the distinction the
  error model was built for: domain errors vs bugs.
- **Fix:** Have the repository throw a typed `VisaCompletionRejectedError` when its guarded update
  matches zero rows, and let everything else propagate.
- **Confidence:** CONFIRMED

### [MEDIUM] Monthly billing date drifts permanently after any month shorter than the anchor day
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

### [MEDIUM] A calendar-day expiry stored at UTC midnight reads as expired for the whole of its final valid day
- **ID:** DOM-17
- **File:** packages/application/src/use-cases/manage-case-documents.ts:116-118, 91 (`if (expiry <= now.getTime()) return 'expired'`); same pattern for due dates at manage-case-tasks.ts:47-49
- **What:** `expiresOn: '2026-09-01'` is persisted as `2026-09-01T00:00:00.000Z` and compared with
  `expiry <= now`. Israel is UTC+2/+3, so that instant is 02:00/03:00 on 1 September local — and the
  status is `expired` from then onward, i.e. for essentially the entire day.
- **Why it matters:** Israeli permits and visas state a *last valid date* (תוקף עד). Treating that
  date's start as the expiry instant reports a still-valid permit as expired a full day early, which
  in this product means an unnecessary escalation, an unnecessary bureau call, and erosion of trust
  in the alerts that matter. The same choice for task `dueAt` makes a task due today "overdue" from
  03:00 that morning. The inline comments show the timezone was thought about in one direction
  (never shifting *earlier*) but the inclusive/exclusive semantics of the boundary were not settled.
- **Fix:** Decide and document whether a stored date is the last valid day or the first invalid day,
  and compare against end-of-day in `Asia/Jerusalem` accordingly. A `packages/domain/date.ts` with
  `israelStartOfDay` / `israelEndOfDay` gives every caller one answer.
- **Confidence:** LIKELY (the comparison is certain; whether `expiresOn` means "last valid day" is a product decision I could not confirm from the code)

### [MEDIUM] Governed rule selection picks the highest version string, not the rule effective at the as-of date
- **ID:** DOM-18
- **File:** packages/rules/src/evaluator.ts:69-81
- **What:** Among rules sharing an id that pass the effective-date filter, the winner is
  `current.version.localeCompare(rule.version, undefined, {numeric: true}) < 0` — highest version
  string, with `effectiveFrom` used only as an eligibility gate, never as the tie-breaker. Also,
  `rule.effectiveUntil < asOf` is a string comparison: if a caller passes a full timestamp
  (`'2026-01-01T10:00:00Z'`) while `effectiveUntil` is a date (`'2026-01-01'`), the comparison is
  true and the rule is treated as expired on its own final valid day.
- **Why it matters:** This is the machinery intended to make historical recalculation correct. If
  v3 is a *correction* effective from 2027 and v2 is the rule in force during 2026, evaluating
  `asOf: '2026-06-01'` correctly excludes v3 (its `effectiveFrom` gate fires) — but if v3 were
  back-dated, or if two versions overlap in effect, the higher version number silently wins over the
  later effective date. The `asOf` mixing bug bites whichever caller first passes a timestamp
  instead of a date, and there is no runtime check that `asOf` is a plain date.
- **Fix:** Select by latest `effectiveFrom` ≤ asOf, using version only to break exact ties. Normalise
  `asOf` to `YYYY-MM-DD` on entry (or validate with `isoDateSchema`).
- **Confidence:** CONFIRMED (code read; the tie-break path is not exercised by any test)

### [MEDIUM] Idempotency state for outbound notifications lives in a process-local Map
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

### [MEDIUM] Partial-month proration hardcodes Saturday as the rest day and an undocumented divisor
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

### [LOW] Domain failures are returned as `null`, conflating distinct outcomes
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

### [LOW] Non-deterministic `new Date()` defaults in otherwise pure functions
- **ID:** DOM-22
- **File:** packages/application/src/automation/document-intake.ts:43 (`now = new Date()`); apps/web/src/quarterly-national-insurance.ts:122 (`today = new Date()`)
- **What:** Two functions default a time parameter to wall-clock time. Everything else in the
  application layer takes an explicit `Clock` port or a `today: string`.
- **Why it matters:** A default that reads the clock makes the function untestable without freezing
  time and unreproducible in an audit context — the same inputs no longer give the same output.
  For DOM-03 this default is part of a BLOCKER; on its own it is a latent hazard.
- **Fix:** Make the parameter required, as `projectComplianceTimeline` already does.
- **Confidence:** CONFIRMED

### [LOW] `eligibleChannels` uses a single-argument comparator
- **ID:** DOM-23
- **File:** packages/application/src/engagement.ts:50
- **What:** `channels.sort((a) => (a === preference.preferredChannel ? -1 : 1))` ignores `b`, so it
  is not a valid comparator. I checked all six orderings for the three-channel case and V8 currently
  produces the intended result, so nothing is wrong today.
- **Why it matters:** The outcome depends on the engine's sort implementation, not on the code. It
  is one added channel or one engine change away from silently choosing the wrong delivery channel.
- **Fix:** `(a, b) => Number(b === preferred) - Number(a === preferred)`.
- **Confidence:** CONFIRMED

### [LOW] A zero-total payroll month can be recorded but can never be closed
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

*Product billing* (what the family pays CareDesk) is done properly: integer agorot end to end
(`priceAgorot`, `vatRateBps`, `amount_agorot integer`), VAT split so the parts sum to the whole
(`vat = price - round(price / (1 + vatBps/10000))`), no float in the charge path. If the rest of the
system looked like this there would be nothing to report. The one flaw is DOM-09, where the
*displayed* discounted price and the *charged* price are computed by different code in different
languages and disagree.

*Caregiver payroll and forecasting* (the money that actually matters, and the regulated part) is
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
   `T00:00:00.000Z` and are compared with `<= now`, so a permit valid *through* 1 September reads
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

| Constant | Location | Effective-dated? | Sourced? |
|---|---|---|---|
| National-insurance payment deadline = 15th of the month after quarter end | `apps/web/src/quarterly-national-insurance.ts:107` (and the `.replace(/15$/,'09')` / `'14'` string surgery at :133-136 for the warning bands) | No | No |
| NI quarter boundaries (Jan–Mar, Apr–Jun, …) | same file, :36-41, :88-92 | No | No |
| Weekly rest day = Saturday | `apps/web/src/payroll-calculation.ts:63` (`getDay() !== 6`) | No | No |
| Partial-month proration divisor = non-Saturday days in month | same file, :67, :89 | No | No |
| Document "expiring soon" window = 30 days | `packages/application/src/use-cases/manage-case-documents.ts:47` | No | No |
| Billing terms version `'2026-08-04'` | `packages/domain/src/status.ts:85` | Versioned (good) | n/a |
| VAT rate | `vatRateBps` — per-subscription DB column, not hardcoded | Per-row, but no history | n/a |

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
tests impossible calendar dates (`2026-02-29`, `2025-04-31`, `2026-13-01`) against *every* mutation
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
  nothing ever *calls* it again. An integration test asserting that a document listed after its
  expiry reports `expired` would fail today.
- **State machines.** `isAllowedTransition` has three tests and no production callers — the only
  fully-tested dead code in the repo. The employment-case lifecycle has no transition test because
  it has no transitions. The visa-renewal completion guard is real but lives in SQL, so it is covered
  only by DB-backed tests (`packages/db/src/visa-renewal-progress-repository.test.ts`), not by any
  unit test the domain layer can run.

The pattern is consistent: **validation is tested, calculation is not.** The suite would catch a
malformed date in a request body and would not catch the wrong salary being paid.
