# CareDesk Source of Truth

Status: **Active**
Owner: Product Owner
Last reconciled: 2026-07-23

## Purpose

This index defines which document wins when two sources disagree. It also
separates binding product intent from technical interpretation and historical
reference material.

## Authority order

1. **CareDesk Product Specification v1.0**
   File: `/CareDesk_Product_Specification_v1.0.docx`
   Governs product scope, personas, modules, journeys, permissions, and general
   acceptance criteria.
2. **AI Coding Constitution v1.0**
   Files: `/CareDesk_AI_Coding_Constitution_v1.0.docx` and the equivalent
   `/CareDesk_AI_Coding_Constitution_v1.0 (1).md`
   Governs engineering constraints, security, testing, and AI-agent behavior.
   If the two formats differ, the DOCX is authoritative until a controlled
   parity check is completed.
3. **Accepted Architecture Decision Records**
   Govern the specific decision named by each ADR. Proposed ADRs guide planning
   but do not override an accepted higher-authority document.
4. **Database Blueprint**
   Governs canonical entity names, relationships, status enums, tenancy
   boundaries, data ownership, and migration mapping.
5. **Rules & Workflow Engine Specification**
   Governs rule lifecycle, legal-source metadata, workflow state, and the
   boundary between deterministic rules, orchestration, and AI.
6. **Design System & Component Catalog**
   Governs design tokens, interaction states, RTL, accessibility, and reusable
   UI components.
7. **User Stories & Acceptance Criteria**
   Governs deliverable behavior for the covered slice. It may clarify but not
   expand MVP scope.
8. **AI Review Constitution**
   Governs review evidence and completion gates for AI-generated changes.
9. **Repository Bootstrap Plan**
   Governs Milestone 0 sequencing and foundation deliverables.
10. **Master prompts and prototype references**
    Implementation aids only. They never override the documents above.

## Historical references

The following files retain useful discovery work but are not independently
binding:

- `CareDesk_Israel_אפיון_מוצר_שלב_1_מודל_נתונים.docx`
- `CareDesk_Israel_Product_Bible_UX_שלב_2.docx`
- `CareDesk_Israel_שלב_3_ארכיטקטורה_עסקי_אב_טיפוס_AI.docx`
- `CareDesk_Israel_Strategic_Review.docx`
- `CareDesk_Master_Prompt.*`
- `CareDesk_Israel_Master_Prompt_Claude_Prototype.*`
- `caredesk_prototype.html`

Conflicts found in historical material are resolved in the Database Blueprint
and recorded in the Gap Analysis.

## Change-control rule

A shared term or enum change is incomplete until the owner updates every
affected artifact identified by `SYNC_MATRIX.md`, adds a migration note when
applicable, updates tests and examples, and records the change in the pull
request. Silent divergence is prohibited.

## Unverified regulatory content

No amount, rate, deadline, legal duty, or payroll formula becomes a verified
system rule merely because it appears in a prompt, prototype, secondary guide,
or historical specification. Verification requires source metadata, effective
dates, review status, and the approvals defined in the Rules & Workflow Engine
Specification.
