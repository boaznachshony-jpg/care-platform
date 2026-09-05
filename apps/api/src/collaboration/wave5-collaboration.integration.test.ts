import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DocumentStorage } from '@caredesk/application';
import { createPool } from '@caredesk/db';
import { Wave5Service } from './wave5-service.js';

/**
 * SEC-DB-01, end to end against a real PostgreSQL with the migrations applied.
 *
 * The unit test next door proves the SQL no longer names `app_user`; this one
 * proves the two statements it names actually return a member when run as the
 * application role under RLS - which is the thing that broke in production and
 * which no in-memory double can reproduce. It needs the same database the
 * rls-check uses (DATABASE_URL as `caredesk_app`, DATABASE_ADMIN_URL as the
 * owner, RLS_TEST_MODE set) and is skipped anywhere those are absent.
 */
const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const hasDatabase = Boolean(appUrl && adminUrl && process.env.RLS_TEST_MODE);

const storage: DocumentStorage = {
  putObject: async () => {
    throw new Error('not used');
  },
  getSignedUrl: async () => {
    throw new Error('not used');
  },
  deleteObject: async () => {
    throw new Error('not used');
  },
};

describe.skipIf(!hasDatabase)('Wave5Service.collaboration against PostgreSQL', () => {
  const ciRoleSwitch = process.env.RLS_TEST_MODE === 'ci-role-switch';
  const admin = hasDatabase ? createPool(adminUrl!, !ciRoleSwitch) : undefined;
  const pool = hasDatabase ? createPool(appUrl!, !ciRoleSwitch) : undefined;
  const tenant = randomUUID();
  const user = randomUUID();
  const membership = randomUUID();

  beforeAll(async () => {
    if (!admin) return;
    await admin.query('insert into tenant (id, data_region) values ($1, $2)', [
      tenant,
      'synthetic',
    ]);
    await admin.query(
      'insert into app_user (id, auth_subject, display_name, email) values ($1, $2, $3, $4)',
      [user, `collab-${user}`, 'Synthetic Collaboration Owner', `${user}@example.invalid`],
    );
    await admin.query(
      `insert into tenant_membership (id, tenant_id, user_id, role) values ($1, $2, $3, 'owner')`,
      [membership, tenant, user],
    );
  });

  afterAll(async () => {
    if (admin) {
      await admin.query('delete from tenant_membership where tenant_id = $1', [tenant]);
      await admin.query('delete from app_user where id = $1', [user]);
      await admin.query('delete from tenant where id = $1', [tenant]);
      await admin.end();
    }
    await pool?.end();
  });

  it('returns the seeded membership with its resolved display name', async () => {
    const service = new Wave5Service(pool!, storage);
    const result = await service.collaboration({ tenantId: tenant, userId: user }, randomUUID());
    expect(result.members).toHaveLength(1);
    expect(result.members[0]).toMatchObject({
      id: membership,
      role: 'owner',
      status: 'active',
      display_name: 'Synthetic Collaboration Owner',
    });
  });
});
