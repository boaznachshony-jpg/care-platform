# ADR-006 amendment 1: National Insurance report months on the periodic payment

Status: **Accepted by owner, 17.10.2026**
Amends: [ADR-006](ADR-006-normalized-persistence-migration.md), clause 5
Proposed: 2026-10-17 (work plan of 16.10.2026, item L)

Acceptance, in the Product Owner's words (17.10.2026): "כן, מאשר את החריגה
המתועדת מ-ADR-006 עבור L: שורות הדיווח החודשי לביטוח לאומי נשמרות עם התשלום
עד שתהיה טבלה בשרת. ותרשום את הטבלה בשרת כמשימה להמשך."

The server table is recorded as backlog item R5-09 in
`docs/governance/PRODUCT-UX-IMPROVEMENT-BACKLOG.md`.

## Context

The payroll screen builds a National Insurance report one month per line, in
the shape of the Institute's own form: was the caregiver employed that month,
the wage reported (whole shekels), the rate, and the amount. The family can
correct any line before saving.

On save, only the total survived. `PayrollPage.tsx` wrote the amount onto the
`MvpEmploymentExpense` row and threw the lines away. Reopening the payment
re-derived them from whatever the payroll records and contract salary said
*now*. A report that was filed could not be shown again as it was filed, and
any correction the family had made was gone.

Clause 5 forbids adding a product field to the workspace payload. There is no
canonical (PostgreSQL) home for a National Insurance report yet, and creating
one needs a migration and a server aggregate, which are outside this change.

## Decision

`MvpEmploymentExpense` may carry `nationalInsuranceMonths`: an array of
`MvpNationalInsuranceReportMonth` (`month`, `employed`, `wage`, `ratePercent`,
`amount`). It is written only when a National Insurance payment is saved from
the report table, and read only to reopen that payment for editing.

This is compatibility-only in the sense of clause 5: it keeps data the product
already produced and was discarding. It adds no new kind of input, and the
lines are the same figures the family sees on screen.

It is recorded in `scripts/adr-006-freeze-baseline.json` under `exceptions`,
which is what `scripts/check-adr-006-freeze.mjs` requires.

## Removal condition

Delete the field, the `MvpNationalInsuranceReportMonth` interface and the
baseline entry once National Insurance reports are stored in normalized
PostgreSQL under the tenant-scoped `EmploymentCase` aggregate, and the web
client reads and writes them there. The freeze check fails while the baseline
entry names an interface that no longer exists, so the entry cannot outlive
the field.

## Consequences

- Until then the workspace snapshot is the only store for these lines. That is
  the exact risk clause 5 names. It is accepted because the alternative today
  is discarding them.
- The lines travel with the expense through workspace sync as part of the
  same opaque `caredesk.mvp.employment-expenses.v1` entry. No server or schema
  change is involved.
