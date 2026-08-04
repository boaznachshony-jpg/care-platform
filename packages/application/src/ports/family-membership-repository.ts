import type { FamilyAccessRole } from '@caredesk/domain';

export interface FamilyMemberRecord {
  membershipId: string;
  userId: string;
  displayName: string;
  email: string;
  role: FamilyAccessRole;
  status: 'invited' | 'active';
  invitedAt: string;
  lastAuthenticatedAt: string | null;
}

export interface AddInvitedFamilyMemberRecord {
  tenantId: string;
  membershipId: string;
  userId: string;
  authSubject: string;
  displayName: string;
  email: string;
  role: Exclude<FamilyAccessRole, 'owner'>;
  invitedBy: string;
}

export interface FamilyMembershipRepository {
  list(tenantId: string): Promise<FamilyMemberRecord[]>;
  findByEmail(tenantId: string, email: string): Promise<FamilyMemberRecord | null>;
  findById(tenantId: string, membershipId: string): Promise<FamilyMemberRecord | null>;
  addInvited(input: AddInvitedFamilyMemberRecord): Promise<FamilyMemberRecord>;
  updateRole(
    tenantId: string,
    membershipId: string,
    role: Exclude<FamilyAccessRole, 'owner'>,
  ): Promise<FamilyMemberRecord | null>;
  revoke(tenantId: string, membershipId: string): Promise<boolean>;
}
