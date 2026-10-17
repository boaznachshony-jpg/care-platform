# CareDesk UX V2 — existing product, visual-only preview

Issue #133 · Draft PR #134 · `feature/caredesk-ux-v2` · Codex UX V2

## Scope

The revised user instruction is authoritative: show the existing product with a
new visual treatment only. Preserve all wording, headings, navigation, forms,
validation and behavior. No new features or product copy.

The separate entry imports `apps/web/src/main.tsx` unchanged. It therefore uses
the real App, AppShell, pages, translation resources, auth provider, storage,
API client and business logic. `prototype.css` adds scoped visual overrides:
neutral canvas, dark green navigation, lime selection accents, restrained card
borders and shadows, and an adaptive desktop tile grid. Existing dark mode,
font scaling, mobile navigation and focus behavior remain available. No text is
hidden, replaced or generated with CSS. Production files and shared tokens have
no changes relative to `origin/main`.

## Architecture and isolation

The React/TypeScript/Vite app and Fastify API share the existing domain,
application and schema packages. Existing tests cover auth, tenant isolation,
task/medication synchronization, component accessibility and business rules.

The preview runner calls the existing `buildServer(loadEnv({...}))` with an
explicit development environment and no database, auth or delivery credentials.
It uses the existing in-memory repositories, mock providers and development
token. It creates one synthetic case through the actual API. Nothing connects
to a production database and no schema or API is changed.

The web build does not read .env files, overrides product environment inputs,
and proxies its API to the loopback server. Web ports are 4182 (built preview)
or 5182 (development); API port is 4183. All bind to 127.0.0.1, with strict ports.
The browser fixture refuses other origins and never replaces an existing
workspace. It uses the product's encrypted browser storage.

Build output is `apps/web/build/ux-v2/dist`, separate from the production build.
The built CSP permits same-origin API requests. Existing external reference
links are retained. No new dependencies or lockfile changes are needed.

## Run

From the repository root, after installing dependencies:

```sh
pnpm build
pnpm --filter @caredesk/web build:ux-v2
pnpm --filter @caredesk/web preview:ux-v2
```

Open <http://127.0.0.1:4182/clients/ux-v2-demo>.
The original landing page remains at `/`; there is no preview-only redirect.
For hot reload, stop the preview runner and run
`pnpm --filter @caredesk/web dev:ux-v2`, then use port 5182.

Use synthetic data only. Browser edits survive reloads within the existing
product storage model; server data lasts only until the preview runner stops.
After a server restart, use a fresh browser session or clear only this demo
origin's site data for a clean fixture. Do not clear another development origin.
Do not deploy or merge without the user's explicit authorization.

## Validation and review

- Fixture tests check encrypted storage round-trip, preservation of existing
  workspace/preferences, and refusal to seed outside the dedicated origin.
- Existing product unit/integration/accessibility suites are run without edits.
- Browser review covers the dashboard, original task creation/completion and
  completed filter, medication entry, dark mode, text scaling and mobile layout.
- Review screenshots are `caredesk-ux-v2-desktop.jpg` and
  `caredesk-ux-v2-mobile.jpg` alongside this document.

Known baseline limitation found during review: canonical rule-generated tasks
have `title: null`, a `titleKey`, and `dueAt: null`. The existing legacy task
mapping does not translate `titleKey` and formats the empty date as
`undefined.undefined.`. This is visible in the real task screen and was not
patched or hidden by the design layer. It needs a separate product fix.

## Review boundary

Current baseline: origin/main de26938, synchronized into the isolated branch.
No dependency on current launch, payroll or sponsor work. Shared design tokens,
component contracts, product/legal authority and all production behavior remain
unchanged. This document records the experimental visual proposal for human
review; it grants no release or deployment approval.

Validation result (2026-10-13): full `pnpm check` passed (1719 tests: 799 web, 433 API, plus workspace packages); separate preview build passed. Desktop 1440px and mobile 390px reviewed; 320px with enlarged text had no page-level horizontal overflow.

## Visual review — 2026-10-17

Reviewed the case picker, dashboard, tasks, standing medications, payroll,
documents and settings at desktop (1440px) and mobile (390px) widths. Also
checked the dashboard at 320px with the maximum existing text scale (1.3),
desktop navigation at that scale, and the medication screen in dark mode.

Only `apps/web/src/ux-v2/prototype.css` changed in this review:

- Corrected the case picker's brand contrast, neutral surfaces and action-row
  layout. Mobile actions now measure 58px high instead of inheriting a 170px
  horizontal flex basis as their height.
- Removed the duplicate mobile environment-banner inset. Desktop sidebar and
  topbar insets account for the existing font zoom; the sidebar stays within
  the viewport and its remaining links can scroll into view.
- Restored native checkbox/radio dimensions to 24px, with labels retaining at
  least a 48px touch target. Standing-medication forms have clearer grouping.
- Let dashboard tabs wrap when enlarged text needs extra room. Adaptive tile
  columns keep labels within their cards. CSS scroll margins keep the same
  navigation targets below the sticky header.
- Harmonized close buttons, task filters and the mobile overflow menu with
  the existing preview palette. Kept the shared on-accent foreground intact
  and scoped the light-green button foreground to preview primary buttons.

The case picker and medication screen retained identical main-content text
and control signatures in before/after browser comparisons. Original page,
component, translation, routing, storage, API and domain files have no diff
against `origin/main`. Existing task-title/date defects remain visible.

Validation: full `pnpm check` passed again (1,719 tests); final preview build
and CSS formatting check passed. No page-level or control horizontal overflow
was found in the reviewed layouts. Task/document forms, native medication
choices, original navigation, theme switching and text-scale controls were
exercised without submitting real data.

The active review session is at
<http://127.0.0.1:5182/clients/ux-v2-demo>. The built preview remains available
on port 4182. Both use the same isolated in-memory API on port 4183; existing
browser workspaces are preserved. Additional case-picker and medication-form
screenshots accompany the review artifacts. PR #134 remains a draft; no merge
into main or production deployment was performed.
