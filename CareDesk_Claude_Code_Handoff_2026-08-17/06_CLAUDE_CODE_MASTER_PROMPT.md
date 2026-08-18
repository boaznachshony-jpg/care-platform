# Claude Code Master Handoff Prompt

Repository: `boaznachshony-jpg/care-platform`

Read first:
- `AGENTS.md`
- `AGENT_STATUS.md`
- `BUILD_STATUS.md`
- `docs/governance/final-product-gap-and-production-readiness.md`
- `docs/architecture/canonical-payroll-cutover.md`
- this handoff package

Handoff main:
`ead8482628921af035855a8ab15e25a255043fe2`

Do not trust older status docs when they conflict with merged code.

Merged milestones:
- PR #55: canonical payroll backend/RLS/idempotency/rate limiting/evidence.
- PR #65: case-scoped canonical payroll UI + Future Cost precedence.

Critical architecture:
- never infer EmploymentCase from `/clients/:clientId` or UUID formatting
- canonical authority is authenticated `/cases/:caseId`
- closed payroll = `payroll_month_close`
- open entered payroll = `payroll_entry`
- no permanent dual-write
- `caredesk.mvp.*` is compatibility/transitional only
- tenant authority server-derived
- FORCE RLS + same-tenant integrity
- durable idempotency + appropriate Timeline/Audit

Immediate candidate:
branch `codex/perform-final-product-gap-closure-review`
head `2179da8cd745d0d3999e6e323a7d16ab8b8e034c`
two-file diff only:
- EmergencyBinderPage.tsx
- AutomationPanel.tsx

DO NOT merge as-is.
First fetch latest main, compare, check compile/runtime dependencies, identify which historical PR #52 companion changes are still needed, add/repair tests, run full gates, and create a fresh PR because PR #52 is closed.

Then complete Issue #62 safe legacy payroll reconciliation:
audit paths, explicit case context, compare matching/differing canonical data, no silent overwrite, no destructive deletion before read-back, closed-month protection, retry/idempotency/evidence, desktop/mobile E2E, cross-tenant denial.

Required gates:
format, lint, build, typecheck, unit/integration/accessibility, migration safety, RLS when applicable, full Playwright desktop/mobile, secret scan, CodeQL, aggregate gate, preview where applicable, post-merge main CI.

Do not:
- broad refactors
- mix Dependabot upgrades
- reactivate local monthly-close authority
- enable unapproved AI/OCR/WhatsApp
- suppress security findings
- claim COMPLETE from local tests alone

Every handoff must report branch, PR, SHA, files, architecture, tests, hosted checks, blockers, and readiness recommendation.
