# Current GitHub State

## Main
`ead8482628921af035855a8ab15e25a255043fe2`

Required checks on protected main:
- Format, lint, typecheck, test, build
- Playwright end-to-end
- Secret scan
- CodeQL

## Merged
### PR #55
Canonical `payroll_entry` backend:
PostgreSQL aggregate, RLS, case APIs, authorization, idempotency, optimistic locking, Timeline/Audit, rate limiting, CodeQL and hosted CI.

### PR #65
Canonical case-scoped payroll UI and Future Cost cutover:
authenticated `/cases/:caseId`, open-month `payroll_entry`, closed-month `payroll_month_close`, conflict handling, explicit legacy preparation, no UUID inference, no permanent dual-write.

## Candidate branch
`codex/perform-final-product-gap-closure-review`
Head `2179da8cd745d0d3999e6e323a7d16ab8b8e034c`
Only two files differ from main. Not merge-ready.

## Legacy payroll branch
`codex/legacy-payroll-reconciliation` currently equals main; no published implementation.

## Open PR #53
Pipedream CI observability only; historical HTTP 401; must not block product readiness.

## Dependency PRs
Dependabot #56–#59 are open. Do not mix them into closure work.
