/**
 * Who is acting, in which tenant, under which request.
 *
 * `tenantId` is resolved from the authenticated user's membership by the API
 * layer and never taken from client input — a caller cannot name the tenant it
 * wants to act in (database-blueprint.md §3).
 */
export interface Actor {
  userId: string;
  tenantId: string;
  correlationId: string;
  /** Comes from the verified session, never from a request body or header. */
  mfaSatisfied?: boolean;
}

export class AuthorizationError extends Error {
  readonly code = 'FORBIDDEN';
}
