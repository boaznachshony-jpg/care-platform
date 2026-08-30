import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { createPool, withTenant } from './pool.js';
import { assertRlsTestTargetIsSafe } from './rls-check-target.js';

const NORMALIZED_TABLES = [
  'care_recipient',
  'employer',
  'caregiver',
  'employment_case',
  'task',
  'timeline_event',
  'document',
  'document_version',
  'audit_event',
] as const;

const MUTABLE_TABLES = [
  'care_recipient',
  'employer',
  'caregiver',
  'employment_case',
  'task',
  'document',
] as const;

const APPEND_ONLY_TABLES = ['timeline_event', 'document_version', 'audit_event'] as const;
const WAVE4_TABLES = ['document_intake_review', 'event_action_plan'] as const;

const ALL_TENANT_TABLES = [
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
  'employment_authorization',
  'workflow_instance',
  'workflow_rule_evaluation',
  'workflow_evaluation_source',
  'workflow_step',
  'workflow_assignment',
  'workflow_blocker',
  'idempotency_record',
  'workflow_contact_activity',
  'employment_authorization_link',
  'authorization_overlap_review',
  'workflow_completion',
  'payroll_month_close',
  'document_intake_review',
  'event_action_plan',
  'case_responsibility_assignment',
  'worker_portal_access',
  'worker_portal_invitation',
  'worker_payment_acknowledgement',
  'worker_request',
  'communication_preference',
  'notification_intent',
  'notification_delivery_attempt',
  'automation_execution_receipt',
  'payroll_entry',
  'professional_review_transition',
  'binder_export_receipt',
  'regulation_rule',
  'regulation_rule_transition',
] as const;

interface Fixture {
  readonly tenant: string;
  readonly user: string;
  readonly membership: string;
  readonly recipient: string;
  readonly employer: string;
  readonly caregiver: string;
  readonly employmentCase: string;
  readonly task: string;
  readonly timelineEvent: string;
  readonly document: string;
  readonly documentVersion: string;
  readonly auditEvent: string;
  readonly documentIntakeReview: string;
  readonly eventActionPlan: string;
}

function fixture(): Fixture {
  return {
    tenant: randomUUID(),
    user: randomUUID(),
    membership: randomUUID(),
    recipient: randomUUID(),
    employer: randomUUID(),
    caregiver: randomUUID(),
    employmentCase: randomUUID(),
    task: randomUUID(),
    timelineEvent: randomUUID(),
    document: randomUUID(),
    documentVersion: randomUUID(),
    auditEvent: randomUUID(),
    documentIntakeReview: randomUUID(),
    eventActionPlan: randomUUID(),
  };
}

function ids(row: Fixture): Record<(typeof NORMALIZED_TABLES)[number], string> {
  return {
    care_recipient: row.recipient,
    employer: row.employer,
    caregiver: row.caregiver,
    employment_case: row.employmentCase,
    task: row.task,
    timeline_event: row.timelineEvent,
    document: row.document,
    document_version: row.documentVersion,
    audit_event: row.auditEvent,
  };
}

