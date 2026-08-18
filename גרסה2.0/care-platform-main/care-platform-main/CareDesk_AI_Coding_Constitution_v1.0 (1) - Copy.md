# CareDesk AI Coding Constitution v1.0

**Status:** Mandatory  
**Applies to:** Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot and any other AI coding agent  
**Product:** CareDesk Israel  
**Purpose:** Define the non-negotiable engineering rules for all code created or modified in the CareDesk repository.

---

## 1. Constitutional Principle

CareDesk is a compliance, employment and case-management platform for families directly employing foreign caregivers in Israel.

Every implementation decision must optimize for:

1. Correctness.
2. User trust.
3. Privacy.
4. Explainability.
5. Accessibility.
6. Maintainability.
7. RTL-first experience.
8. Safe handling of uncertainty.
9. Clear separation between verified rules, user-entered data and AI-generated guidance.
10. Small, reviewable and reversible changes.

When speed conflicts with these principles, these principles win.

---

## 2. Authority and Source Hierarchy

When instructions conflict, use this order:

1. Approved Product Specification.
2. This AI Coding Constitution.
3. Approved module specification.
4. Approved rules-engine specification.
5. Approved design system and component catalog.
6. Current task prompt.
7. Existing code conventions.
8. AI assumptions.

An AI agent must not silently resolve a material conflict. It must identify the conflict and choose the higher-authority source.

---

## 3. Required Technology Baseline

Unless an Architecture Decision Record explicitly changes the stack:

### Frontend
- React.
- TypeScript with `strict: true`.
- Vite.
- React Router.
- React Hook Form.
- Zod.
- TanStack Query for server state.
- Zustand only for justified shared client state.
- CSS variables and design tokens.
- A reusable accessible component layer.
- Lucide or another approved icon library.

### Backend
- TypeScript runtime.
- Modular service architecture.
- REST API for the first production release unless an ADR approves otherwise.
- Schema validation at all system boundaries.
- PostgreSQL as the primary relational database.
- Migration-based schema management.
- Object storage for documents.
- Background jobs for reminders, notifications and long-running workflows.

### Testing
- Unit tests.
- Component tests.
- API integration tests.
- End-to-end tests for critical journeys.
- Accessibility checks.
- Static type checking.
- Linting and formatting in CI.

Technology versions must be pinned and updated deliberately. Do not introduce a new framework or library without documenting why the existing stack cannot satisfy the requirement.

---

## 4. Repository Structure

Recommended top-level structure:

```text
CareDesk/
├── apps/
│   ├── web/
│   └── api/
├── packages/
│   ├── ui/
│   ├── design-tokens/
│   ├── domain/
│   ├── rules/
│   ├── schemas/
│   ├── i18n/
│   ├── testing/
│   └── config/
├── docs/
│   ├── product/
│   ├── architecture/
│   ├── modules/
│   ├── adr/
│   ├── rules/
│   └── qa/
├── scripts/
└── .github/
```

Within a feature:

```text
features/contacts/
├── api/
├── components/
├── hooks/
├── model/
├── pages/
├── schemas/
├── services/
├── tests/
├── types/
└── index.ts
```

Rules:
- Organize business code by feature or bounded context.
- Do not create generic dumping folders.
- Shared code must be genuinely shared by at least two consumers.
- Avoid circular dependencies.
- Domain packages must not depend on UI packages.
- UI components must not own legal or payroll rules.

---

## 5. Architectural Boundaries

Use these layers:

1. Presentation.
2. Application.
3. Domain.
4. Infrastructure.

### Presentation
Responsible for:
- Rendering.
- User interaction.
- Accessibility.
- Form feedback.
- View-state composition.

Must not:
- Calculate payroll entitlements.
- Decide legal obligations.
- Directly access the database.
- Contain workflow policy.

### Application
Responsible for:
- Use cases.
- Commands and queries.
- Orchestration.
- Permission checks.
- Audit requests.
- Transaction boundaries.

### Domain
Responsible for:
- Entities.
- Value objects.
- Business invariants.
- Rules.
- Workflow transitions.
- Domain events.

### Infrastructure
Responsible for:
- Database access.
- External services.
- File storage.
- Email/SMS/WhatsApp adapters.
- Logging.
- Queueing.
- AI provider integration.

Dependencies point inward. Infrastructure implements interfaces owned by the application or domain layer.

---

## 6. TypeScript Rules

