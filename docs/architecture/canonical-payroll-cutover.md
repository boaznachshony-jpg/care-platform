# Canonical payroll UI cutover and legacy reconciliation

Status: implementation candidate for Issue #54 (2026-08-17).

## Authority and precedence

The authenticated `/cases/:caseId` EmploymentCase is the only case identity accepted by the
payroll-entry API. Browser UUID shape and `/clients/:clientId` are never mapping authority. For
Future Cost, a `payroll_month_close` snapshot wins for a closed month, `payroll_entry` wins for an
open entered month, and only the absence of either canonical fact permits forecast/unknown output.

## Legacy inventory and decision

| Legacy path | Decision | Reason |
| --- | --- | --- |
| `caredesk.mvp.payroll.v1` | MIGRATE NOW, retain source temporarily | The case payroll surface offers explicit per-month preparation only after the user confirms the authenticated case. It saves once to `payroll_entry`; it does not dual-write or delete the source. Repeating preparation is harmless and the server command is optimistic-lock protected. |
| `caredesk.mvp.employment-expenses.v1` | KEEP TEMPORARILY | Expense forecasting has no approved canonical aggregate in this slice and cannot become payroll authority. |
| `caredesk.mvp.monthly-closes.v1` | REMOVE NOW as authority, retain historical bytes temporarily | Canonical `payroll_month_close` alone controls closed actuals. No product projection reads the local close as authority on the case surface. |
| MVP payroll scenario inputs | KEEP TEMPORARILY as planning only | They must never override a canonical payroll fact. |

## Reconciliation and rollback evidence

Migration is deliberately user-mediated: select a month inside an authenticated case, confirm the
legacy record belongs to that exact case, prepare a visible draft, then save it to the server. The
legacy bytes are not mutated or removed. A failed save therefore leaves a retryable source; a
successful response plus a reload provides canonical persistence evidence. Optimistic version
conflicts stop the write and require a server reload. Destructive cleanup is a later, separately
approved gate after production reconciliation evidence.