async function withAppRoleWithoutTenant<T>(
  pool: ReturnType<typeof createPool>,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role caredesk_app');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function seed(admin: ReturnType<typeof createPool>, row: Fixture, label: string) {
  await admin.query('insert into tenant (id, data_region) values ($1, $2)', [
    row.tenant,
    'synthetic',
  ]);
  await admin.query(
    `insert into app_user (id, auth_subject, display_name, email)
     values ($1, $2, $3, $4)`,
    [row.user, `rls-${row.user}`, `Synthetic User ${label}`, `${row.user}@example.invalid`],
  );
  await admin.query(
    `insert into tenant_membership (id, tenant_id, user_id, role)
     values ($1, $2, $3, 'owner')`,
    [row.membership, row.tenant, row.user],
  );
  await admin.query(
    `insert into family_account (tenant_id, display_name, primary_contact_membership_id)
     values ($1, $2, $3)`,
    [row.tenant, `Synthetic Family ${label}`, row.membership],
  );
  await admin.query(
    `insert into permission_grant
       (tenant_id, membership_id, resource_type, permission, granted_by, reason)
     values ($1, $2, 'employment_case', 'manage', $3, 'rls-check')`,
    [row.tenant, row.membership, row.user],
  );
  await admin.query(
    `insert into care_recipient (id, tenant_id, full_name)
     values ($1, $2, $3)`,
    [row.recipient, row.tenant, `Synthetic Recipient ${label}`],
  );
  await admin.query(
    `insert into employer (id, tenant_id, full_name, relationship_to_recipient)
     values ($1, $2, $3, 'family')`,
    [row.employer, row.tenant, `Synthetic Employer ${label}`],
  );
  await admin.query(
    `insert into caregiver (id, tenant_id, legal_name, nationality)
     values ($1, $2, $3, 'Synthetic')`,
    [row.caregiver, row.tenant, `Synthetic Caregiver ${label}`],
  );
  await admin.query(
    `insert into employment_case
       (id, tenant_id, care_recipient_id, employer_id, caregiver_id, start_date,
        primary_manager_membership_id)
     values ($1, $2, $3, $4, $5, '2026-01-01', $6)`,
    [row.employmentCase, row.tenant, row.recipient, row.employer, row.caregiver, row.membership],
  );
  await admin.query(
    `insert into task (id, tenant_id, employment_case_id, title, due_at)
     values ($1, $2, $3, $4, now() + interval '1 day')`,
    [row.task, row.tenant, row.employmentCase, `Synthetic Task ${label}`],
  );
  await admin.query(
    `insert into timeline_event
       (id, tenant_id, employment_case_id, event_type_key, summary_key, occurred_at)
     values ($1, $2, $3, 'rls.probe', 'rls.probe', now())`,
    [row.timelineEvent, row.tenant, row.employmentCase],
  );
  await admin.query(
    `insert into document
       (id, tenant_id, employment_case_id, document_type, owner_type, owner_id,
        compliance_status, expires_at)
     values ($1, $2, $3, 'passport', 'caregiver', $4, 'valid', now() + interval '30 days')`,
    [row.document, row.tenant, row.employmentCase, row.caregiver],
  );
  await admin.query(
    `insert into document_version
       (id, tenant_id, document_id, version_number, storage_key, media_type, size_bytes)
     values ($1, $2, $3, 1, $4, 'application/octet-stream', 1)`,
    [row.documentVersion, row.tenant, row.document, `synthetic/${row.documentVersion}`],
  );
  await admin.query('update document set current_version_id = $1 where id = $2', [
    row.documentVersion,
    row.document,
  ]);
  await admin.query(
    `insert into audit_event
       (id, tenant_id, actor_id, action, resource_type, resource_id, occurred_at,
        correlation_id)
     values ($1, $2, $3, 'rls.probe', 'employment_case', $4, now(), 'rls-check')`,
    [row.auditEvent, row.tenant, row.user, row.employmentCase],
  );
  await admin.query(
    `insert into document_intake_review
       (tenant_id, id, employment_case_id, document_id, document_version_id,
        classification, review_state)
     values ($1, $2, $3, $4, $5, 'passport', 'validated')`,
    [row.tenant, row.documentIntakeReview, row.employmentCase, row.document, row.documentVersion],
  );
  await admin.query(
    `insert into event_action_plan
       (tenant_id, id, employment_case_id, event_type, event_date, status, answers,
        idempotency_key)
     values ($1, $2, $3, 'caregiver_travel', '2027-01-01', 'confirmed', '{}', $4)`,
    [row.tenant, row.eventActionPlan, row.employmentCase, `rls-${row.eventActionPlan}`],
  );
}