Mandatory:
- `strict: true`.
- No implicit `any`.
- No untyped API payloads.
- No unsafe type assertions unless documented.
- Prefer discriminated unions for state and workflow statuses.
- Prefer `unknown` over `any`.
- Parse external data with Zod or the approved schema library.
- Model IDs as branded types where practical.
- Use exhaustive checks for finite state transitions.

Avoid:
- Large interfaces with unrelated fields.
- Boolean flag explosions.
- Enums when literal unions provide better type safety.
- Optional fields that conceal multiple states.

Example:

```ts
type TaskState =
  | { status: "open"; dueAt: string }
  | { status: "completed"; completedAt: string; completedBy: UserId }
  | { status: "cancelled"; reason: string };
```

---

## 7. Naming Conventions

- React components: `PascalCase`.
- Hooks: `useSomething`.
- Variables and functions: `camelCase`.
- Constants: `UPPER_SNAKE_CASE` only for true constants.
- Files: `kebab-case` or one approved consistent convention.
- Tests: `*.test.ts`, `*.test.tsx`, `*.spec.ts`.
- Database tables and columns: one consistent documented convention.
- Boolean names begin with `is`, `has`, `can`, `should` or `was`.
- Event names use completed past tense, for example `VisaRenewalCompleted`.
- Commands use imperative names, for example `CompleteVisaRenewal`.
- Queries describe requested data, for example `GetOpenTasksForCase`.

Hebrew must not appear in identifiers.

---

## 8. Internationalization and RTL

Hebrew and RTL are first-class requirements, not post-processing.

Mandatory:
- All user-facing strings come from translation resources.
- No hardcoded Hebrew or English strings inside components.
- Use logical CSS properties: `margin-inline-start`, not `margin-left`.
- Direction must be set at the document and component level where needed.
- Icons with directional meaning must mirror in RTL.
- Progress bars, steppers, timelines, tables and carousels must behave correctly in RTL.
- Mixed Hebrew, English, numbers, dates and currency must be tested.
- Inputs such as passport numbers, email and bank details may use LTR internally while labels and layout remain RTL.
- Dates, currency and pluralization use locale-aware formatting.
- Screens must be tested at narrow mobile widths and desktop widths.

A feature is not complete until its RTL behavior has been visually reviewed.

---

## 9. Accessibility

Target: WCAG 2.1 AA or higher.

Mandatory:
- Semantic HTML.
- Keyboard operability.
- Visible focus.
- Correct heading hierarchy.
- Labels linked to form controls.
- Error messages linked to relevant fields.
- Accessible names for icon buttons.
- Color is never the only status indicator.
- Minimum touch target of 44 x 44 px.
- Sufficient color contrast.
- Dialog focus trapping and focus restoration.
- Screen-reader announcements for important async status changes.
- Reduced-motion support.
- Tables use real headers and accessible captions when relevant.

Automated checks are necessary but not sufficient. Critical journeys require manual keyboard review.

---

## 10. Design System Rules

All visual implementation must use approved tokens.

Tokens include:
- Color.
- Typography.
- Spacing.
- Radius.
- Border.
- Shadow.
- Z-index.
- Motion.
- Breakpoints.

Forbidden:
- Arbitrary one-off colors.
- Unapproved spacing values.
- Inline styles except for documented dynamic values.
- Duplicating an existing component.
- New visual patterns without design-system review.

Every reusable component must define:
- Purpose.
- Props.
- Variants.
- States.
- Accessibility behavior.
- RTL behavior.
- Empty, loading, error and disabled behavior where applicable.
- Usage examples.
- Anti-patterns.

---

## 11. Component Construction

A component should be:
- Focused.
- Composable.
- Accessible.
- Typed.
- Testable.
- Free of hidden business rules.

Use container/presentational separation when complexity warrants it.

Do not:
- Put API calls directly in presentational components.
- Put payroll formulas in JSX.
- Store derived state unnecessarily.
- Build a “universal” component with dozens of unrelated props.
- Duplicate form validation in multiple screens.
- Use index values as list keys when stable IDs exist.

Each feature screen must support:
- Loading.
- Empty.
- Error.
- Success.
- Permission denied.
- Offline or retry state where relevant.

---

## 12. State Management

Use the smallest correct state scope.

### Local state
Use for:
- Open/closed UI state.
- Temporary interaction state.
- Local selection.

### Form state
Use the approved form library.

### Server state
Use TanStack Query or the approved equivalent.

### Global client state
Use only for:
- Authenticated user/session.
- Locale.
- Cross-route UI state.
- Carefully justified draft workflow state.

