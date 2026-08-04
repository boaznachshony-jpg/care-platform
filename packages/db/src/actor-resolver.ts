import type { ActorResolver, AuthSession, ResolvedActor } from '@caredesk/application';
import type { Pool } from 'pg';

interface ActorRow {
  user_id: string;
  tenant_id: string;
}

/**
 * Resolves an exact auth-provider subject through the narrowly-scoped
 * `resolve_caredesk_actor` database function. More than one active tenant is
 * rejected until an explicit, server-validated tenant switcher is introduced.
 */
export class PgActorResolver implements ActorResolver {
  constructor(private readonly pool: Pool) {}

  async resolveActor(session: AuthSession): Promise<ResolvedActor | null> {
    const result = await this.pool.query<ActorRow>(
      'select user_id, tenant_id from resolve_caredesk_actor($1)',
      [session.authSubject],
    );
    if (result.rows.length !== 1) return null;
    const actor = result.rows[0];
    if (!actor) return null;
    return { userId: actor.user_id, tenantId: actor.tenant_id };
  }
}
