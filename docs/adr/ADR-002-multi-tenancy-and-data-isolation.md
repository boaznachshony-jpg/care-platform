# ADR-002: Multi-tenancy and Data Isolation

- Status: **Accepted — development scope**
- Date: 2026-07-23
- Owners: Product, Security, Data, Engineering
- Approved by: Product Owner (directed Milestone 1 identity/tenancy schema work, 2026-07-23)
- Approved at: 2026-07-23
- Scope note: acceptance covers development/synthetic-data environments only.
  Production infrastructure (real tenant data, hosting region, backups)
  remains gated on the privacy and supplier review listed under Acceptance
  evidence.

## Context

The MVP serves one family household and one active employment case, while the
future product must support multiple cases and professional portfolios. The
historical specifications used `Account` and `FamilyAccount` inconsistently.

## Decision

Use a shared PostgreSQL database and shared schema. `Tenant` is the technical
isolation boundary. Every tenant-owned business table carries a non-null
`tenant_id`; PostgreSQL RLS and server-side authorization both enforce it.

`FamilyAccount` is a one-to-one business profile of a Tenant, not a second
security boundary. `User` is global and receives access only through
`TenantMembership`. Case-level and resource-level grants may narrow, never
broaden, tenant access.

## Alternatives considered

- **Database-per-tenant**: rejected for MVP. More expensive and operationally
  heavier (migrations run per database), complicates cross-tenant reporting
  and observability, and isn't required at the expected tenant count for MVP
  or pilot. Does not, by itself, remove the need for application-level
  authorization anyway. Revisit only if a future enterprise/white-label tier
  requires hard physical isolation.
- **Schema-per-tenant**: rejected — similar migration overhead to
  database-per-tenant without a proportional isolation benefit at this scale;
  RLS on a shared schema gives comparable logical isolation at far lower
  operational cost.

## Consequences

- Migrations and reporting stay manageable.
- All queries, jobs, storage paths, audit events, and cache keys require tenant
  context.
- Compound foreign keys or database checks must prevent cross-tenant
  references.
- Background jobs run under an explicit tenant and service principal.
- Object storage uses private buckets and tenant-prefixed keys; a prefix alone
  is not an authorization control.
- A bug in an RLS policy or a missing `tenant_id` filter is the primary
  cross-tenant data-leak risk in this model — RLS policies must be part of
  the Milestone 0 permission skeleton and covered by integration tests before
  any real, even pilot, tenant data is created.

## Acceptance evidence

- Automated cross-tenant denial tests for every repository.
- RLS policies tested with at least two tenants and multiple roles.
- No tenant-owned table lacks `tenant_id`.
- Audit events include tenant and actor context.
- Backup, restore, export, and deletion procedures preserve isolation.

## Migration impact

None yet — no existing schema; all prior repository branches were confirmed
empty during the branch audit. Core tenancy tables to establish in
Milestone 0: `tenant`, `user`, `tenant_membership`, `care_recipient`,
`employment_case`, `caregiver`, `case_membership`, `permission_grant`, per
the Database Blueprint.

## References

- Database Blueprint, especially canonical model and invariants.
- AI Coding Constitution sections 15–19.
- ADR-001.
