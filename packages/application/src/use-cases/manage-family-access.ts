import type { FamilyAccessRole } from '@caredesk/domain';
import type { AuditService } from '../ports/audit-service.js';
import type { AuthorizationService } from '../ports/authorization-service.js';
import type { Clock } from '../ports/clock.js';
import type {
  FamilyMemberRecord,
  FamilyMembershipRepository,
} from '../ports/family-membership-repository.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { IdentityInvitationService } from '../ports/identity-invitation-service.js';
import type { Actor } from './actor.js';
import { authorizeOrThrow } from './authorize.js';

interface FamilyAccessDeps {
  authorization: AuthorizationService;
  memberships: FamilyMembershipRepository;
  invitations: IdentityInvitationService;
  audit: AuditService;
  clock: Clock;
  ids: IdGenerator;
}

export interface InviteFamilyMemberInput {
  displayName: string;
  email: string;
  role: Exclude<FamilyAccessRole, 'owner'>;
}

export class FamilyMemberConflictError extends Error {
  readonly code = 'FAMILY_MEMBER_EXISTS';
}

export class FamilyMemberNotFoundError extends Error {
  readonly code = 'FAMILY_MEMBER_NOT_FOUND';
}

export class FamilyMemberInvariantError extends Error {
  readonly code = 'FAMILY_MEMBER_INVARIANT';
}

export interface FamilyAccessResult {
  members: Array<FamilyMemberRecord & { isCurrentUser: boolean }>;
  canManage: boolean;
}

export class ListFamilyMembers {
  constructor(private readonly deps: FamilyAccessDeps) {}

  async execute(actor: Actor): Promise<FamilyAccessResult> {
    await authorizeOrThrow(this.deps, actor, { resourceType: 'membership', action: 'read' });
    const manageDecision = await this.deps.authorization.check({
      userId: actor.userId,
      tenantId: actor.tenantId,
      mfaSatisfied: actor.mfaSatisfied,
      resourceType: 'membership',
      action: 'manage',
    });
    const members = await this.deps.memberships.list(actor.tenantId);
    return {
      canManage: manageDecision.allowed,
      members: members.map((member) => ({
        ...member,
        isCurrentUser: member.userId === actor.userId,
      })),
    };
  }
}

export class InviteFamilyMember {
  constructor(private readonly deps: FamilyAccessDeps) {}

  async execute(actor: Actor, input: InviteFamilyMemberInput): Promise<FamilyMemberRecord> {
    await authorizeOrThrow(this.deps, actor, { resourceType: 'membership', action: 'manage' });
    const existing = await this.deps.memberships.findByEmail(actor.tenantId, input.email);
    if (existing) throw new FamilyMemberConflictError('This email already has access.');

    const identity = await this.deps.invitations.invite(input.email);
    const now = this.deps.clock.now();
    const member = await this.deps.memberships.addInvited({
      tenantId: actor.tenantId,
      membershipId: this.deps.ids.next(),
      userId: this.deps.ids.next(),
      authSubject: identity.authSubject,
      displayName: input.displayName,
      email: input.email,
      role: input.role,
      invitedBy: actor.userId,
    });

    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'family.member.invited',
      resourceType: 'membership',
      resourceId: member.membershipId,
      correlationId: actor.correlationId,
      occurredAt: now.toISOString(),
      changeSummary: `Family access invitation created with role ${input.role}.`,
      sensitivity: 'general',
    });
    return member;
  }
}

export class UpdateFamilyMemberRole {
  constructor(private readonly deps: FamilyAccessDeps) {}

  async execute(
    actor: Actor,
    membershipId: string,
    role: Exclude<FamilyAccessRole, 'owner'>,
  ): Promise<FamilyMemberRecord> {
    await authorizeOrThrow(this.deps, actor, {
      resourceType: 'membership',
      action: 'manage',
      resourceId: membershipId,
    });
    const target = await this.deps.memberships.findById(actor.tenantId, membershipId);
    if (!target) throw new FamilyMemberNotFoundError('Family member was not found.');
    if (target.userId === actor.userId || target.role === 'owner') {
      throw new FamilyMemberInvariantError('The owner cannot change this role here.');
    }
    const updated = await this.deps.memberships.updateRole(actor.tenantId, membershipId, role);
    if (!updated) throw new FamilyMemberNotFoundError('Family member was not found.');

    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'family.member.role_changed',
      resourceType: 'membership',
      resourceId: membershipId,
      correlationId: actor.correlationId,
      occurredAt: this.deps.clock.now().toISOString(),
      changeSummary: `Family access role changed to ${role}.`,
      sensitivity: 'general',
    });
    return updated;
  }
}

export class RevokeFamilyMember {
  constructor(private readonly deps: FamilyAccessDeps) {}

  async execute(actor: Actor, membershipId: string): Promise<void> {
    await authorizeOrThrow(this.deps, actor, {
      resourceType: 'membership',
      action: 'manage',
      resourceId: membershipId,
    });
    const target = await this.deps.memberships.findById(actor.tenantId, membershipId);
    if (!target) throw new FamilyMemberNotFoundError('Family member was not found.');
    if (target.userId === actor.userId || target.role === 'owner') {
      throw new FamilyMemberInvariantError('The owner cannot be removed here.');
    }
    const revoked = await this.deps.memberships.revoke(actor.tenantId, membershipId);
    if (!revoked) throw new FamilyMemberNotFoundError('Family member was not found.');

    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'family.member.revoked',
      resourceType: 'membership',
      resourceId: membershipId,
      correlationId: actor.correlationId,
      occurredAt: this.deps.clock.now().toISOString(),
      changeSummary: 'Family access was revoked.',
      sensitivity: 'general',
    });
  }
}
