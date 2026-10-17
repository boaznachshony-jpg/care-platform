# CareDesk Agent Coordination Dashboard

This dashboard is the shared coordination state for concurrent engineering agents. Update it in the same PR whenever ownership, dependencies, blockers, or next action change.

## Coordination rules

- Authority: `origin/main` + GitHub Issues + PRs + this dashboard.
- Before work/resume/push: fetch and synchronize with the latest `origin/main`.
- One active task has one owning agent unless an explicit split is recorded here.
- Dependent implementation waits for prerequisite merge unless `Parallel safe` is explicitly `yes`.
- A blocked agent records the blocker here instead of silently waiting.

## Active work

<!-- prettier-ignore -->
| Workstream | Issue | Owner/Agent | Branch | PR | Status | Depends on | Parallel safe | Blocker | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Current delivery coordination | — | Orchestrator | `main` | — | ACTIVE | — | n/a | None recorded | Assign each new task through an Issue and update this row set before parallel implementation |
| Approved side-environment payment integrity | #151 | Codex parent coordinator | `feature/caredesk-ux-v2-payments` | #155 | ACTIVE | main `bd97d27`; approved RULE-01..12 | yes | Hosted TEST PostgreSQL unverified; professional entitlement inputs not supplied and remain inactive | Synchronize upstream NI stage 2, rerun every clean-install CI gate, then deliver TEST preview only if runtime isolation is verified |
| Wave 3 canonical Product Intelligence closure | — | Codex primary | `codex/finalize-wave-3-closure-for-product-intelligence` | #48 | DONE | — | no | None; merged main CI succeeded at `a97f61f` | Retain as completed dependency evidence |
| Final capability and production-readiness assessment | — | Codex primary | `codex/final-product-gap-production-readiness` | #50 | DONE | PR #48 | no | None; merged at `dc98410` | Retain as production-readiness scope authority |
| Emergency Binder, Event Wizard, and monthly-close cleanup | — | Codex primary | `codex/perform-final-product-gap-closure-review` | #52 | BLOCKED | PR #50 | no | Branch synchronized locally at `b90dc79`, but Playwright Chromium download is forbidden (HTTP 403) and GitHub credentials are unavailable for push/merge | Run hosted E2E and push the synchronized merge commit from an authenticated environment; payroll work may continue because the blocker does not overlap it |
| Canonical payroll UI and Future Cost cutover | #54 | Codex primary | `codex/case-scoped-payroll-ui-cutover` | — | BLOCKED | PR #55 merged at `f5d7bc8` | no | `origin` remote, live PostgreSQL, and hosted browser/CI access are unavailable; local quality gates pass | Push the committed branch, open the prepared Issue #54 PR, and run PostgreSQL RLS plus hosted Playwright/CI from an authenticated environment |
| Pipedream CI monitoring | #51 | Agent | `feat/pipedream-ci-monitoring` | #53 | DONE | — | yes | None | Merged at `a38cadd`; Pipedream webhook + GitHub Secrets configured; closes #51 |
| Binder + Wizard canonical data sources | #63 | Agent (P1) | `fix/binder-wizard-canonical-closure` | #67 | DONE | — | yes | None | Merged |
| CanonicalPayrollIntelligence reconciliation purge | #62 | Agent (P1) | `fix/legacy-payroll-reconciliation` | #68 | DONE | — | yes | None | Merged at `857ec88` |

## Required status values

Use exactly one of: `PLANNED`, `ACTIVE`, `BLOCKED`, `IN_REVIEW`, `MERGED_VERIFYING`, `DONE`, `CANCELLED`.

## Update contract

For every active engineering task, add one row containing:

- Workstream: short human-readable scope
- Issue: `#123`
- Owner/Agent: unique agent/task label
- Branch: exact branch name
- PR: `#123` or `—` before creation
- Status: one allowed value
- Depends on: prerequisite Issue/PR or `—`
- Parallel safe: `yes`, `no`, or `n/a`
- Blocker: exact blocker or `None`
- Next action: one concrete next step

When a task reaches `DONE`, retain the row until the next coordination closeout so downstream agents can see the completed dependency history.

## Handoff record

Every agent handoff must include: Issue, branch, PR, latest commit, completed scope, validation evidence, blockers, dependencies, and next action.

## Freshness rule

If this dashboard conflicts with merged code or GitHub state, `origin/main` and GitHub are authoritative. The orchestrator must correct this file immediately; agents must not proceed using a known-stale dashboard.

## Approved payment implementation — 2026-10-17

The user approved RULE-01..RULE-12 and explicitly authorized the teams to implement their payment changes and rerun acceptance tests in the side environment. This supersedes prior review-only restrictions for this workstream. All product copy/headings and unrelated behavior remain frozen. The user excludes merge and production deployment. This change set stays local for review; no commit, push, deployment or production schema/data/credential access was performed.

