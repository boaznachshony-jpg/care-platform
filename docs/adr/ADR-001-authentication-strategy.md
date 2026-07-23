# ADR-001: Authentication Strategy

- Status: **Proposed**
- Date: 2026-07-23
- Owners: Product, Security, Engineering

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
step-up-authentication actions defined by security policy.

## Consequences

- Fast integration with PostgreSQL and RLS.
- Vendor-specific session claims remain inside the infrastructure adapter.
- Authentication does not grant case access by itself; authorization requires
  `TenantMembership`, case scope, permission, sensitivity, and validity checks.
- No production configuration is allowed until privacy, DPA, recovery, audit,
  and region requirements are reviewed.

## Acceptance evidence

- Threat model and session-lifecycle review.
- MFA and recovery flows tested.
- Mapping between auth subject and `User` documented.
- RLS claims and server-side authorization tested.
- Supplier and privacy assessment approved.

## References

- Product Specification sections 11 and 16.
- AI Coding Constitution sections 16–18.
- ADR-002 and Database Blueprint.
