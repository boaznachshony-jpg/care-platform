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

The following ADRs are created as **Proposed**, because their technical
direction is approved for planning but production acceptance still requires
the stated evidence:

- ADR-001: Supabase Authentication Strategy
- ADR-002: Shared-schema Multi-tenancy with `tenant_id` and RLS
- ADR-003: Mock-first AI Provider and Data Minimization

The Repository Bootstrap Plan may create interfaces and local mocks compatible
with these ADRs. It must not treat a Proposed ADR as approval to process real
personal data.

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

## Development readiness

Milestone 0 documentation is now ready for review. Feature development remains
blocked until:

- the authority documents are approved;
- ADR dependencies for the planned slice are accepted or explicitly mocked;
- repository foundation checks pass;
- the canonical data model is used without local aliases;
- no real personal data is introduced.
