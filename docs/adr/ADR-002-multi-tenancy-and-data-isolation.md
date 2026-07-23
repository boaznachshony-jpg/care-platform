# ADR-002: Multi-tenancy and Data Isolation

- Status: **Proposed**
- Date: 2026-07-23
- Owners: Product, Security, Data, Engineering

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

## Consequences

- Migrations and reporting stay manageable.
- All queries, jobs, storage paths, audit events, and cache keys require tenant
  context.
- Compound foreign keys or database checks must prevent cross-tenant
  references.
- Background jobs run under an explicit tenant and service principal.
- Object storage uses private buckets and tenant-prefixed keys; a prefix alone
  is not an authorization control.

## Acceptance evidence

- Automated cross-tenant denial tests for every repository.
- RLS policies tested with at least two tenants and multiple roles.
- No tenant-owned table lacks `tenant_id`.
- Audit events include tenant and actor context.
- Backup, restore, export, and deletion procedures preserve isolation.

## References

- Database Blueprint, especially canonical model and invariants.
- AI Coding Constitution sections 15–19.
- ADR-001.
