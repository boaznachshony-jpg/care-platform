import type {
  AuthorizationContext,
  AuthorizationDecision,
  AuthorizationService,
} from '@caredesk/application';

export interface SeededMembership {
  userId: string;
  tenantId: string;
  role: string;
  status: 'active' | 'revoked';
}

/**
 * Milestone 1 authorization: user → active tenant membership → role →
 * permission. Deny-by-default; the role→permission map is injected, never
 * implicit. Case-level and sensitivity-level narrowing (PermissionGrant)
 * compose on top of this in later milestones — a role here grants at most
 * tenant-wide access, never cross-tenant.
 */
export class MembershipAuthorizationService implements AuthorizationService {
  private readonly memberships: SeededMembership[] = [];

  constructor(private readonly rolePermissions: Readonly<Record<string, readonly string[]>>) {}

  seedMembership(membership: SeededMembership): void {
    this.memberships.push(membership);
  }

  async check(context: AuthorizationContext): Promise<AuthorizationDecision> {
    const membership = this.memberships.find(
      (candidate) =>
        candidate.userId === context.userId &&
        candidate.tenantId === context.tenantId &&
        candidate.status === 'active',
    );
    if (!membership) {
      return { allowed: false, reason: 'No active membership in this tenant.' };
    }

    const permission = `${context.resourceType}:${context.action}`;
    const permitted = this.rolePermissions[membership.role]?.includes(permission) ?? false;
    if (!permitted) {
      return { allowed: false, reason: `Role "${membership.role}" lacks "${permission}".` };
    }

    return { allowed: true, reason: `Granted via role "${membership.role}".` };
  }
}
