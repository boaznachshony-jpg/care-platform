import type { AuthSession } from './auth-service.js';

/**
 * Resolves an authenticated provider identity to the application's internal
 * user and tenant boundary. The tenant is always derived on the server; API
 * callers cannot select an unrestricted tenant by sending an id themselves.
 */
export interface ResolvedActor {
  userId: string;
  tenantId: string;
}

export interface ActorResolver {
  resolveActor(session: AuthSession): Promise<ResolvedActor | null>;
}