Issue #151 owns this implementation; parent coordinator is sole owner. Local worktree feature/caredesk-ux-v2-payments is based on authoritative origin/main 94fc72e. Original feature/caredesk-ux-v2 preview and draft PR #134 remain untouched at 67460dc; this is an explicit separate change set from visual-only #133. App worktree creation was unavailable because the task root is not a Git repository, so a native local Git worktree was created in the task work directory.

Parallel scopes are explicitly safe under these file ownership boundaries. Agents may communicate interface contracts; no second owner edits the same file without parent reassignment.

| Team                    | Owned implementation files                                                                                                                                                                                                                                                                                              | Rules                                                            | Status    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------- |
| Financial rules         | packages/domain/src/payroll-policy*; packages/domain/src/proration*; packages/domain/src/payroll*; packages/domain/src/index.ts; packages/application/src/product-intelligence*; packages/schemas/src/payroll-policy*; packages/schemas/src/index.ts; database/migrations/0050_payroll_policy_rules.sql                 | RULE-01..09 computation/policy, signed forecast, policy types    | IN_REVIEW |
| Persistence/month close | apps/api/src/payroll-entry-service*; apps/api/src/routes/payroll-entries*; apps/api/src/product-intelligence/canonical-intelligence-service*; apps/api/src/routes/canonical-product-intelligence*; apps/api/src/payroll-policy-resolver*; database/migrations/0049_payroll_settlement_integrity.sql                     | RULE-09/10/12, canonical context persistence, transactions/locks | IN_REVIEW |
| Reports/client          | apps/web/src/payroll*; apps/web/src/pages/PayrollPage*; apps/web/src/pages/case/CanonicalPayrollIntelligence*; apps/web/src/components/PayrollIntelligence*; apps/web/src/components/canonical-close-split*; apps/web/src/api/client.ts; apps/web/src/api/strict-bodies*; new payroll-specific sync/helper/test modules | RULE-06/08/11 and approved client validation/finalization        | IN_REVIEW |
| Parent coordinator      | AGENT_STATUS.md; readiness/migration lists; test runtime junctions; integration acceptance harness outside product; isolated PostgreSQL lifecycle; review report and copy checks                                                                                                                                        | Shared contract, integration and acceptance                      | ACTIVE    |

Shared interface direction: payroll-entry may add optional calculationContext, persisted as JSONB without rewriting historical monetary total semantics. Domain exposes deriveApprovedPayrollComponents(input, context, month, verifiedRules) and assertPayrollMoneyPrecision(input); legal arithmetic only uses server-owned effective reviewed policy configuration, never client self-attestation. Historical/no-context amounts stay compatible. New month-close input adds payrollVersion; canonical final entry is required and verified under the same lock as save. New receipts carry settlementBasis, calculationTotal and employerContributions, with total meaning payable to worker for new canonical receipts. Historic receipts remain explicitly legacy_total. Client migrates/finalizes an existing legacy record only as part of the existing explicit close action; it must never silently overwrite authoritative canonical data. Server rejects arbitrary legacy references; retain old receipt bytes.

Rule configurations are not invented or pre-activated. Source/effective/review requirements remain binding. PR #135 is existing independent holiday-formula work; do not merge it or overwrite its branch. Domain contextual rules must avoid inventing a universal holiday/rest-day equivalence. Teams do not start or mutate the shared stopped PostgreSQL cluster; parent alone provisions a NEW disposable database and runs acceptance. All fixtures are synthetic. No agent pushes, commits or opens a competing PR.

Integration review assigned additive database/migrations/0051_payroll_context_integrity.sql exclusively to Persistence/month close. Migrations0049/0050 were applied to the isolated synthetic acceptance database and are frozen.0051 closes demonstrated direct SQL bypasses for reparenting a closed month, case/month payment-event linkage, and reviewed policy snapshot provenance; no production database is accessed. Initial real PostgreSQL integration suite:506/506 PASS. Parent owns migration readiness/RLS ledger updates and live verification.

Final regression integration assigns apps/web/src/api/error-contract.ts to Reports/client for the new payment API status/code mappings, reusing existing translation messages without copy changes. Parent owns removal of obsolete proration export-allowlist entries now that the governed engine calls those exports.

Final migration compatibility review assigns only the external acceptance artifact work/payment-implementation-2026-10-17/upgrade.mjs to Persistence/month close. Parent retains sole database lifecycle/execution ownership. This checks old entry/receipt values across0049–0051 in another explicitly isolated synthetic database; no product source is changed by this follow-up.

## Payment implementation handoff — #151

