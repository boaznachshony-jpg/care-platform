# ADR-003: AI Provider and Data Minimization

- Status: **Proposed**
- Date: 2026-07-23
- Owners: Product, Privacy, Security, Engineering
- Approved by: _(unassigned)_
- Approved at: _(pending)_

## Context

CareDesk handles identity, financial, employment, and care-sensitive data. The
AI assistant must not become a source of legal truth or an uncontrolled path
for exporting case data.

## Decision

Milestone 0 and the prototype use `MockAIProvider` only. Product code depends
on an `AIProvider` port with structured requests and responses. No external
provider may receive user data until an AI privacy impact assessment, supplier
review, DPA, retention review, and production approval are complete.

Every future request passes through:

1. authorization and purpose check;
2. data-classification check;
3. field allow-list;
4. identifier removal or tokenization;
5. retrieval from approved sources only;
6. provider call with bounded context;
7. structured-output validation;
8. response safety and citation validation;
9. human confirmation before any material action;
10. metadata-only audit that does not duplicate sensitive prompt content.

Passport images, full identity numbers, bank details, medical documents, and
raw case exports are prohibited from external prompts.

## Alternatives considered

- **Direct integration with a single provider from day one**: rejected —
  skips the abstraction this decision exists to provide, and forecloses
  using `MockAIProvider` safely during early development with synthetic or
  no data.
- **Delaying all AI-feature work until a provider is chosen and the privacy
  assessment is complete**: rejected — blocks UI/UX and escalation-flow
  development unnecessarily; `MockAIProvider` lets those be built and tested
  now, behind the same port a real provider will later implement.

## Consequences

- The provider can be changed without rewriting product modules.
- AI features degrade safely to deterministic guidance and source links.
- AI never activates rules, approves payroll, decides termination, or changes
  permissions.
- Provider logs and observability must avoid sensitive prompt contents.

## Acceptance evidence

- Approved AI privacy impact assessment.
- Redaction and field allow-list tests.
- Prompt-injection and data-exfiltration tests.
- Hebrew quality and structured-output evaluation.
- Verified provider retention and training terms.
- Kill switch and safe fallback demonstrated.

## Migration impact

None yet — no existing AI integration; all prior repository branches were
confirmed empty during the branch audit. Enabling a real provider requires,
in order: (1) a completed and approved AI Privacy Impact Assessment, (2) a
signed DPA with the chosen vendor, (3) the minimization pipeline implemented
and tested against `MockAIProvider` parity, (4) an explicit environment-level
flag so pilot/production and any lower environment holding synthetic-only
data can be independently toggled.

## References

- Product Specification section 13.
- AI Coding Constitution sections 16, 22, and 25.
- Rules & Workflow Engine specification.
