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

- [x] RLS policies tested with at least two tenants — `pnpm db:rls-test`,
      passing against the live database as of 2026-07-25. It asserts that
      tenant A cannot SELECT, UPDATE, DELETE, or INSERT-as tenant B, and that
      a cross-tenant foreign key is rejected.
- [x] No tenant-owned table lacks `tenant_id` (migrations 0002/0003).
- [x] Automated cross-tenant denial tests for the case repository
      (`open-employment-case.test.ts` at the application layer, `db:rls-test`
      at the database layer).
- [ ] Audit events include tenant and actor context — the application records
      them, but audit is still an in-memory service, not a persisted table.
- [ ] Backup, restore, export, and deletion procedures preserve isolation.
- [x] Application connects as a dedicated `caredesk_app` login rather than
      assuming the role from an administrative connection. The connection
      configuration is split in two: `DATABASE_URL` is the `caredesk_app`
      login used by the running application, `DATABASE_ADMIN_URL` is the owner
      connection used only by `pnpm db:migrate` and
      `pnpm db:provision-app-role`. `caredesk_app` is given `LOGIN` and its own
      password by the provisioning script rather than by a migration, so the
      secret never enters a tracked file. The application process therefore
      holds no administrative credential, and a query that forgets
      `withTenant()` can no longer run with BYPASSRLS.

  Still outstanding on this line:

  - The `caredesk_app` password is a hand-managed value in `.env.local`; it is
    not yet held in a managed secret store, and there is no rotation
    procedure. Rotation today means re-running the provisioning script and
    updating `DATABASE_URL`, with a brief window where the two disagree.
  - `withTenant()` keeps its transaction-local `SET LOCAL ROLE caredesk_app`
    as defence in depth against `DATABASE_URL` being repointed at an
    administrative role. Nothing yet *asserts* that the connected role is
    non-administrative; that assertion belongs in `db:rls-test`
    (`select current_user`, and `rolbypassrls = false` for it).
  - `ALTER ROLE ... PASSWORD` cannot take a bind parameter, so provisioning
    embeds the password in the statement text via `pg.escapeLiteral`. That
    quoting is unit-tested (`packages/db/src/sql-literal.test.ts`) but the
    statement may still appear in the server log if `log_statement` is set to
    `ddl` or `all`.

### What the first RLS implementation got wrong

Recorded because the failure mode is easy to repeat and invisible without a
live test. Migrations 0002/0003 enabled RLS and added correct-looking
policies, and the isolation check still failed on every assertion:

1. `ENABLE ROW LEVEL SECURITY` does not apply to the table **owner**.
2. Even with `FORCE ROW LEVEL SECURITY`, any role holding **BYPASSRLS**
   skips policies entirely — and Supabase's `postgres` role has it.
3. Policies declared only `USING`, so INSERT was ungoverned; `WITH CHECK` is
   required to stop a write labelled with another tenant's id.

Fixed in 0004 (force + `WITH CHECK`) and 0005 (least-privilege
`caredesk_app` role, `NOBYPASSRLS`, assumed via transaction-local
`SET LOCAL ROLE`). The lesson for this ADR: RLS configuration that reads
correctly in a migration proves nothing until an isolation test runs against
the real database as the role the application actually uses.

## Migration impact

Applied to the development Supabase project on 2026-07-25:
`0002_identity_tenancy` (tenant, family_account, app_user, tenant_membership,
permission_grant), `0003_care_employment_core` (care_recipient, employer,
caregiver, employment_case with composite same-tenant foreign keys),
`0004_force_rls_and_with_check`, and `0005_app_role`. See `database/README.md`.

Remaining tables from the Database Blueprint (documents, tasks, workflows,
payroll, rules, audit, timeline) are added in later milestones; each must
carry `tenant_id`, enable **and force** RLS, and gain a corresponding case in
`db:rls-test` before it holds data.

## References

- Database Blueprint, especially canonical model and invariants.
- AI Coding Constitution sections 15–19.
- ADR-001.