- Branch/commit: local feature/caredesk-ux-v2-payments, uncommitted changes on 94fc72e; no new PR. Original preview/draft PR #134 remains at67460dc.
- Completed: governed computation and historical policy snapshots; exact cents guards; immutable payment event identities; source-validated negative carry; serialized canonical final/version close with replay; canonical-first annual/NI data; employment cost independent of prior payments; unchanged product wording/headings and approved visual files.
- Acceptance:865/865 PostgreSQL checkpoints PASS (529 monetary/API/report,169 governed/date,17 direct SQL/fault rollback,6 encrypted workspace/NI,120 actual database restart,24 historical upgrade). All fixtures synthetic in caredesk_payment_fixes_151 and caredesk_payment_upgrade_151, loopback55439;52 migrations, repeated migration pass0; RLS forced and app role has no BYPASSRLS. Upgrade preserves every old column of entry/receipt/Audit/Timeline and explicitly marks legacy_total. Cluster stopped after acceptance.
- Local tests: domain110,schemas33,application93,db136,testing14,API463,web897 PASS (1,746 total). Final payment/error-contract subset166 PASS is included in the web total. Builds/typechecks/lint/format/architecture/migration ledger/copy and17 exact copy/approved-design checks PASS.
- Limits: no professionally supplied numeric entitlement policies, accrual balances or statutory caps were activated; contexts missing a reviewed effective server rule fail closed. Own packages are rebuilt from this worktree, but third-party dependencies reuse installed demo runtime; exact main lockfile parity/clean CI is not claimed.
- Next: user review of payment-fixes-review.html and local changes; clean-install CI and professional policy inputs before any later merge/production decision. No merge or production deployment is performed by this handoff.

## Clean CI and conditional external TEST preview — 2026-10-17

The user explicitly authorizes clean-install CI and, only after every required gate passes, updating the external TEST demo for desktop/mobile. Commit, branch publication and a draft PR for CI are now authorized necessary steps. No merge, production deployment, production data access, product copy/headings/unrelated behavior change, or unverified entitlement activation is authorized.

Parent owns branch synchronization onto fetched main4eef894, preserving the independently added0049_national_insurance_report.sql and all existing payment migrations by full filename. Before first branch publication, Git auto-deploy is disabled only for the CI branch in both Web/API Vercel configs; an exact verified commit may be delivered via a dedicated preview branch after CI passes. Main/project-global deployment settings are unchanged.

Financial rules team may edit only scripts/check-migration-ledger.mjs and a focused guard fixture/test to document the exact independent0049 filename collision while rejecting all other collisions. Parent owns readiness ordering/conflict resolution and dependency/build/preview config integration. Other agents remain read-only until explicitly assigned.

Hosted TEST PostgreSQL has not yet been verified. Existing external adapter deliberately has no pool; it must not be misrepresented as durable canonical payment testing or silently changed to fake successful saves. CLI GitHub/Vercel authentication is unavailable, so authenticated GitHub connector remains the CI publication route if Git push cannot authenticate. Original demo remains unchanged until successful clean CI and verified TEST runtime.

The synchronized payment implementation is committed at88f0dfb on main4eef894. The exact0049 collision guard and nine positive/negative tests passed locally against all53 migrations; existing demo-failure remains rejected. These focused results supplement, and do not replace, the previous94fc72e acceptance evidence. Hosted CI will install pnpm11.16.0 with the frozen lockfile in fresh checkouts. Publication includes branch-specific deployment suppression before any remote push; no external demo has been updated yet.

Draft PR #155 now owns the branch. Git credential manager successfully published74783b0; local gh CLI remains unavailable. Hosted run39052305772 has successful frozen-lockfile installs and guardrails. Independent review found browser E2E fixtures did not yet model canonical payroll entries: Reports/client is assigned only apps/web/e2e/fixtures/canonical-product-intelligence.ts and the payroll expectations in smoke.spec.ts, launch-readiness.spec.ts and responsive-width-matrix.spec.ts. Extend the synthetic test boundary with actual entry/version/finalization contracts; preserve all copy and production guards, keep reload/replay/close assertions, and do not substitute that browser fixture for hosted TEST persistence. Parent owns integration and push. Other agents remain read-only.

Initial clean CI at74783b0 passed static, compile/typecheck, all1,922 workspace unit/integration/accessibility tests, guardrails, secret scan, PostgreSQL17 RLS, and migration idempotency (53 applied,0 on repeat). Browser E2E is pending the fixture correction and a full rerun at the resulting commit. The external demo remains unchanged: its old memory-only adapter cannot register canonical payroll save/close routes; a separate hosted TEST PostgreSQL/auth identity and encryption key must be verified before any delivery. Read-only Vercel/GitHub/local metadata checks found no TEST DB identity, and no deployments for either PR #155 commit as of17:08:16 UTC. No production credentials are borrowed and no numeric entitlement policies are activated.

Before the next push, main advanced tobd97d27 (#154 NI stage 2 copy). Parent stopped to inspect all8 changed files: this is an additive copy of saved workspace NI snapshots, gated on actual workspace hydration; the workspace remains write authority. It does not change payroll arithmetic or the existing preserved report lines. Preserve the upstream API/client/hook/workspace/i18n changes verbatim; do not introduce local product copy changes. Parent will merge main into this already published isolated branch without force-pushing, review any overlapping PayrollPage/API-client context, and rerun full clean CI including the new upstream tests. Reports/client may complete its assigned test-only fixture correction on the reviewed baseline; no further product scope is assigned.
