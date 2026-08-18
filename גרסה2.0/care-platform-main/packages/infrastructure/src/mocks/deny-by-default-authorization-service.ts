import type {
  AuthorizationContext,
  AuthorizationDecision,
  AuthorizationService,
} from '@caredesk/application';

interface Grant {
  userId: string;
  tenantId: string;
  caseId?: string;
  resourceType: string;
  action: string;
}

/**
 * Deny-by-default (Constitution §18): with zero grants seeded, every check
 * fails closed. A grant only ever narrows access — there is no wildcard.
 */
export class DenyByDefaultAuthorizationService implements AuthorizationService {
  private readonly grants: Grant[] = [];

  grant(grant: Grant): void {
    this.grants.push(grant);
  }

  async check(context: AuthorizationContext): Promise<AuthorizationDecision> {
    const matches = this.grants.some(
      (grant) =>
        grant.userId === context.userId &&
        grant.tenantId === context.tenantId &&
        grant.resourceType === context.resourceType &&
        grant.action === context.action &&
        (grant.caseId === undefined || grant.caseId === context.caseId),
    );

    if (!matches) {
      return { allowed: false, reason: 'No matching permission grant.' };
    }
    return { allowed: true, reason: 'Matched an explicit grant.' };
  }
}
