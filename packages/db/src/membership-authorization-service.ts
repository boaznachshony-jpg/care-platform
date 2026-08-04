import type {
  AuthorizationContext,
  AuthorizationDecision,
  AuthorizationService,
} from '@caredesk/application';
import type { Pool } from 'pg';
import { withTenant } from './pool.js';

interface MembershipRow {
  role: string;
  mfa_required: boolean;
}

/** Database-backed, deny-by-default tenant membership authorization. */
export class PgMembershipAuthorizationService implements AuthorizationService {
  constructor(
    private readonly pool: Pool,
    private readonly rolePermissions: Readonly<Record<string, readonly string[]>>,
  ) {}

  async check(context: AuthorizationContext): Promise<AuthorizationDecision> {
    const membership = await withTenant(this.pool, context.tenantId, async (client) => {
      const result = await client.query<MembershipRow>(
        `select role, mfa_required
           from tenant_membership
          where tenant_id = $1
            and user_id = $2
            and status = 'active'
            and valid_from <= now()
            and (valid_to is null or valid_to > now())
          limit 1`,
        [context.tenantId, context.userId],
      );
      return result.rows[0] ?? null;
    });

    if (!membership) {
      return { allowed: false, reason: 'No active membership in this tenant.' };
    }

    if (membership.mfa_required && !context.mfaSatisfied) {
      return { allowed: false, reason: 'Multi-factor authentication is required.' };
    }

    const permission = `${context.resourceType}:${context.action}`;
    const permitted = this.rolePermissions[membership.role]?.includes(permission) ?? false;
    if (!permitted) {
      return { allowed: false, reason: `Role "${membership.role}" lacks "${permission}".` };
    }

    return { allowed: true, reason: `Granted via role "${membership.role}".` };
  }
}
