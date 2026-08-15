# Wave 3 Product Intelligence

## Baseline and exact gap analysis

Wave 3 starts at `d3d15cc`, the merge of PR #39. The first-parent history contains PRs #31–#39, including the complete Visa Renewal workflow, closeout documentation, validation hardening, PostgreSQL RLS checks and desktop/mobile Playwright suites.

The repository already had canonical tenant/case, task, document/document-version, employment-authorization, workflow/rule-evaluation, Timeline and append-only Audit models. The MVP payroll calculator/history and employment expenses were also reused. It did **not** have a shared attention/health projection, analytics/forecast logic, or a durable monthly-close receipt. Fixed illustrative Timeline entries were a gap and have been removed rather than treated as real deadlines.

## Projection architecture

`@caredesk/application/product-intelligence` is the presentation-independent source for Timeline grouping, file health, payroll analytics and forecast calculations. Inputs carry explicit tenant, case and clock values. Timeline facts are filtered by both scopes, deduplicated by stable ID, and retain source provenance. Web adapters translate existing MVP facts into these inputs; UI pages do not calculate scores.

Derived projections are not persisted. Existing governed workflow facts can retain `ruleId` and `ruleVersion`; no new legal rule or deadline is activated.

## Scoring methodology

The score is normalized to 0–100 over applicable factors. Current web factors are employment-agreement presence, saved authorization/visa dates, medical-insurance record completeness and overdue persisted tasks, each weighted 20. Optional/not-applicable factors are removed from the denominator. Every factor exposes its weight, points, explanation, action and deep link. This is file completeness—not legal certification.

## Forecast assumptions

The forecast repeats only the entered base salary and expenses explicitly marked monthly. Dated persisted expenses appear as “known” in their month; other values are “projected.” It introduces no statutory rate, entitlement, inflation or inferred amount. Missing values contribute zero and assumptions remain inspectable.

## Monthly-close lifecycle

A close requires an existing positive payroll record, payment date and method. One immutable receipt is allowed per tenant/case/month, making replay idempotent. The durable schema links the receipt to same-tenant case, optional evidence document, Timeline evidence and Audit evidence. Application grants are select/insert only; reopening is unavailable until governance approves it. Worker acknowledgement is `not_supported`, never fabricated.

Hosted CI evidence remains required before Wave 3 may be declared complete.
