# Repository and Specification Gap Analysis

## Wave 3 status (2026-08-15)

The exact Product Intelligence gaps and reuse decisions are recorded in `docs/architecture/product-intelligence.md`. All six requested surfaces have an implementation; hosted CI evidence remains the closeout gap. No Wave 4 worker-portal acknowledgement was implemented.

Status: **Reconciled with the deployed pilot baseline**
Audit date: 2026-08-10

> Historical findings below are retained for auditability. For current delivery
> status, read this document together with the root `BUILD_STATUS.md`.

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

**Milestone 1 (Employment Case Foundation) — complete for the synthetic-data
pilot baseline.**

| Capability | State |
|---|---|
| Open and view an employment case | Done, persisted, verified in browser |
| Contacts and organizations on a case | Done, persisted |
| Tasks (create, complete) | Done, persisted, completion idempotent |
| Case timeline | Done, persisted, translation-key based |
| Documents | Done, persisted, with protected storage adapter and UI |
| Family-member invitations | Done, persisted, with invitation and access UI |
| Contact channels | Done in case and public/private support experiences |
| Authentication and workspace recovery | Done |
| Employer onboarding and workspace switching | Done |
| Product billing | Done for the configured pilot gateway |
| Payroll records and printable report | Done; calculations remain non-authoritative pending professional validation |
| Quarterly national-insurance tracking | Done |
| Renewal-date follow-up tasks | Done |

### Current implementation baseline

The current `main` branch includes migrations `0001` through `0019`, web and API
applications, domain/application/infrastructure packages, Supabase-backed
authentication and persistence, billing, family access, documents, support,
and broad unit/integration/Playwright coverage. Older statements that the
repository contains only documentation or Milestone 0 shells are historical
and must not be used to plan new work.

### Highest-priority product gap

The next bounded product gap is the **full Visa Renewal Workflow**. The product
already captures a renewal date and generates follow-up tasks, but it does not
yet provide the complete persisted workflow described by the authority pack:
template/version provenance, step dependencies, RACI/contact assignments,
evidence capture, completion policy, and synchronized audit/timeline events.

**Database.** The repository now contains migrations `0001` through `0019`.
The original live two-tenant isolation evidence covered the employment-case
foundation through migration `0007`; subsequent release work added documents,
audit, workspace persistence, family access, billing, schema lockdown, and
self-service account bootstrap. The RLS harness continues to assert that RLS
is *forced* on tenant-owned tables and that the application role cannot create
tables.

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
| Hosting region decision | See below | **Deferred by the Product Owner, with a review trigger** |
| Application connects as a non-administrative database role | Until then a missed `withTenant()` silently escapes RLS | In progress |
| Persisted audit trail | Audit is mandatory (Constitution §19) but is currently in-memory and lost on restart | In progress |
| Retention periods by data class | The model supports retention; the periods themselves are a legal decision no developer may invent | Not decided |
| DPO appointment and database registration | Named in the Legal Validation P0 checklist with no owner or date | Not assigned |

### Hosting region — deferred, 2026-07-25

**Decision:** stay on the current Supabase project in `ap-south-1` (Mumbai)
for now. **Review before any public launch or any real personal data.**
Product Owner decision.

Context for whoever picks this up:

- Supabase does **not** offer an Israel region. AWS runs `il-central-1` in Tel
  Aviv, but Supabase is not deployed there, so data residency in Israel means
  moving the database off Supabase — which also reopens ADR-001, since
  Supabase Auth is the chosen identity provider.
- Among Supabase regions, `eu-central-1` (Frankfurt) is both the lowest-latency
  option for Israeli users and the strongest position under the Israeli
  Privacy Protection Regulations on transferring data abroad, whose permitted
  bases include countries receiving data from EU member states. Germany
  qualifies on that basis; India does not obviously qualify on any of them.
- Amendment 13 to the Privacy Protection Law (in force August 2025) materially
  raised the penalties for mishandling sensitive data — which is precisely
  what this product holds (passport, bank, care information).

**Why deferring is defensible right now:** the database contains only
synthetic data, so no personal data is being transferred anywhere. The
exposure is zero today.

**Why the review trigger is not optional:** the migration is roughly half an
hour while the data is synthetic (create project, run migrations, repoint
`.env.local`). Once real families are onboarded it becomes a cross-border
transfer of personal data with notification duties and a downtime window. The
cost of this decision rises with every real record, and with nothing else on
the blocking list.

Whether EU hosting suffices or Israeli residency is required is a legal
question, not an engineering one. It belongs to the privacy counsel whose
sign-off `CareDesk_Legal_Validation_P0.docx` already requires before launch.

## Development readiness

Feature development may continue on synthetic data. Each new slice must:

- use the canonical data model without local aliases;
- carry `tenant_id`, enable **and force** RLS, and add a case to
  `pnpm db:rls-test` for every new tenant-owned table;
- audit what Constitution §19 requires;
- keep all user-facing strings in the i18n resources;
- introduce no real personal data anywhere, including fixtures and commit
  messages.
