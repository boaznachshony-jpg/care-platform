# CareDesk Agent Coordination Dashboard

This dashboard is the shared coordination state for concurrent engineering agents. Update it in the same PR whenever ownership, dependencies, blockers, or next action change.

## Coordination rules

- Authority: `origin/main` + GitHub Issues + PRs + this dashboard.
- Before work/resume/push: fetch and synchronize with the latest `origin/main`.
- One active task has one owning agent unless an explicit split is recorded here.
- Dependent implementation waits for prerequisite merge unless `Parallel safe` is explicitly `yes`.
- A blocked agent records the blocker here instead of silently waiting.

## Active work

UX V2 isolation note: the user explicitly authorized side-environment work alongside current fixes. Issue #133 owns only the new `apps/web/src/ux-v2` and standalone preview entry/config, additive scripts, and review documentation. The user narrowed scope to existing product screens, unchanged copy and behavior, with a scoped stylesheet and synthetic in-memory API harness. No production routes, auth, API, domain, storage, or schema changes. No dependency on launch or payroll work.

<!-- prettier-ignore -->
| Workstream | Issue | Owner/Agent | Branch | PR | Status | Depends on | Parallel safe | Blocker | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CareDesk UX V2 isolated prototype | #133 | Codex UX V2 | `feature/caredesk-ux-v2` | #134 (draft) | IN_REVIEW | — | yes | None; baseline 6394a22; pnpm check passed (1719 tests); existing task-title/date defect documented | Human review of visual-only revision in draft PR #134; no merge or production deployment |
| Current delivery coordination | — | Orchestrator | `main` | — | ACTIVE | — | n/a | None recorded | Assign each new task through an Issue and update this row set before parallel implementation |
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