Rules:
- Do not mirror server state in Zustand.
- Do not keep two sources of truth.
- Derived values should be computed, not stored.
- Cache invalidation must be explicit.
- Optimistic updates require rollback behavior.

---

## 13. Forms and Validation

Validation occurs:
1. On the client for usability.
2. At the API boundary for trust.
3. In the domain for invariants.
4. In the database for critical integrity constraints.

Mandatory:
- Shared schemas where practical.
- Clear field-level errors.
- Preserve entered data after recoverable failures.
- Do not erase a form because of a network error.
- Require explicit confirmation for sensitive actions.
- Show why sensitive data is needed.
- Mask sensitive values by default.
- Record the source of imported or manually entered data.

Manual payroll overrides require:
- Reason.
- Actor.
- Timestamp.
- Previous value.
- New value.
- Audit event.

---

## 14. API Rules

Every endpoint must have:
- Defined request schema.
- Defined response schema.
- Authentication requirement.
- Authorization rule.
- Error model.
- Idempotency behavior where relevant.
- Audit behavior.
- Rate-limit considerations.
- Test coverage.

Use consistent error responses:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Unable to complete the request",
  "fieldErrors": {},
  "correlationId": "..."
}
```

Rules:
- Never expose stack traces to clients.
- Never trust client-calculated payroll totals.
- Do not use generic `200 OK` for every outcome.
- Use idempotency keys for payment-like or notification actions.
- Version breaking API changes.
- Generate or validate API contracts in CI.

---

## 15. Data Model and Database

Mandatory:
- Every business record has stable identifiers.
- Use created/updated timestamps.
- Sensitive records record actor and source.
- Use soft deletion only where legally and operationally justified.
- Preserve history for compliance-relevant entities.
- Use validity periods for rules, contacts, roles and assignments.
- Enforce referential integrity.
- Use transactions for multi-entity business operations.
- Index based on actual query patterns.
- Avoid storing derived totals when they can safely be recalculated; if stored for historical reproducibility, store rule version and input snapshot.

Critical historical records must preserve:
- Data used.
- Rule version.
- Calculation result.
- Overrides.
- Actor.
- Timestamp.
- Explanation.

---

## 16. Privacy and Data Minimization

CareDesk handles identity, employment, financial and care-related information.

Mandatory:
- Collect only necessary data.
- Explain why sensitive data is needed.
- Mask sensitive values by default.
- Apply least-privilege access.
- Separate contact data from user-access permissions.
- External contacts receive no system access unless explicitly invited.
- Do not include production personal data in prompts, logs, screenshots, fixtures or test data.
- Use synthetic data in development and demonstrations.
- Redact sensitive fields from application logs.
- Define retention and deletion rules by data class.
- Record access to highly sensitive documents.
- Support revocation of access.
- Minimize data sent to AI providers.

Never send full passport, bank-account or medical content to an AI service unless an approved architecture and privacy assessment explicitly permits it.

---

## 17. Security

Mandatory:
- Secure authentication.
- Multi-factor authentication for sensitive roles.
- Server-side authorization on every protected operation.
- Encryption in transit.
- Encryption at rest for production data.
- Secrets stored only in secret management.
- No secrets in repository, prompts or client bundles.
- Dependency scanning.
- Static analysis.
- Secure headers.
- CSRF protection where relevant.
- XSS protection through safe rendering.
- File-type and malware validation for uploads.
- Rate limiting and abuse protection.
- Session expiration and revocation.
- Correlation IDs for incident investigation.

Security-sensitive code requires explicit review.

---

## 18. Authorization and Permissions

Authorization is deny-by-default.

Model:
- User.
- Case membership.
- Role.
- Permission.
- Resource scope.
- Data sensitivity.
- Time validity.

The UI may hide unavailable actions, but the server must enforce authorization independently.

Examples:
- A family member may view tasks but not bank details.
- A payroll accountant may access payroll only for explicitly assigned cases.
- A social worker contact does not receive access merely because they are listed as a contact.
- Access to passport, bank and care information is separately controlled.

Permission changes must create audit events.

---

## 19. Audit Logging

Audit is mandatory for:
- Login/security events.
- Sensitive record access.
- Data creation, modification and deletion.
- Permission changes.
- Document upload/download.
- Payroll calculation and override.
- Workflow transitions.
- Notifications.
- Employment closure.
- Rule-version changes.
- AI-assisted recommendations used in a decision.

Audit entries must include:
- Event type.
- Actor.
- Case or resource.
- Timestamp.
- Before/after or change summary.
- Source channel.
- Correlation ID.
- Rule version where relevant.
- AI involvement where relevant.

Audit logs must not contain secrets or unnecessary sensitive content.

---

## 20. Rules Engine

Legal, payroll and compliance logic must not be embedded in UI components.

Every rule must have:
- Rule ID.
- Name.
- Description.
- Jurisdiction.
- Effective from/to.
- Version.
- Source reference.
- Input schema.
- Output schema.
- Explanation template.
- Confidence or verification status.
- Test cases.
- Owner.
- Approval status.

Rules must be deterministic when possible.

The system must distinguish:
- Verified rule.
- Operational recommendation.
- User-entered assumption.
- Professional override.
- AI suggestion.

A rule change must not silently alter historical calculations. Historical records retain the rule version used at the time.

---

## 21. Workflow Engine

Workflow states and transitions must be explicit.

Each workflow defines:
- Trigger.
- Preconditions.
- Steps.
- Required documents.
- Responsible role.
- Consulted parties.
- Informed parties.
- Deadlines.
- Escalation.
- Completion criteria.
- Cancellation criteria.
- Audit events.
- Timeline events.

Transitions are validated server-side.

Employment closure, visa renewal and medical insurance renewal are critical workflows and require end-to-end tests.

---

## 22. AI Assistant Rules

AI assists; it does not determine legal, accounting or medical outcomes.

Mandatory:
- Use retrieval from approved sources.
- Include source labels.
- Include confidence.
- Include a disclaimer.
- Provide a next action.
- Clearly distinguish facts from recommendations.
- Escalate when data is missing or conflicting.
- Refuse definitive legal, medical or final-payroll decisions when unsupported.
- Log material AI recommendations.
- Do not train on customer data by default.
- Do not expose hidden prompts or secrets.
- Protect against prompt injection in uploaded documents.

AI output must never directly trigger an irreversible action without user confirmation and applicable rule validation.

---

## 23. Error Handling and Resilience

Every operation must define:
- Expected errors.
- User-facing message.
- Retry behavior.
- Rollback behavior.
- Audit/logging behavior.
- Escalation behavior.

Rules:
- Preserve user input on recoverable failures.
- Use stable error codes.
- Show plain-language Hebrew messages.
- Do not expose internal implementation details.
- Design for duplicate submissions.
- Use idempotency for external notifications and payment-like records.
- Background jobs must be retryable and observable.
- Dead-letter failed jobs after defined attempts.

---

## 24. Observability

Production services must provide:
- Structured logs.
- Metrics.
- Distributed tracing or correlation IDs.
- Health checks.
- Error monitoring.
- Audit monitoring.
- Job monitoring.
- Alert thresholds.
- Privacy-safe diagnostics.

Track product-critical signals:
- Workflow failures.
- Missed reminders.
- Payroll calculation errors.
- Document processing failures.
- Permission denials.
- AI escalation rates.
- Notification failures.

---

## 25. Testing Constitution

Minimum test layers:

### Unit tests
For:
- Domain rules.
- Payroll calculations.
- Permission logic.
- Workflow transitions.
- Formatting utilities.

### Component tests
For:
- Forms.
- Error states.
- Permission states.
- RTL behavior.
- Accessibility.

### Integration tests
For:
- API and database.
- Document metadata.
- Audit creation.
- Rules-engine execution.

### End-to-end tests
Critical journeys:
1. Open employment case.
2. Upload and confirm a visa.
3. Complete visa-renewal workflow.
4. Calculate and approve payroll.
5. Log communication.
6. Start and complete employment closure.
7. Verify permissions for sensitive data.

Every bug fix should include a regression test when practical.

No test may use real personal data.

---

## 26. Code Quality Gates

A change cannot be merged unless:
- Type checking passes.
- Linting passes.
- Formatting passes.
- Tests pass.
- Critical accessibility checks pass.
- No secret is detected.
- No high-severity dependency issue is introduced without approval.
- Required documentation is updated.
- Database migrations are reviewed.
- Rules changes include source and tests.
- UI changes are checked in RTL.
- Audit effects are verified.

AI-generated code is never exempt from review gates.

---

## 27. Git and Change Management

Rules:
- Small, focused commits.
- One concern per pull request where practical.
- Descriptive commit messages.
- No generated noise unrelated to the task.
- Do not rewrite unrelated code.
- Do not delete existing behavior without explicit instruction.
- Include migration and rollback notes for data changes.
- Include screenshots or visual evidence for UI changes.
- Include test evidence.
- Update changelog for user-visible changes.

AI agents must inspect existing code before creating new structures.

---

## 28. Architecture Decision Records

Create an ADR for:
- New framework.
- New state-management library.
- New database technology.
- Major integration.
- Authentication strategy.
- Rules-engine architecture.
- AI provider architecture.
- Multi-tenancy model.
- Document-storage model.
- Breaking API change.

An ADR includes:
- Context.
- Decision.
- Alternatives.
- Consequences.
- Security/privacy impact.
- Migration impact.
- Status.

---

## 29. Prohibited Practices

Never:
- Hardcode legal or payroll rules in UI code.
- Use real personal data in development.
- Put secrets in code or prompts.
- Add dependencies without justification.
- Duplicate an existing component.
- Bypass authorization in the frontend.
- Log passport, bank or medical values.
- Treat an external contact as an authorized user automatically.
- Let AI perform irreversible actions without confirmation.
- Present AI output as verified law.
- Change database data manually without migration or auditable tooling.
- Suppress TypeScript errors to make a build pass.
- use `any` as a shortcut.
- disable tests because they fail.
- ship a screen without loading, empty and error consideration.
- assume LTR behavior.
- build only for desktop.
- silently change a rule used in historical calculations.
- merge large unrelated refactors with feature work.

---

## 30. Required AI Agent Workflow

Before coding:
1. Read the Product Specification.
2. Read this Constitution.
3. Read the relevant module specification.
4. Inspect existing code and reusable components.
5. Identify data, permission, audit and rule impacts.
6. Present a short implementation plan.
7. List assumptions and risks.

During coding:
1. Make the smallest coherent change.
2. Reuse existing components.
3. Keep domain logic outside UI.
4. Add validation.
5. Add tests.
6. Update documentation.
7. Preserve RTL and accessibility.
8. Avoid unrelated refactoring.

Before completion:
1. Run type checks.
2. Run lint.
3. Run relevant tests.
4. Review RTL.
5. Review accessibility.
6. Review privacy and permissions.
7. Verify audit behavior.
8. Summarize files changed.
9. State known limitations.
10. Propose the next safe step.

---

## 31. Definition of Done

A feature is done only when:

### Product
- Acceptance criteria are satisfied.
- Empty and error states are defined.
- Copy is approved or follows product style.

### Engineering
- Code is typed, modular and maintainable.
- Validation exists at boundaries.
- Tests cover critical behavior.
- No duplicate source of truth exists.

### UX
- Mobile and desktop are supported.
- RTL is correct.
- Accessibility is reviewed.
- Loading, success and failure states are present.

### Privacy and Security
- Data minimization is respected.
- Permission checks are server-side.
- Sensitive values are masked.
- Logging is privacy-safe.
- Audit events exist where required.

### Compliance and Explainability
- Rule source and version are recorded.
- Calculations are explainable.
- Overrides are documented.
- AI uncertainty is visible.

### Delivery
- Documentation is updated.
- CI passes.
- Change summary is provided.
- Known limitations are recorded.

---

## 32. Review Checklist for Every AI-Generated Change

- Did the agent read the relevant specifications?
- Does a reusable component already exist?
- Is the implementation RTL-safe?
- Is it keyboard accessible?
- Are strings externalized?
- Is validation implemented at all necessary boundaries?
- Are permissions enforced server-side?
- Is sensitive data minimized and masked?
- Is audit logging required?
- Is a business rule incorrectly placed in UI code?
- Are rule source and version preserved?
- Are loading, empty, error and success states covered?
- Are retries and duplicate submissions safe?
- Are tests included?
- Is the change small and reviewable?
- Are docs and changelog updated?
- Are assumptions explicit?
- Is any AI output presented too confidently?
- Is historical data reproducible?
- Could this change expose or alter unrelated cases?

---

## 33. Exception Process

An exception is permitted only when:
- The reason is documented.
- The impact is described.
- Security, privacy and compliance impacts are reviewed.
- A time limit or remediation plan is defined.
- The exception is approved by the product/technical owner.

AI agents cannot approve their own exceptions.

---

## 34. Versioning

This Constitution uses semantic versioning.

- Patch: clarification without changing obligations.
- Minor: new rule compatible with existing architecture.
- Major: material change to stack, architecture or mandatory engineering behavior.

Every repository task should reference the active Constitution version.

---

## 35. Final Instruction to AI Coding Agents

Do not optimize only for code generation.

Optimize for a product that a stressed family can trust, understand and operate safely.

When uncertain:
- preserve data,
- avoid irreversible actions,
- explain the uncertainty,
- ask for verification,
- and choose the safer implementation.
