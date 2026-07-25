# Database

Postgres schema, migrations, and the live RLS isolation check.

## Environment

The schema currently lives on a managed Supabase Postgres (ADR-001/ADR-002).
`docker-compose.yml` remains for a fully local alternative but has **not** been
exercised — the migrations below were developed and verified against Supabase.

Put the connection string in `.env.local` (gitignored, never committed):

```
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres
```

Two things to know about that URL:

- **Use the Supavisor session pooler on port 5432**, not `db.<ref>.supabase.co`.
  The direct host resolves to IPv6 only, which is unreachable from networks
  without IPv6 egress. Port 5432 (session mode) is required — the transaction
  pooler on 6543 cannot run the DDL these migrations contain.
- The pooler username is `postgres.<project-ref>`, not plain `postgres`.

## Commands

```bash
pnpm db:migrate    # apply pending migrations (idempotent)
pnpm db:rls-test   # live tenant-isolation check; exits non-zero on any leak
```

Both read `DATABASE_URL` from `.env.local` via `node --env-file`, so the secret
never appears in shell history or a process listing.

## Migrations

Named `NNNN_snake_case.sql`, applied in ascending order, each in its own
transaction, each recording its own version in `schema_migrations`. Never edit
an applied migration — add a new one.

| Migration | Purpose |
|---|---|
| `0001_baseline` | `schema_migrations` bookkeeping only |
| `0002_identity_tenancy` | tenant, family_account, app_user, tenant_membership, permission_grant |
| `0003_care_employment_core` | care_recipient, employer, caregiver, employment_case + same-tenant FKs |
| `0004_force_rls_and_with_check` | `FORCE ROW LEVEL SECURITY` + `WITH CHECK` on every policy |
| `0005_app_role` | least-privilege `caredesk_app` role |

### Why 0004 and 0005 exist

The first RLS attempt (0002/0003) did not actually isolate anything, and
`pnpm db:rls-test` is what caught it. Two separate defects:

1. `ENABLE ROW LEVEL SECURITY` does not apply to a table's **owner**. Adding
   `FORCE ROW LEVEL SECURITY` (0004) fixes that.
2. Even forced, RLS is skipped by any role holding the **BYPASSRLS**
   attribute — and Supabase's `postgres` role has it. So the application must
   not act as that role: `caredesk_app` (0005) is `NOBYPASSRLS`, and
   `withTenant()` issues `SET LOCAL ROLE caredesk_app` alongside the tenant
   context, both transaction-local so a pooled connection cannot leak either.

Policies also gained `WITH CHECK` in 0004; `USING` alone governs which rows are
*visible*, so an INSERT could still write a row belonging to another tenant.

**Production hardening (not done):** provision `caredesk_app` with `LOGIN` and
its own managed-secret password and connect as it directly, so no
administrative credential is present in the application at all.

## RLS isolation check

`pnpm db:rls-test` seeds two synthetic tenants and asserts, through the RLS
layer, that tenant A cannot:

- SELECT tenant B's rows
- UPDATE or DELETE tenant B's rows (zero rows affected, not an error)
- INSERT a row labelled with tenant B's `tenant_id` (blocked by `WITH CHECK`)
- create an `employment_case` referencing tenant B's care recipient (blocked by
  the composite same-tenant foreign key)

It cleans up after itself and uses synthetic data only (Constitution §16/§25).
Run it after any change to a policy, a tenant-owned table, or `withTenant()`.
