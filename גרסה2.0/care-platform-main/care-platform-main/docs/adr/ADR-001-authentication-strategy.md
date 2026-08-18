# ADR-001: Authentication Strategy

- Status: **Proposed**
- Date: 2026-07-23
- Owners: Product, Security, Engineering
- Approved by: _(unassigned)_
- Approved at: _(pending)_

## Context

CareDesk requires managed identity, secure sessions, passwordless onboarding,
MFA for sensitive roles and actions, and future integration with PostgreSQL
Row Level Security. Milestone 0 must not couple domain code directly to one
vendor SDK.

## Decision

Use **Supabase Auth** as the planned MVP identity provider. Application code
will depend on an internal `AuthService` port. Local and automated tests use a
deterministic mock adapter.

MFA is mandatory for administrators, professional users, permission changes,
unmasking identity or bank data, payroll approval, exports, and other
step-up-authentication actions defined by security policy. Regular family
members may start with magic link or email OTP only, with MFA available as an
upgrade path.

## Alternatives considered

- **Auth0**: stronger enterprise SSO and identity-provider breadth. Rejected
  for MVP — adds a second vendor to keep in sync with the Postgres
  user/tenant model, which isn't justified before a professional-portal
  module (out of MVP scope) is scheduled. Revisit if/when that module is
  planned.
- **Roll-your-own (custom JWT/session handling)**: rejected — introduces
  custom security-sensitive infrastructure the Constitution discourages when
  a vetted managed provider satisfies the requirement, with higher risk of
  auth bugs in a compliance-sensitive product.

## Consequences

- Fast integration with PostgreSQL and RLS.
- Vendor-specific session claims remain inside the infrastructure adapter.
- Authentication does not grant case access by itself; authorization requires
  `TenantMembership`, case scope, permission, sensitivity, and validity checks.
- No production configuration is allowed until privacy, DPA, recovery, audit,
  and region requirements are reviewed.
- Adds a hard dependency on Supabase for both auth and (per ADR-002) the
  primary database — a single-vendor concentration risk, mitigated by
  Supabase's use of standard PostgreSQL and standard JWT, which limits
  lock-in for a future migration.

## Acceptance evidence

- Threat model and session-lifecycle review.
- MFA and recovery flows tested.
- Mapping between auth subject and `User` documented.
- RLS claims and server-side authorization tested.
- Supplier and privacy assessment approved.

## Migration impact

None yet — no existing auth system to migrate from; all prior repository
branches were confirmed empty during the branch audit. A future migration
away from Supabase Auth, if ever needed, would require re-issuing sessions
and migrating password hashes/MFA enrollments — an acceptable risk given the
expected user-base size during MVP and pilot.

## References

- Product Specification sections 11 and 16.
- AI Coding Constitution sections 16–18.
- ADR-002 and Database Blueprint.
