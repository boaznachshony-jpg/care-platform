import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { Pool, PoolClient } from 'pg';
import { createPool } from './pool.js';

export interface PilotAccountInput {
  authSubject: string;
  email: string;
  displayName: string;
  accountName: string;
  dataRegion: string;
  tenantId?: string;
  mfaRequired: boolean;
}

export interface ProvisionedPilotAccount {
  userId: string;
  tenantId: string;
  membershipId: string;
}

interface UserRow {
  id: string;
  auth_subject: string;
  email: string;
}

interface MembershipRow {
  id: string;
  tenant_id: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireText(name: string, value: string | undefined, maxLength = 200): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) throw new Error(`${name} is required.`);
  if (normalized.length > maxLength) throw new Error(`${name} is too long.`);
  return normalized;
}

function readInputFromEnvironment(): PilotAccountInput {
  const authSubject = requireText('PILOT_AUTH_SUBJECT', process.env.PILOT_AUTH_SUBJECT);
  if (!UUID_PATTERN.test(authSubject)) {
    throw new Error('PILOT_AUTH_SUBJECT must be the UUID of an existing Supabase Auth user.');
  }
  const email = requireText('PILOT_EMAIL', process.env.PILOT_EMAIL).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('PILOT_EMAIL is not a valid email address.');
  const tenantId = process.env.PILOT_TENANT_ID?.trim() || undefined;
  if (tenantId && !UUID_PATTERN.test(tenantId)) {
    throw new Error('PILOT_TENANT_ID must be a UUID when supplied.');
  }
  const mfa = (process.env.PILOT_MFA_REQUIRED ?? 'false').trim().toLowerCase();
  if (!['true', 'false'].includes(mfa)) {
    throw new Error('PILOT_MFA_REQUIRED must be true or false.');
  }

  return {
    authSubject,
    email,
    displayName: requireText('PILOT_DISPLAY_NAME', process.env.PILOT_DISPLAY_NAME),
    accountName: requireText('PILOT_ACCOUNT_NAME', process.env.PILOT_ACCOUNT_NAME),
    dataRegion: requireText('PILOT_DATA_REGION', process.env.PILOT_DATA_REGION, 80),
    tenantId,
    mfaRequired: mfa === 'true',
  };
}

async function findUser(client: PoolClient, input: PilotAccountInput): Promise<UserRow | null> {
  const result = await client.query<UserRow>(
    `select id, auth_subject, email
       from app_user
      where auth_subject = $1 or lower(email) = lower($2)
      order by auth_subject = $1 desc`,
    [input.authSubject, input.email],
  );
  if (result.rows.length > 1 && result.rows[0]?.id !== result.rows[1]?.id) {
    throw new Error('The auth subject and email already belong to different application users.');
  }
  const row = result.rows[0] ?? null;
  if (row && row.auth_subject !== input.authSubject) {
    throw new Error('PILOT_EMAIL already belongs to a different Supabase Auth identity.');
  }
  return row;
}

export async function provisionPilotAccount(
  pool: Pool,
  input: PilotAccountInput,
): Promise<ProvisionedPilotAccount> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const existingUser = await findUser(client, input);
    const userId = existingUser?.id ?? randomUUID();
    await client.query(
      `insert into app_user
         (id, auth_subject, display_name, email, preferred_locale, status)
       values ($1, $2, $3, $4, 'he', 'active')
       on conflict (id) do update
         set display_name = excluded.display_name,
             email = excluded.email,
             status = 'active',
             updated_at = now(),
             version = app_user.version + 1`,
      [userId, input.authSubject, input.displayName, input.email],
    );

    const memberships = await client.query<MembershipRow>(
      `select id, tenant_id
         from tenant_membership
        where user_id = $1 and status = 'active'
          and valid_from <= now() and (valid_to is null or valid_to > now())
        order by valid_from desc
        limit 2`,
      [userId],
    );
    if (memberships.rows.length > 1) {
      throw new Error(
        'This user has more than one active tenant membership; manual review is required.',
      );
    }
    const existingMembership = memberships.rows[0];
    if (existingMembership && input.tenantId && existingMembership.tenant_id !== input.tenantId) {
      throw new Error("PILOT_TENANT_ID does not match the user's existing active membership.");
    }

    const tenantId = existingMembership?.tenant_id ?? input.tenantId ?? randomUUID();
    await client.query(
      `insert into tenant (id, status, timezone, default_locale, data_region)
       values ($1, 'active', 'Asia/Jerusalem', 'he', $2)
       on conflict (id) do nothing`,
      [tenantId, input.dataRegion],
    );
    const tenantRegion = await client.query<{ data_region: string }>(
      'select data_region from tenant where id = $1',
      [tenantId],
    );
    if (tenantRegion.rows[0]?.data_region !== input.dataRegion) {
      throw new Error('PILOT_DATA_REGION does not match the existing tenant data region.');
    }
    await client.query(
      `insert into family_account (tenant_id, display_name, lifecycle_status)
       values ($1, $2, 'active')
       on conflict (tenant_id) do update
         set display_name = excluded.display_name,
             lifecycle_status = 'active',
             updated_at = now(),
             version = family_account.version + 1`,
      [tenantId, input.accountName],
    );

    const membershipId = existingMembership?.id ?? randomUUID();
    if (existingMembership) {
      await client.query(
        `update tenant_membership
            set role = 'owner', mfa_required = $2, updated_at = now(), version = version + 1
          where id = $1`,
        [membershipId, input.mfaRequired],
      );
    } else {
      await client.query(
        `insert into tenant_membership
           (id, tenant_id, user_id, role, status, mfa_required)
         values ($1, $2, $3, 'owner', 'active', $4)`,
        [membershipId, tenantId, userId, input.mfaRequired],
      );
    }
    await client.query(
      `update family_account set primary_contact_membership_id = $2 where tenant_id = $1`,
      [tenantId, membershipId],
    );

    await client.query('commit');
    return { userId, tenantId, membershipId };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_ADMIN_URL;
  if (!connectionString) {
    throw new Error('DATABASE_ADMIN_URL is required in .env.local.');
  }
  const input = readInputFromEnvironment();
  const pool = createPool(connectionString);
  try {
    const result = await provisionPilotAccount(pool, input);
    console.log('Pilot account provisioned without storing credentials in CareDesk.');
    console.log(`Tenant: ${result.tenantId}`);
    console.log(`Application user: ${result.userId}`);
    console.log(`Membership: ${result.membershipId}`);
    console.log(`MFA policy: ${input.mfaRequired ? 'required' : 'not required'}`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
