import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiError } from '@caredesk/schemas';

/**
 * Placeholder authorization preHandler (Constitution §18: deny-by-default,
 * server-side). Milestone 0 has no real AuthService/AuthorizationService
 * wiring yet, so every protected route fails closed rather than silently
 * allowing access — the only two routes with no MFA/permission check
 * whatsoever are the health/readiness endpoints below.
 */
export async function denyByDefault(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body: ApiError = {
    code: 'AUTHORIZATION_NOT_CONFIGURED',
    message: 'Unable to complete the request',
    correlationId: request.correlationId,
  };
  reply.status(403).send(body);
}
