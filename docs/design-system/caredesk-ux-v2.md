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
borders and shadows, and a five-column desktop tile grid. Existing dark mode,
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

Current baseline: origin/main 6394a22, merged into the isolated branch.
No dependency on current launch, payroll or sponsor work. Shared design tokens,
component contracts, product/legal authority and all production behavior remain
unchanged. This document records the experimental visual proposal for human
review; it grants no release or deployment approval.

Validation result (2026-10-13): full `pnpm check` passed (1719 tests: 799 web, 433 API, plus workspace packages); separate preview build passed. Desktop 1440px and mobile 390px reviewed; 320px with enlarged text had no page-level horizontal overflow.
