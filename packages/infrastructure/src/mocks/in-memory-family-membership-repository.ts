import type {
  AddInvitedFamilyMemberRecord,
  FamilyMemberRecord,
  FamilyMembershipRepository,
} from '@caredesk/application';
import type { FamilyAccessRole } from '@caredesk/domain';

interface StoredFamilyMember extends FamilyMemberRecord {
  tenantId: string;
}

/** Synthetic/test-only family access store. */
export class InMemoryFamilyMembershipRepository implements FamilyMembershipRepository {
  private readonly members: StoredFamilyMember[] = [];

  seed(member: StoredFamilyMember): void {
    this.members.push({ ...member });
  }

  async list(tenantId: string): Promise<FamilyMemberRecord[]> {
    return this.members
      .filter((member) => member.tenantId === tenantId)
      .map(({ tenantId: _tenantId, ...member }) => ({ ...member }));
  }

  async findByEmail(tenantId: string, email: string): Promise<FamilyMemberRecord | null> {
    const found = this.members.find(
      (member) =>
        member.tenantId === tenantId && member.email.toLowerCase() === email.toLowerCase(),
    );
    if (!found) return null;
    const { tenantId: _tenantId, ...member } = found;
    return { ...member };
  }

  async findById(tenantId: string, membershipId: string): Promise<FamilyMemberRecord | null> {
    const found = this.members.find(
      (member) => member.tenantId === tenantId && member.membershipId === membershipId,
    );
    if (!found) return null;
    const { tenantId: _tenantId, ...member } = found;
    return { ...member };
  }

  async addInvited(input: AddInvitedFamilyMemberRecord): Promise<FamilyMemberRecord> {
    const member: StoredFamilyMember = {
      tenantId: input.tenantId,
      membershipId: input.membershipId,
      userId: input.userId,
      displayName: input.displayName,
      email: input.email,
      role: input.role,
      status: 'invited',
      invitedAt: new Date().toISOString(),
      lastAuthenticatedAt: null,
    };
    this.members.push(member);
    const { tenantId: _tenantId, ...record } = member;
    return { ...record };
  }

  async updateRole(
    tenantId: string,
    membershipId: string,
    role: Exclude<FamilyAccessRole, 'owner'>,
  ): Promise<FamilyMemberRecord | null> {
    const found = this.members.find(
      (member) => member.tenantId === tenantId && member.membershipId === membershipId,
    );
    if (!found) return null;
    found.role = role;
    const { tenantId: _tenantId, ...record } = found;
    return { ...record };
  }

  async revoke(tenantId: string, membershipId: string): Promise<boolean> {
    const index = this.members.findIndex(
      (member) => member.tenantId === tenantId && member.membershipId === membershipId,
    );
    if (index < 0) return false;
    this.members.splice(index, 1);
    return true;
  }
}
