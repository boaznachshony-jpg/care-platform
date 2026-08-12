# Production-readiness CI report checklist

Attach this checklist to a release candidate. A failed or skipped required gate
blocks production promotion; do not weaken a gate to make the report green.

## Required automated evidence

- [ ] **Migration safety:** applied migrations are immutable, new migrations are
      additive, correctly numbered, and pass before any database-dependent job.
- [ ] **Architecture guardrails:** the legacy `MvpProfile` allowlist has not
      expanded without explicit architecture review.
- [ ] **Static quality:** formatting, lint, typecheck, and build all pass.
- [ ] **Unit/integration:** all workspace tests pass, including authorization
      denial and audit behavior.
- [ ] **PostgreSQL security integration:** migrations apply to a clean PostgreSQL
      instance and the least-privilege role proves tenant isolation, denial
      without tenant context, append-only audit, document isolation, and
      cross-tenant foreign-key rejection.
- [ ] **Accessibility:** automated `vitest-axe` coverage remains in the unit gate;
      no accessibility test is skipped or excluded.
- [ ] **End to end:** both desktop and mobile Chromium projects pass; retry traces
      and failure screenshots are retained as CI artifacts.
- [ ] **Secret scan:** gitleaks passes across the checked-out history.

## Release report

- Commit SHA and immutable artifact/deployment identifier:
- CI run URL and completion time:
- Migration versions included and rollback/forward-fix owner:
- Required jobs and status (no missing or neutral required checks):
- Test counts and any quarantined tests (expected: none):
- Accessibility/E2E artifacts reviewed by:
- Security/RLS evidence reviewed by:
- Known limitations and linked follow-up issues:
- Production approver and approval timestamp:

## Manual release checks

- [ ] Restore/recovery procedure and recent backup evidence were reviewed.
- [ ] Production secrets, database URLs, and least-privilege roles were verified
      without copying secret values into the report.
- [ ] RTL keyboard navigation and the critical user journey received a manual
      smoke pass when the release changes UI behavior.
- [ ] Monitoring, alerting, and incident ownership are assigned for the rollout.
