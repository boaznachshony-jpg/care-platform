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
| Approved UX V2 visual integration: home/tasks/medications | #159 | Codex parent coordinator | `feature/caredesk-ux-v2-visual` | #160 | IN_REVIEW | main `dffc9c7`; approved design #133/#134 | yes | None for visual-only PR; full payment TEST and inherited NI copy blockers remain in #151 | Review draft #160 after fresh CI; no merge or deployment is authorized |
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

## Visual-only UX integration — #159, 2026-10-17

The human explicitly authorizes a clean visual PR from approved demo #134 against latest main, separate from payment PR #155. Initial targets are the existing client home/entry, tasks and medications, including their shared shell and existing forms. Preserve every product string/heading and all navigation, event handlers, auth, APIs, storage, schema, business logic and payment behavior. No merge or production deployment. Original demo `67460dc` and payment `7f1d487` remain untouched. This is an explicit deliverable split from #133, not an overlapping implementation of #151.

Parent created native isolated worktree work/caredesk-ux-visual from fetched main `dffc9c7` because the app task root has no Git repository for managed worktree creation. Issue #159 owns branch feature/caredesk-ux-v2-visual. Git branch name was checked absent before creation. CI branch automatic Web/API Git deployments will be suppressed before first publication. Normal builds stay visually unchanged; a dedicated opt-in TEST build enables only the target routes and rejects production build/runtime hosts. Approved fixtures, seeding, development auth, preview API/gateway/build adapters and payment files are excluded from this PR.

Parallel file ownership (no overlap):

| Agent                                                   | Files                                                                                                                                                                                                                                                                   | Status |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Parent coordinator                                      | AGENT_STATUS.md; apps/web/src/visual-ux/scope.ts and UxV2VisualLayer.tsx; minimal App.tsx visual mount; apps/web/vite.config.ts; package scripts; Playwright configs; CI workflow additive visual test step; Web/API branch deployment controls; runtime/CI/integration | ACTIVE |
| Financial rules agent reassigned to visual CSS          | Only apps/web/src/visual-ux/approved.css, extracted from approved `67460dc` prototype.css                                                                                                                                                                               | DONE   |
| Reports/client QA agent                                 | Only apps/web/src/visual-ux/*.test.tsx and apps/web/e2e/visual-ux.spec.ts                                                                                                                                                                                               | DONE   |
| Month-close agent reassigned to independent scope audit | Read-only source/design/behavior/auth/API/payroll boundary audit; no files                                                                                                                                                                                              | DONE   |

Test interface: scope.ts exports isVisualUxRoute(pathname) and isVisualUxEnabled({mode, hostname, pathname}); activation requires mode='ux-v2-test', existing non-production hostname classification, and exact selected routes (/app, /clients/:id home, scoped/unscoped tasks and medications). UxV2VisualLayer renders no DOM, uses router location, and adds/removes only document.documentElement class ux-v2-visual. Styles are scoped exclusively beneath that class; existing theme/font-scale preferences remain authoritative. Dedicated Playwright visual config serves baseline and TEST builds on separate loopback ports, compares semantic text/controls/actions using synthetic existing contract fixtures, and checks desktop/mobile. Default E2E excludes only the separately executed visual spec; no existing gate or assertion is removed.

Only this local/CI synthetic frontend test environment is used for #159. No hosted DB or payment rule prerequisites are invented, borrowed or bypassed. #151's full payment TEST and NI-copy blockers are independent and remain open. All CSS differences must be reviewed against actual target markup; no extra feature, copy, heading, tracking or behavior changes are assigned.

Implementation handoff: approved CSS provenance is verified against demo `67460dc` (79 retained rules, 101 original scoped selectors and 205 original declarations). One documented 761–1050px responsive block was added after measured horizontal overflow at 768px with dark theme and text scale 1.3; it wraps controls/actions without hiding, clipping or reducing targets. Target page code, product translations, auth, API handlers, storage, domain, schemas, database and lockfile are byte-identical to main `dffc9c7`. The only App change is the visual layer import and null-rendering mount inside the existing gates.

Browser validation: all 9 new cases pass locally (desktop/mobile semantic/action parity and all seven release-gate widths), including client entry, home, tasks, medications, forms, actual choice-label click areas, keyboard focus, reduced-motion parity, dark theme, maximum existing text scale, computed approved colors and excluded-route cleanup. Synthetic HTTP readback and edits/reloads are checked; no database/auth/RLS durability is claimed. Before/after screenshots were captured at 390/1440 px. Baseline/TEST bundles live under existing ignored dist subdirectories, so normal lint/format boundaries are unchanged. Dedicated production-build rejection was exercised successfully. Full lint, build and typecheck pass. The initial concurrent full unit run timed out in unchanged DB-01; the complete rerun passed all 1,922 tests with package concurrency 1 and maxWorkers 2, without changing assertions/timeouts. The final two desktop/mobile parity cases passed again after adding actual reduced-motion assertions. Draft PR #160 is open against main `dffc9c7`, implementation commit `1799d01`. The parent is verifying fresh GitHub CI on the final synchronized head; review is the next action. No merge or deployment is authorized.
