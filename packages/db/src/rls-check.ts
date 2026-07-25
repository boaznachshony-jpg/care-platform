import { randomUUID } from 'node:crypto';
import { createPool, withTenant } from './pool.js';

/**
 * Live RLS isolation check against the real database (ADR-002 acceptance
 * evidence). Seeds two synthetic tenants, then proves — through the RLS
 * layer, using set_config('app.tenant_id') — that tenant A can neither read
 * nor mutate tenant B's rows, and that a cross-tenant FK insert is rejected.
 *
 * Idempotent-ish: it inserts fresh random-UUID rows each run and cleans them
 * up at the end. Synthetic data only (Constitution §16/§25).
 */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Put it in .env.local and retry.');
    process.exit(1);
  }

  const pool = createPool(connectionString);
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
    // Seed two tenants + one care_recipient each. The tenant rows go in as the
    // owner (tenant is global reference data), but each care_recipient is
    // inserted through withTenant, so even the seeding path obeys RLS.
    for (const [tenant, recipient, name] of [
      [tenantA, recipientA, 'Synthetic Recipient A'],
      [tenantB, recipientB, 'Synthetic Recipient B'],
    ] as const) {
      await pool.query('insert into tenant (id, data_region) values ($1, $2)', [
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
  } finally {
    // Cleanup runs as the owner (not caredesk_app) so it can remove every
    // synthetic row regardless of which tenant a failed test left it under.
    await pool.query('drop table if exists rls_probe_should_fail');
    for (const tenant of [tenantA, tenantB]) {
      await pool.query('delete from timeline_event where tenant_id = $1', [tenant]);
      await pool.query('delete from task where tenant_id = $1', [tenant]);
      await pool.query('delete from case_contact_role where tenant_id = $1', [tenant]);
      await pool.query('delete from contact_channel where tenant_id = $1', [tenant]);
      await pool.query('delete from contact where tenant_id = $1', [tenant]);
      await pool.query('delete from organization where tenant_id = $1', [tenant]);
      await pool.query('delete from employment_case where tenant_id = $1', [tenant]);
      await pool.query('delete from caregiver where tenant_id = $1', [tenant]);
      await pool.query('delete from employer where tenant_id = $1', [tenant]);
      await pool.query('delete from care_recipient where tenant_id = $1', [tenant]);
      await pool.query('delete from tenant where id = $1', [tenant]);
    }
    await pool.end();
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