async function main(): Promise<void> {
  const appUrl = process.env.DATABASE_URL;
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!appUrl || !adminUrl) {
    throw new Error('DATABASE_URL and DATABASE_ADMIN_URL are both required.');
  }

  // Before any pool is opened: the cleanup block below deletes from sixteen
  // tables over the BYPASSRLS owner connection, so the target has to be proved
  // non-production first. See rls-check-target.ts for the rules.
  assertRlsTestTargetIsSafe({
    connections: [
      { name: 'DATABASE_URL', url: appUrl },
      { name: 'DATABASE_ADMIN_URL', url: adminUrl },
    ],
    source: process.env,
  });

  const ciRoleSwitch = process.env.RLS_TEST_MODE === 'ci-role-switch';
  const pool = createPool(appUrl, !ciRoleSwitch);
  const admin = createPool(adminUrl, !ciRoleSwitch);
  const a = fixture();
  const b = fixture();
  const failures: string[] = [];
  const pass = (message: string) => console.log(`  PASS  ${message}`);
  const fail = (message: string) => {
    failures.push(message);
    console.log(`  FAIL  ${message}`);
  };
  const expectRejected = async (message: string, work: () => Promise<unknown>) => {
    try {
      await work();
      fail(`${message} was allowed`);
    } catch {
      pass(`${message} is rejected`);
    }
  };

  try {
    const connection = await pool.query<{ current_user: string; bypassrls: boolean }>(
      `select current_user,
              (select rolbypassrls from pg_roles where rolname = current_user) as bypassrls`,
    );
    const connected = connection.rows[0];
    if (ciRoleSwitch) {
      await withAppRoleWithoutTenant(pool, async (client) => {
        const role = await client.query<{ current_user: string; bypassrls: boolean }>(
          `select current_user,
                  (select rolbypassrls from pg_roles where rolname = current_user) as bypassrls`,
        );
        const active = role.rows[0];
        if (active?.current_user === 'caredesk_app' && active.bypassrls === false) {
          pass('CI assertions switch to caredesk_app with NOBYPASSRLS');
        } else {
          fail(`CI role switch produced ${JSON.stringify(active)}`);
        }
      });
    } else if (connected?.current_user === 'caredesk_app' && connected.bypassrls === false) {
      pass('application connects directly as caredesk_app with NOBYPASSRLS');
    } else {
      fail(
        `application connection is ${JSON.stringify(connected)}, expected caredesk_app/NOBYPASSRLS`,
      );
    }

    await seed(admin, a, 'A');
    await seed(admin, b, 'B');
    const aIds = ids(a);
    const bIds = ids(b);

    await withTenant(pool, a.tenant, async (client) => {
      const tenants = await client.query<{ id: string }>('select id from tenant');
      const tenantIds = tenants.rows.map(({ id }) => id);
      if (tenantIds.length === 1 && tenantIds[0] === a.tenant) {
        pass('tenant reference lookup returns only the active tenant context');
      } else {
        fail(`tenant reference lookup exposed ${JSON.stringify(tenantIds)}`);
      }

      for (const table of NORMALIZED_TABLES) {
        const rows = await client.query<{ id: string }>(`select id from ${table} order by id`);
        const visible = rows.rows.map(({ id }) => id);
        if (visible.includes(aIds[table]) && !visible.includes(bIds[table])) {
          pass(`${table}: tenant A reads only its own normalized row`);
        } else {
          fail(`${table}: tenant A saw ${JSON.stringify(visible)}`);
        }
      }

      for (const table of WAVE4_TABLES) {
        const rows = await client.query<{ tenant_id: string }>(`select tenant_id from ${table}`);
        if (rows.rows.length === 1 && rows.rows[0]?.tenant_id === a.tenant) {
          pass(`${table}: tenant A reads only its own row`);
        } else {
          fail(`${table}: tenant A saw ${JSON.stringify(rows.rows)}`);
        }
      }
    });

    await withTenant(pool, a.tenant, async (client) => {
      const reviewId = randomUUID();
      const planId = randomUUID();
      await client.query(
        `insert into document_intake_review
           (tenant_id, id, employment_case_id, document_id, document_version_id,
            classification, review_state)
         values ($1, $2, $3, $4, $5, 'passport', 'validated')`,
        [a.tenant, reviewId, a.employmentCase, a.document, a.documentVersion],
      );
      await client.query(
        `insert into event_action_plan
           (tenant_id, id, employment_case_id, event_type, status, answers, idempotency_key)
         values ($1, $2, $3, 'caregiver_travel', 'confirmed', '{}', $4)`,
        [a.tenant, planId, a.employmentCase, `rls-same-${planId}`],
      );
      pass('Wave 4 tables: same-tenant inserts succeed');
    });

    for (const table of WAVE4_TABLES) {
      await expectRejected(`${table}: cross-tenant insert`, () =>
        withTenant(pool, a.tenant, (client) =>
          table === 'document_intake_review'
            ? client.query(
                `insert into document_intake_review
                   (tenant_id, employment_case_id, document_id, document_version_id,
                    classification, review_state)
                 values ($1, $2, $3, $4, 'passport', 'validated')`,
                [b.tenant, b.employmentCase, b.document, b.documentVersion],
              )
            : client.query(
                `insert into event_action_plan
                   (tenant_id, employment_case_id, event_type, status, answers, idempotency_key)
                 values ($1, $2, 'caregiver_travel', 'confirmed', '{}', $3)`,
                [b.tenant, b.employmentCase, `rls-cross-${randomUUID()}`],
              ),
        ),
      );
    }

    await withTenant(pool, a.tenant, async (client) => {
      const update = await client.query(
        `update document_intake_review set review_state = 'cancelled' where id = $1`,
        [b.documentIntakeReview],
      );
      if (update.rowCount === 0)
        pass('document_intake_review: cross-tenant update affects zero rows');
      else fail(`document_intake_review: cross-tenant update affected ${update.rowCount} rows`);
    });

    await expectRejected('event_action_plan: application update', () =>
      withTenant(pool, a.tenant, (client) =>
        client.query(`update event_action_plan set status = 'cancelled' where id = $1`, [
          a.eventActionPlan,
        ]),
      ),
    );
    await expectRejected('event_action_plan: application delete', () =>
      withTenant(pool, a.tenant, (client) =>
        client.query(`delete from event_action_plan where id = $1`, [a.eventActionPlan]),
      ),
    );

    for (const table of NORMALIZED_TABLES) {
      try {
        const result = await withAppRoleWithoutTenant(pool, (client) =>
          client.query<{ count: string }>(`select count(*)::text as count from ${table}`),
        );
        if (result.rows[0]?.count === '0') {
          pass(`${table}: missing tenant context returns no rows`);
        } else {
          fail(`${table}: missing tenant context exposed ${result.rows[0]?.count} rows`);
        }
      } catch {
        // PostgreSQL can expose an unset transaction-local custom setting as
        // an empty string after a pooled connection is reused. UUID-casting
        // policies reject that value, which is also a safe fail-closed result.
        pass(`${table}: missing tenant context is rejected`);
      }
    }

    for (const table of MUTABLE_TABLES) {
      await withTenant(pool, a.tenant, async (client) => {
        const update = await client.query(
          `update ${table} set tenant_id = tenant_id where id = $1`,
          [bIds[table]],
        );
        const remove = await client.query(`delete from ${table} where id = $1`, [bIds[table]]);
        if (update.rowCount === 0 && remove.rowCount === 0) {
          pass(`${table}: cross-tenant update/delete affects zero rows`);
        } else {
          fail(
            `${table}: cross-tenant mutation affected update=${update.rowCount}, delete=${remove.rowCount}`,
          );
        }
      });
      await expectRejected(`${table}: rewriting an owned row to tenant B`, () =>
        withTenant(pool, a.tenant, (client) =>
          client.query(`update ${table} set tenant_id = $1 where id = $2`, [b.tenant, aIds[table]]),
        ),
      );
    }

    for (const table of APPEND_ONLY_TABLES) {
      await expectRejected(`${table}: application update`, () =>
        withTenant(pool, a.tenant, (client) =>
          client.query(`update ${table} set tenant_id = tenant_id where id = $1`, [aIds[table]]),
        ),
      );
      await expectRejected(`${table}: application delete`, () =>
        withTenant(pool, a.tenant, (client) =>
          client.query(`delete from ${table} where id = $1`, [aIds[table]]),
        ),
      );
    }

    await expectRejected('care_recipient insert labelled as tenant B', () =>
      withTenant(pool, a.tenant, (client) =>
        client.query('insert into care_recipient (id, tenant_id, full_name) values ($1, $2, $3)', [
          randomUUID(),
          b.tenant,
          'Smuggled recipient',
        ]),
      ),
    );

    const policies = await admin.query<{
      tablename: string;
      has_using: boolean;
      has_check: boolean;
      forced: boolean;
    }>(
      `select c.relname as tablename,
              p.polqual is not null as has_using,
              p.polwithcheck is not null as has_check,
              c.relrowsecurity and c.relforcerowsecurity as forced
         from pg_class c
         join pg_policy p on p.polrelid = c.oid
        where c.relnamespace = 'public'::regnamespace
          and c.relname = any($1)`,
      [[...NORMALIZED_TABLES, ...WAVE4_TABLES]],
    );
    const policyByTable = new Map(policies.rows.map((row) => [row.tablename, row]));
    for (const table of NORMALIZED_TABLES) {
      const policy = policyByTable.get(table);
      if (policy?.has_using && policy.has_check && policy.forced) {
        pass(`${table}: forced RLS policy has USING and WITH CHECK`);
      } else {
        fail(`${table}: incomplete RLS policy ${JSON.stringify(policy)}`);
      }
    }
    for (const table of WAVE4_TABLES) {
      const policy = policyByTable.get(table);
      if (policy?.has_using && policy.has_check && policy.forced) {
        pass(`${table}: forced RLS policy has USING and WITH CHECK`);
      } else {
        fail(`${table}: incomplete RLS policy ${JSON.stringify(policy)}`);
      }
    }

    const protection = await admin.query<{ relname: string; protected: boolean }>(
      `select relname, relrowsecurity and relforcerowsecurity as protected
         from pg_class
        where relkind = 'r' and relname = any($1)`,
      [[...ALL_TENANT_TABLES, 'tenant', 'app_user', 'schema_migrations']],
    );
    const protectionByTable = new Map(protection.rows.map((row) => [row.relname, row.protected]));
    const unprotected = [...ALL_TENANT_TABLES, 'tenant', 'app_user', 'schema_migrations'].filter(
      (table) => protectionByTable.get(table) !== true,
    );
    if (unprotected.length === 0) {
      pass('all tenant-owned and control tables retain enabled, forced RLS');
    } else {
      fail(`tables without enabled, forced RLS: ${unprotected.join(', ')}`);
    }

    const browserGrants = await admin.query<{ object_name: string; grantee: string }>(
      `select table_name as object_name, grantee
         from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('anon', 'authenticated')
       union all
       select routine_name as object_name, grantee
         from information_schema.role_routine_grants
        where specific_schema = 'public'
          and grantee in ('anon', 'authenticated', 'PUBLIC')`,
    );
    if (browserGrants.rowCount === 0) {
      pass('browser-facing roles retain no direct public table or function grants');
    } else {
      fail(`browser-facing grants remain: ${JSON.stringify(browserGrants.rows)}`);
    }

    await expectRejected('family_account cross-tenant primary membership', () =>
      admin.query(
        'update family_account set primary_contact_membership_id = $1 where tenant_id = $2',
        [b.membership, a.tenant],
      ),
    );
    await expectRejected('permission_grant cross-tenant membership', () =>
      admin.query('update permission_grant set membership_id = $1 where tenant_id = $2', [
        b.membership,
        a.tenant,
      ]),
    );
    await expectRejected('employment_case cross-tenant manager membership', () =>
      admin.query('update employment_case set primary_manager_membership_id = $1 where id = $2', [
        b.membership,
        a.employmentCase,
      ]),
    );

    await withTenant(pool, a.tenant, async (client) => {
      try {
        await client.query('create table rls_probe_should_fail (id int)');
        fail('caredesk_app was able to create a table');
      } catch {
        pass('caredesk_app cannot reshape the schema');
      }
    });
  } finally {
    await admin.query('drop table if exists rls_probe_should_fail');
    for (const row of [a, b]) {
      await admin.query('delete from event_action_plan where tenant_id = $1', [row.tenant]);
      await admin.query('delete from document_intake_review where tenant_id = $1', [row.tenant]);
      await admin.query('delete from audit_event where tenant_id = $1', [row.tenant]);
      await admin.query('update document set current_version_id = null where tenant_id = $1', [
        row.tenant,
      ]);
      await admin.query('delete from document_version where tenant_id = $1', [row.tenant]);
      await admin.query('delete from document where tenant_id = $1', [row.tenant]);
      await admin.query('delete from timeline_event where tenant_id = $1', [row.tenant]);
      await admin.query('delete from task where tenant_id = $1', [row.tenant]);
      await admin.query('delete from employment_case where tenant_id = $1', [row.tenant]);
      await admin.query('delete from caregiver where tenant_id = $1', [row.tenant]);
      await admin.query('delete from employer where tenant_id = $1', [row.tenant]);
      await admin.query('delete from care_recipient where tenant_id = $1', [row.tenant]);
      await admin.query('delete from permission_grant where tenant_id = $1', [row.tenant]);
      await admin.query('delete from family_account where tenant_id = $1', [row.tenant]);
      await admin.query('delete from tenant_membership where tenant_id = $1', [row.tenant]);
      await admin.query('delete from app_user where id = $1', [row.user]);
      await admin.query('delete from tenant where id = $1', [row.tenant]);
    }
    await pool.end();
    await admin.end();
  }

  if (failures.length > 0) {
    throw new Error(`RLS check failed: ${failures.length} problem(s).`);
  }
  console.log('\nRLS isolation check passed.');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
