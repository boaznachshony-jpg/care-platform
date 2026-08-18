# Open Work and Priorities

## P1-A — Stabilize Binder/Event Wizard candidate
Branch: `codex/perform-final-product-gap-closure-review`
Head: `2179da8cd745d0d3999e6e323a7d16ab8b8e034c`

Required:
1. Compare to latest main.
2. Inspect the two commits semantically.
3. Check missing companion changes from historical PR #52:
   - `CasePage` must pass `caseId` to `AutomationPanel`
   - Event Wizard tests
   - Binder tests
   - i18n saving/success/error strings
   - monthly-close local helper cleanup if still needed
   - truthful governance docs
4. Restore only what current main actually requires.
5. Run full quality gates.
6. Create a fresh PR linked to Issue #63 because PR #52 is closed.
7. Merge only after hosted checks are all green.

## P1-B — Issue #62 Legacy Payroll Reconciliation
PR #65 added preparation, not full reconciliation closure.

Still needed:
- audit every `caredesk.mvp.*` payroll/expense path
- classify REMOVE / MIGRATE / KEEP TEMPORARILY / NON-AUTHORITY
- explicit canonical case confirmation
- matching canonical record => reconcile without rewrite
- differing record => visible conflict, no silent overwrite
- closed month cannot be replaced
- retry + read-back verification
- reconciliation receipt/evidence
- no destructive delete until proven
- desktop/mobile E2E
- cross-tenant denial

## P1-C — Reconcile Issue #54
Its body is stale after PR #65. Update only after verifying actual closure evidence.

## Release readiness
- Family Collaboration Playwright
- Worker Portal Playwright
- production auth/MFA/invitations
- live managed Postgres/RLS
- object-storage controls
- monitoring/alerting/distributed rate limiting
- backup/restore drill
- payroll/legal/privacy sign-off

## Capability hardening
- Event Wizard atomic receipt + task side effects
- Audit completeness
- regulation approval lifecycle/content
- Human Escalation lifecycle
- secure server-side Binder export

## P2
Pipedream PR #53 / Issue #64. Non-blocking.
