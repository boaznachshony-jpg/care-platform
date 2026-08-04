import type {
  AddInvitedFamilyMemberRecord,
  FamilyMemberRecord,
  FamilyMembershipRepository,
} from '@caredesk/application';
import type { FamilyAccessRole } from '@caredesk/domain';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from './pool.js';

interface FamilyMemberRow {
  membership_id: string;
  user_id: string;
  display_name: string;
  email: string;
  role: string;
  identity_status: string;
  invited_at: Date;
  last_authenticated_at: Date | null;
}

function toRecord(row: FamilyMemberRow): FamilyMemberRecord {
  const role = row.role === 'family_member' ? 'viewer' : row.role;
  if (role !== 'owner' && role !== 'manager' && role !== 'viewer') {
    throw new Error(`Unsupported family access role: ${row.role}`);
  }
  return {
    membershipId: row.membership_id,
    userId: row.user_id,
    displayName: row.display_name,
    email: row.email,
    role,
    status: row.identity_status === 'invited' ? 'invited' : 'active',
    invitedAt: row.invited_at.toISOString(),
    lastAuthenticatedAt: row.last_authenticated_at?.toISOString() ?? null,
  };
}

async function listWithClient(client: PoolClient, tenantId: string): Promise<FamilyMemberRecord[]> {
  const result = await client.query<FamilyMemberRow>(
    'select * from list_caredesk_family_members($1)',
    [tenantId],
  );
  return result.rows.map(toRecord);
}

export class PgFamilyMembershipRepository implements FamilyMembershipRepository {
  constructor(private readonly pool: Pool) {}

  async list(tenantId: string): Promise<FamilyMemberRecord[]> {
    return withTenant(this.pool, tenantId, (client) => listWithClient(client, tenantId));
  }

  async findByEmail(tenantId: string, email: string): Promise<FamilyMemberRecord | null> {
    const members = await this.list(tenantId);
    return members.find((member) => member.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  async findById(tenantId: string, membershipId: string): Promise<FamilyMemberRecord | null> {
    const members = await this.list(tenantId);
    return members.find((member) => member.membershipId === membershipId) ?? null;
  }

  async addInvited(input: AddInvitedFamilyMemberRecord): Promise<FamilyMemberRecord> {
    return withTenant(this.pool, input.tenantId, async (client) => {
      const result = await client.query<FamilyMemberRow>(
        'select * from create_caredesk_family_member($1, $2, $3, $4, $5, $6, $7, $8)',
        [
          input.tenantId,
          input.membershipId,
          input.userId,
          input.authSubject,
          input.displayName,
          input.email,
          input.role,
          input.invitedBy,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error('Family invitation was not persisted.');
      return toRecord(row);
    });
  }

  async updateRole(
    tenantId: string,
    membershipId: string,
    role: Exclude<FamilyAccessRole, 'owner'>,
  ): Promise<FamilyMemberRecord | null> {
    return withTenant(this.pool, tenantId, async (client) => {
      const changed = await client.query<{ updated: boolean }>(
        'select update_caredesk_family_member_role($1, $2, $3) as updated',
        [tenantId, membershipId, role],
      );
      if (!changed.rows[0]?.updated) return null;
      const members = await listWithClient(client, tenantId);
      return members.find((member) => member.membershipId === membershipId) ?? null;
    });
  }

  async revoke(tenantId: string, membershipId: string): Promise<boolean> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<{ revoked: boolean }>(
        'select revoke_caredesk_family_member($1, $2) as revoked',
        [tenantId, membershipId],
      );
      return result.rows[0]?.revoked ?? false;
    });
  }
}
