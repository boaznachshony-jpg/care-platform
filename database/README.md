# Database

Postgres schema, migrations, and the live RLS isolation check.

## Environment

The schema currently lives on a managed Supabase Postgres (ADR-001/ADR-002).
`docker-compose.yml` remains for a fully local alternative but has **not** been
exercised — the migrations below were developed and verified against Supabase.

`.env.local` (gitignored, never committed) holds **two** connection strings,
because the application must never carry an administrative credential:

```
# Owner. Migrations and role provisioning ONLY.
DATABASE_ADMIN_URL=postgresql://postgres.<project-ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres

# Application. caredesk_app is NOBYPASSRLS, so RLS applies to every query.
DATABASE_URL=postgresql://caredesk_app.<project-ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres
```

The split is the point: the owner role carries `BYPASSRLS`, so any query that
forgot `withTenant()` would silently escape tenant isolation. Connecting as
`caredesk_app` makes that impossible rather than merely unlikely.

### Provisioning caredesk_app (once per environment)

`0005_app_role.sql` creates the role as `NOLOGIN`. Give it its own password —
never in a migration, never in git, never on a command line:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Put that in `.env.local` as `CAREDESK_APP_DB_PASSWORD`, keep `DATABASE_URL` on
the owner for now, then:

```bash
pnpm db:migrate              # reads DATABASE_ADMIN_URL
pnpm db:provision-app-role   # grants LOGIN, re-asserts NOBYPASSRLS
```

Only after that succeeds, repoint `DATABASE_URL` at
`caredesk_app.<project-ref>` and delete `CAREDESK_APP_DB_PASSWORD`. Switching
early fails closed — the role is still `NOLOGIN`, so connections are rejected
at authentication.

Note the pooler username is the role name **plus** the project-ref suffix
(`caredesk_app.<project-ref>`), which is not obvious. Verified working against
Supavisor session mode.

`ALTER ROLE … PASSWORD` may appear in the server log if `log_statement` is
`ddl` or `all` — check before running, and rotate afterwards if it does.

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

Before applying any migration to a remote environment, complete the database
and private Storage backup gates in
[`docs/operations/production-release-and-recovery.md`](../docs/operations/production-release-and-recovery.md).
Run `pnpm db:migration-safety` in every PR; CI rejects edits to applied
migrations and common destructive or rolling-deployment-incompatible changes.

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
