# CareDesk AI Review Constitution

Status: **Draft v1.0 — pending Product Owner approval**
Approved by: _(unassigned)_
Approved at: _(pending)_
Last updated: 2026-07-23

## 1. Purpose

This policy defines the evidence an AI coding agent must produce before a
change is considered reviewable. It supplements, and never weakens, the AI
Coding Constitution.

An AI agent may implement and self-review. It may not act as the final human
approver for material product, legal, payroll, privacy, security, or
architecture decisions.

## 2. Required pre-change review

Before modifying files, the agent must:

1. identify applicable authority documents in `docs/SOURCE_OF_TRUTH.md`;
2. inspect existing code, tests, components, schemas, and ADRs;
3. state the requested scope and excluded work;
4. map the change to `SYNC_MATRIX.md`;
5. identify data classes, permissions, rule/workflow impacts, and edge cases;
6. stop for a decision if a higher-authority conflict cannot be resolved.

The agent must not infer authority from a prompt or prototype.

## 3. Change plan

For non-trivial work, the plan records:

- user outcome;
- files/modules expected to change;
- existing components or services to reuse;
- migration and compatibility impact;
- tests and review evidence;
- documentation updates;
- rollout or rollback needs.

Unrelated refactoring is excluded unless explicitly approved.

## 4. Review dimensions

### Product and scope

- behavior matches a story and acceptance criteria;
- MVP boundaries are preserved;
- failure and empty states are included;
- no hidden scope or speculative feature is introduced.

### Architecture

- domain, application, UI, and infrastructure boundaries hold;
- dependency direction follows the Coding Constitution;
- no direct API/database/provider calls from UI;
- canonical names from the Database Blueprint are used;
- an ADR exists for a durable new architecture decision.

### Data

- tenant ownership and cross-tenant references are safe;
- sensitivity, purpose, retention status, and audit needs are identified;
- immutable/versioned records are not overwritten;
- migrations are forward-safe and reversible where practical;
- synthetic fixtures contain no real personal information.

### Authorization and privacy

- deny-by-default server-side checks exist;
- RLS impact is tested when applicable;
- Contacts are not treated as Users;
- sensitive values are masked and absent from logs, analytics, URLs, errors,
  telemetry, and AI payloads;
- reveal/export/share actions are authorized and audited.

### Rules and workflows

- no legal, payroll, or deadline constants are invented;
- rule version, sources, effective dates, confidence, and approvals are
  preserved;
- workflow transitions are authorized and deterministic;
- RACI and notification requirement semantics remain distinct from access and
  actual delivery;
- Timeline and Audit side effects use central services.

### AI

- provider abstraction is respected;
- MockAIProvider is used until ADR-003 gates are met;
- field allow-list and minimization are explicit;
- output is structured and validated;
- source/confidence/disclaimer/escalation are present;
- AI does not perform arithmetic or material approvals.

### UX, RTL, and accessibility

- Hebrew content comes from translations;
- CSS logical properties and RTL order are correct;
- keyboard, focus, semantics, errors, contrast, zoom, and target sizes pass;
- status is not conveyed by color alone;
- all required states from the Design System exist.

### Reliability and security

- errors are typed and safe;
- retryable writes are idempotent;
- user input survives recoverable failure;
- secrets are not committed;
- dependencies and generated files are intentional;
- audit logs exclude sensitive content while retaining useful evidence.

## 5. Test evidence

At minimum, the agent reports:

```text
format:
lint:
typecheck:
unit:
component:
integration:
e2e:
accessibility:
build:
security/privacy checks:
```

Use `not applicable` only with a reason. “Not run” is not a passing result.

Risk-specific requirements:

- canonical data change: migration, relationship, and cross-tenant tests;
- permission change: allowed and denied tests;
- rule change: boundaries, effective dates, determinism, source/approval tests;
- workflow change: transition, blocker, retry, RACI, Timeline/Audit tests;
- sensitive UI: masking, reveal authorization, and no-leak tests;
- AI change: minimization, injection, structured-output, and safe fallback;
- visual component: interaction, RTL, accessibility, and responsive evidence.

## 6. Documentation synchronization

The agent must name the relevant `SYNC_MATRIX.md` row and update all required
artifacts or explain why an artifact is unaffected.

A code-only change is rejected if it changes:

- entity or enum vocabulary;
- permission behavior;
- rule or workflow semantics;
- shared component contract;
- public API;
- operational setup;
- user-visible behavior not covered by existing acceptance criteria.

## 7. Pull-request evidence

The PR description must include:

- outcome and reason;
- scope and explicit non-goals;
- authority documents read;
- important decisions;
- screenshots or interaction evidence for UI changes;
- data/privacy/security impact;
- migration/rollback impact;
- exact checks run and results;
- remaining risks or required human review.

The diff must not contain unrelated generated artifacts, extracted review text,
local environments, secrets, or real user data.

## 8. Severity and reviewer routing

| Change | Required human review |
|---|---|
| Documentation clarification | Product/document owner |
| Shared component | Design system + accessibility |
| Authentication/authorization/RLS | Security + engineering |
| Personal/sensitive data or retention | Privacy/security |
| Rule or legal wording | qualified legal/domain reviewer |
| Payroll formula or entitlement | payroll + legal reviewer |
| Workflow closure duties | legal/payroll/compliance as applicable |
| External AI/provider/data transfer | privacy + security + product |
| Architecture/tenancy | architecture + security |

## 9. Stop conditions

The AI agent must stop and request a decision when:

- authority documents conflict and no accepted ADR resolves them;
- a real legal/payroll value lacks verified sources or reviewers;
- requested access exceeds documented permissions;
- real personal data would enter prototype/test/AI tooling;
- a destructive migration or deletion lacks recovery and approval;
- passing a check would require weakening a gate;
- unrelated user changes overlap the intended files.

## 10. Definition of review-ready

A change is review-ready only when:

- requested behavior is implemented within scope;
- required checks pass;
- documentation is synchronized;
- no sensitive data or secrets are present;
- known limitations are stated;
- the working diff is intentional;
- the agent has not merged or self-approved material decisions.

## 11. Final agent declaration

Every completed AI change ends with a concise declaration:

```text
Authority documents read:
Scope delivered:
Sync-matrix rows applied:
Checks passed:
Checks not run and why:
Privacy/security impact:
Human reviewers required:
Branch/commit/PR:
Not merged:
```
