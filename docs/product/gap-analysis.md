# Repository and Specification Gap Analysis

Status: **Updated after authority-document completion**
Audit date: 2026-07-23

## Preserved read-only findings

The following findings originate from Claude's repository audit and are
preserved without reinterpretation:

- Remote branches `api`, `web`, `mobile`, `infrastructure`, `docs`,
  `carepilot-app`, and `scripts` point to the same initial commit.
- That initial commit contains only the generic README; it contains no
  application code, configuration, or secrets.
- There is therefore no code to merge from those branches.

Local verification confirmed the branch finding. It also found that `main`
contains the specification DOCX files, the Markdown coding constitution, master
prompts, legal-validation material, and `caredesk_prototype.html`.

## Corrected document finding

Claude correctly reported that the following Markdown authority documents did
not exist in the audited repository state:

- Synchronization Matrix
- Design System & Component Catalog
- Database Blueprint
- Rules & Workflow Engine
- User Stories & Acceptance Criteria
- AI Review Constitution
- Repository Bootstrap Plan

They are created by this documentation change. The original Product
Specification and AI Coding Constitution already existed in DOCX form; the
constitution also existed as Markdown.

## Resolved gaps

| Gap | Resolution |
|---|---|
| No authority order | `docs/SOURCE_OF_TRUTH.md` |
| No cross-document synchronization control | `SYNC_MATRIX.md` |
| `Account` versus `FamilyAccount` conflict | `Tenant` technical boundary plus one-to-one `FamilyAccount` business profile |
| `CareWorker` versus `Caregiver` | `Caregiver` is canonical |
| Generic Workflow ambiguity | split into `WorkflowTemplate` and `WorkflowInstance` |
| Notification duty versus actual delivery | split into `NotificationRequirement` and `NotificationDelivery` |
| Mutable benefit balance | append-only `BenefitLedgerEntry` plus derived balance |
| Document record versus file version | split into `Document` and `DocumentVersion`; visa and insurance remain typed domain records |
| Missing status vocabulary | canonical enums in Database Blueprint and Sync Matrix |
| Missing legal-rule governance | Rules & Workflow Engine specification |
| Prototype treated as possible implementation | explicitly classified as visual reference only |
| No Milestone 0 sequence | Repository Bootstrap Plan |
| No AI review evidence standard | AI Review Constitution |

## ADR status

- **ADR-001 (Supabase Authentication) — Proposed.** No real authentication is
  wired. The API uses a mock session over a synthetic dev identity, seeded only
  when `NODE_ENV !== 'production'`.
- **ADR-002 (Shared-schema multi-tenancy with `tenant_id` and RLS) —
  Accepted, development scope.** Implemented and verified against a live
  Postgres. Production infrastructure remains gated on the privacy and
  supplier review in its acceptance evidence.
- **ADR-003 (Mock-first AI provider) — Proposed.** `MockAIProvider` is the
  only enabled adapter; no external AI call exists.

The Repository Bootstrap Plan may create interfaces and local mocks compatible
with these ADRs. It must not treat a Proposed ADR as approval to process real
personal data.

## What has actually been built

Recorded because the earlier sections of this document describe a repository
that had no code in it, and that is no longer true.

**Milestone 0 (Foundation) — complete.** pnpm monorepo; Vite/React web shell
(Hebrew RTL, i18n-only strings); Fastify API shell (correlation ids, §14 error
envelope, log redaction, deny-by-default guard); layered packages
(domain/application/infrastructure) with a mock adapter behind every external
port; design tokens with a drift test; CI with format/lint/typecheck/test/build
plus secret scanning.

**Milestone 1 (Employment Case Foundation) — partially complete.**

| Capability | State |
|---|---|
| Open and view an employment case | Done, persisted, verified in browser |
| Contacts and organizations on a case | Done, persisted |
| Tasks (create, complete) | Done, persisted, completion idempotent |
| Case timeline | Done, persisted, translation-key based |
| Documents | In progress |
| Family-member invitations | Not started |
| Contact channels (editable in UI) | Modelled in schema only |

**Database.** Migrations 0001–0007 applied to the development Supabase
project. Tenant isolation is enforced by RLS and verified by a live
two-tenant isolation check (`pnpm db:rls-test`), which also asserts that RLS
is *forced* on every tenant-owned table and that the application role cannot
create tables.

### Defects found by verification, not by review

Worth recording because each was invisible to inspection and only surfaced
when the code was run against a real database or a real browser:

1. **RLS was not enforced at all.** `ENABLE ROW LEVEL SECURITY` does not apply
   to a table's owner, and even `FORCE` is bypassed by a role holding
   `BYPASSRLS` — which Supabase's `postgres` role has. Policies that read
   correctly protected nothing. Fixed in migrations 0004/0005.
2. **Policies had no `WITH CHECK`**, so a write could be labelled with another
   tenant's id even though reads were correctly scoped.
3. **Date columns drifted a day.** node-postgres parsed `date` into a local
   midnight `Date`, turning 2026-09-01 into 2026-08-31T21:00Z. On visa expiry
   and employment start dates that is a compliance defect.
4. **A form silently refused to submit.** An untouched `<input type="date">`
   posts `""`, failing an optional field's regex, and the error was never
   rendered — leaving the user with no feedback at all.

The lesson recorded for later milestones: schema and validation that read
correctly prove nothing until exercised against the real database and the real
UI.

## Remaining open decisions

1. Name the legal/employment reviewer and payroll reviewer before any rule can
   move to `approved` or `active`.
2. Complete a privacy and supplier assessment before using real user data,
   external AI, production object storage, or cross-border processing.
3. Accept or replace ADR-001 through ADR-003 before production infrastructure.
4. Confirm retention periods by data class.
5. Decide whether the authoritative Product Specification will receive a
   maintained Markdown edition; until then the DOCX remains authoritative.
6. Define production hosting region and incident-response ownership.

## Blocking gates before any real personal data

These are not "nice to have before launch" — each one blocks the moment a real
family's data enters the system, which has not happened yet (everything to date
is synthetic).

| Gate | Why it blocks | State |
|---|---|---|
| Named payroll reviewer (CPA) and legal/employment reviewer | No rule may reach `approved`/`active` without them, so no payroll figure can be presented as anything but an estimate | Not appointed |
| Privacy and supplier assessment | Required before real data, external AI, production object storage, or cross-border processing | Not started |
| Hosting region decision | The development project currently sits in `ap-south-1`, which was not a deliberate choice and conflicts with the EU/Israel preference recorded in ADR-002 | **Open — needs a decision** |
| Application connects as a non-administrative database role | Until then a missed `withTenant()` silently escapes RLS | In progress |
| Persisted audit trail | Audit is mandatory (Constitution §19) but is currently in-memory and lost on restart | In progress |
| Retention periods by data class | The model supports retention; the periods themselves are a legal decision no developer may invent | Not decided |
| DPO appointment and database registration | Named in the Legal Validation P0 checklist with no owner or date | Not assigned |

## Development readiness

Feature development may continue on synthetic data. Each new slice must:

- use the canonical data model without local aliases;
- carry `tenant_id`, enable **and force** RLS, and add a case to
  `pnpm db:rls-test` for every new tenant-owned table;
- audit what Constitution §19 requires;
- keep all user-facing strings in the i18n resources;
- introduce no real personal data anywhere, including fixtures and commit
  messages.
