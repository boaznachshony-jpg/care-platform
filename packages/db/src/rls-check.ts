import { randomUUID } from 'node:crypto';
import { createPool, withTenant } from './pool.js';

/**
 * Live RLS isolation check against the real database (ADR-002 acceptance
 * evidence). Seeds two synthetic tenants, then proves — through the RLS
 * layer, using set_config('app.tenant_id') — that tenant A can neither read
 * nor mutate tenant B's rows, and that a cross-tenant FK insert is rejected.
 *
 * Two pools on purpose:
 *   - `appPool` (DATABASE_URL) connects as `caredesk_app`, the least-privilege
 *     role the application really uses. Every isolation assertion runs on it,
 *     so the test exercises the production path rather than an approximation.
 *   - `adminPool` (DATABASE_ADMIN_URL) connects as the owner and does only
 *     setup and teardown. `caredesk_app` deliberately cannot insert tenants or
 *     delete rows, so seeding and cleanup have to be somebody else's job.
 *
 * Idempotent-ish: it inserts fresh random-UUID rows each run and cleans them
 * up at the end. Synthetic data only (Constitution §16/§25).
 */
async function main(): Promise<void> {
  const appUrl = process.env.DATABASE_URL;
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!appUrl || !adminUrl) {
    console.error(
      'Both DATABASE_URL (caredesk_app) and DATABASE_ADMIN_URL (owner) must be set. See database/README.md.',
    );
    process.exit(1);
  }

  const pool = createPool(appUrl);
  const adminPool = createPool(adminUrl);
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const recipientA = randomUUID();
  const recipientB = randomUUID();
  const failures: string[] = [];
  const pass = (msg: string): void => console.log(`  PASS  ${msg}`);
  const fail = (msg: string): void => {
    failures.push(msg);
    console.log(`  FAIL  ${msg}`);
  };

  try {
    // 0. The application connection must not be able to bypass what follows.
    //    Every assertion below is meaningless if DATABASE_URL points at a role
    //    holding BYPASSRLS — which is exactly how the first implementation of
    //    this schema passed inspection while isolating nothing.
    {
      const result = await pool.query<{ current_user: string; bypassrls: boolean }>(
        'select current_user, (select rolbypassrls from pg_roles where rolname = current_user) as bypassrls',
      );
      const row = result.rows[0];
      if (row?.current_user === 'caredesk_app' && row.bypassrls === false) {
        pass('application connects as caredesk_app with NOBYPASSRLS');
      } else {
        fail(
          `application connects as "${row?.current_user}" with bypassrls=${row?.bypassrls} — expected caredesk_app / false`,
        );
      }
    }

    // Seed two tenants + one care_recipient each. Tenants go in on the admin
    // pool (caredesk_app has SELECT-only on `tenant`), but each care_recipient
    // is inserted through withTenant on the app pool, so even seeding obeys RLS.
    for (const [tenant, recipient, name] of [
      [tenantA, recipientA, 'Synthetic Recipient A'],
      [tenantB, recipientB, 'Synthetic Recipient B'],
    ] as const) {
      await adminPool.query('insert into tenant (id, data_region) values ($1, $2)', [
        tenant,
        'synthetic',
      ]);
      await withTenant(pool, tenant, async (client) => {
        await client.query(
          'insert into care_recipient (id, tenant_id, full_name, sensitivity) values ($1, $2, $3, $4)',
          [recipient, tenant, name, 'care_sensitive'],
        );
      });
    }

    // 1. Tenant A sees exactly its own recipient, not B's.
    await withTenant(pool, tenantA, async (client) => {
      const tenants = await client.query<{ id: string }>('select id from tenant');
      const tenantIds = tenants.rows.map((row) => row.id);
      if (tenantIds.length === 1 && tenantIds[0] === tenantA) {
        pass('tenant A sees only its own tenant reference row');
      } else {
        fail(`tenant A tenant reference SELECT leaked rows: ${JSON.stringify(tenantIds)}`);
      }

      const rows = await client.query<{ id: string }>('select id from care_recipient');
      const ids = rows.rows.map((r) => r.id);
      if (ids.includes(recipientA) && !ids.includes(recipientB)) {
        pass('tenant A SELECT returns only tenant A rows');
      } else {
        fail(`tenant A SELECT leaked rows: ${JSON.stringify(ids)}`);
      }
    });

    // 2. Tenant A cannot UPDATE tenant B's row (zero rows affected, not an error).
    await withTenant(pool, tenantA, async (client) => {
      const res = await client.query('update care_recipient set city = $1 where id = $2', [
        'hacked',
        recipientB,
      ]);
      if (res.rowCount === 0) {
        pass('tenant A UPDATE of tenant B row affects zero rows');
      } else {
        fail(`tenant A UPDATE affected ${res.rowCount} of tenant B's rows`);
      }
    });

    // 3. Tenant A cannot DELETE tenant B's row.
    await withTenant(pool, tenantA, async (client) => {
      const res = await client.query('delete from care_recipient where id = $1', [recipientB]);
      if (res.rowCount === 0) {
        pass('tenant A DELETE of tenant B row affects zero rows');
      } else {
        fail(`tenant A DELETE affected ${res.rowCount} of tenant B's rows`);
      }
    });

    // 4. Tenant A cannot INSERT a row labelled as tenant B (this is what the
    //    policies' WITH CHECK clause exists to stop — USING alone allows it).
    await withTenant(pool, tenantA, async (client) => {
      try {
        await client.query(
          'insert into care_recipient (id, tenant_id, full_name) values ($1, $2, $3)',
          [randomUUID(), tenantB, 'Smuggled Into Tenant B'],
        );
        fail('tenant A INSERT with tenant B tenant_id was NOT rejected');
      } catch {
        pass('tenant A INSERT with tenant B tenant_id is rejected by WITH CHECK');
      }
    });

    // 5. Cross-tenant FK: an employment_case in tenant A referencing tenant B's
    //    recipient must be rejected by the composite same-tenant FK.
    await withTenant(pool, tenantA, async (client) => {
      const employerId = randomUUID();
      const caregiverId = randomUUID();
      await client.query(
        'insert into employer (id, tenant_id, full_name, relationship_to_recipient) values ($1,$2,$3,$4)',
        [employerId, tenantA, 'Synthetic Employer A', 'child'],
      );
      await client.query(
        'insert into caregiver (id, tenant_id, legal_name, nationality) values ($1,$2,$3,$4)',
        [caregiverId, tenantA, 'Synthetic Caregiver A', 'Philippines'],
      );
      try {
        await client.query(
          `insert into employment_case
             (id, tenant_id, care_recipient_id, employer_id, caregiver_id, start_date)
           values ($1,$2,$3,$4,$5,$6)`,
          [randomUUID(), tenantA, recipientB, employerId, caregiverId, '2026-02-01'],
        );
        fail('cross-tenant employment_case insert was NOT rejected');
      } catch {
        pass('cross-tenant employment_case insert is rejected by composite FK');
      }
    });
    // 6. Every tenant-owned table must have RLS both enabled AND forced.
    //    A new table that forgets `force` looks protected but is not, which is
    //    exactly the defect migrations 0004/0005 were written to fix.
    {
      const expected = [
        'family_account',
        'tenant_membership',
        'permission_grant',
        'care_recipient',
        'employer',
        'caregiver',
        'employment_case',
        'organization',
        'contact',
        'contact_channel',
        'case_contact_role',
        'task',
        'timeline_event',
        'audit_event',
        'document',
        'document_version',
        'tenant_workspace',
        'workspace_file',
        'product_subscription',
        'billing_setup_intent',
        'product_billing_charge',
      ];
      const result = await pool.query<{ relname: string; ok: boolean }>(
        `select relname, (relrowsecurity and relforcerowsecurity) as ok
           from pg_class
          where relkind = 'r' and relname = any($1)`,
        [expected],
      );
      const byName = new Map(result.rows.map((row) => [row.relname, row.ok]));
      const unprotected = expected.filter((name) => byName.get(name) !== true);
      if (unprotected.length === 0) {
        pass(`RLS enabled and forced on all ${expected.length} tenant-owned tables`);
      } else {
        fail(`RLS not enabled+forced on: ${unprotected.join(', ')}`);
      }
    }

    // 7. The app role must not be able to reshape the schema.
    await withTenant(pool, tenantA, async (client) => {
      try {
        await client.query('create table rls_probe_should_fail (id int)');
        fail('caredesk_app was able to CREATE TABLE');
      } catch {
        pass('caredesk_app cannot create tables');
      }
    });

    // 8. The audit trail must be append-only for the application. An audit log
    //    the application can rewrite is not evidence of anything.
    await withTenant(pool, tenantA, async (client) => {
      await client.query(
        `insert into audit_event
           (tenant_id, actor_id, action, resource_type, resource_id, occurred_at, correlation_id)
         values ($1, null, 'rls.probe', 'system', 'probe', now(), 'rls-check')`,
        [tenantA],
      );
      const updated = await client
        .query('update audit_event set action = $1 where tenant_id = $2', ['tampered', tenantA])
        .then(() => 'allowed')
        .catch(() => 'denied');
      const deleted = await client
        .query('delete from audit_event where tenant_id = $1', [tenantA])
        .then(() => 'allowed')
        .catch(() => 'denied');

      if (updated === 'denied' && deleted === 'denied') {
        pass('audit_event is append-only for caredesk_app (no update, no delete)');
      } else {
        fail(`audit_event is mutable by caredesk_app: update=${updated}, delete=${deleted}`);
      }
    });

    // 9. Supabase's browser-facing roles must not have direct access to the
    //    public schema. Authentication uses Supabase, but all CareDesk data
    //    access goes through the API and its caredesk_app role.
    {
      const tableGrants = await pool.query<{ object_name: string; grantee: string }>(
        `select table_name as object_name, grantee
           from information_schema.role_table_grants
          where table_schema = 'public'
            and grantee in ('anon', 'authenticated')`,
      );
      const routineGrants = await pool.query<{ object_name: string; grantee: string }>(
        `select routine_name as object_name, grantee
           from information_schema.role_routine_grants
          where specific_schema = 'public'
            and grantee in ('anon', 'authenticated', 'PUBLIC')`,
      );
      if (tableGrants.rowCount === 0 && routineGrants.rowCount === 0) {
        pass('Supabase anon/authenticated roles have no public table or function grants');
      } else {
        fail(
          `browser-facing grants remain: ${JSON.stringify({
            tables: tableGrants.rows,
            routines: routineGrants.rows,
          })}`,
        );
      }
    }

    // 10. Global/control tables are also protected even though the API reaches
    //     them only through narrow SECURITY DEFINER functions.
    {
      const expected = ['tenant', 'app_user', 'schema_migrations'];
      const result = await pool.query<{ relname: string; ok: boolean }>(
        `select relname, (relrowsecurity and relforcerowsecurity) as ok
           from pg_class
          where relkind = 'r' and relname = any($1)`,
        [expected],
      );
      const byName = new Map(result.rows.map((row) => [row.relname, row.ok]));
      const unprotected = expected.filter((name) => byName.get(name) !== true);
      if (unprotected.length === 0) {
        pass('RLS enabled and forced on all global/control tables');
      } else {
        fail(`global/control tables without forced RLS: ${unprotected.join(', ')}`);
      }
    }
  } finally {
    // Teardown runs on the admin pool: caredesk_app deliberately cannot delete
    // rows or drop tables, which is the property assertions 7 and 8 rely on.
    await adminPool.query('drop table if exists rls_probe_should_fail');
    for (const tenant of [tenantA, tenantB]) {
      await adminPool.query('delete from audit_event where tenant_id = $1', [tenant]);
      await adminPool.query('delete from timeline_event where tenant_id = $1', [tenant]);
      await adminPool.query('delete from task where tenant_id = $1', [tenant]);
      await adminPool.query('delete from case_contact_role where tenant_id = $1', [tenant]);
      await adminPool.query('delete from contact_channel where tenant_id = $1', [tenant]);
      await adminPool.query('delete from contact where tenant_id = $1', [tenant]);
      await adminPool.query('delete from organization where tenant_id = $1', [tenant]);
      await adminPool.query('delete from employment_case where tenant_id = $1', [tenant]);
      await adminPool.query('delete from caregiver where tenant_id = $1', [tenant]);
      await adminPool.query('delete from employer where tenant_id = $1', [tenant]);
      await adminPool.query('delete from care_recipient where tenant_id = $1', [tenant]);
      await adminPool.query('delete from tenant where id = $1', [tenant]);
    }
    await pool.end();
    await adminPool.end();
  }

  if (failures.length > 0) {
    console.error(`\nRLS check FAILED: ${failures.length} problem(s).`);
    process.exit(1);
  }
  console.log('\nRLS isolation check passed.');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
