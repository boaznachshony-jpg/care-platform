import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { ActorResolver, AuthService } from '@caredesk/application';
import type { ApiError } from '@caredesk/schemas';

declare module 'fastify' {
  interface FastifyRequest {
    actor?: { userId: string; tenantId: string; correlationId: string; mfaSatisfied: boolean };
  }
}

function unauthorized(request: FastifyRequest, reply: FastifyReply): void {
  const body: ApiError = {
    code: 'UNAUTHENTICATED',
    message: 'Unable to complete the request',
    correlationId: request.correlationId,
  };
  reply.status(401).send(body);
}

/**
 * Bearer-token authentication → actor resolution. Identity comes from
 * AuthService (mock now, Supabase later per ADR-001); the tenant comes from
 * the user's membership, never from a client-supplied header/body field
 * (blueprint §3: "API input never supplies an unrestricted tenant id").
 */
export function makeAuthenticate(
  auth: AuthService,
  actorResolver: ActorResolver,
): preHandlerHookHandler {
  return async (request, reply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      unauthorized(request, reply);
      return;
    }

    const session = await auth.verifySession(header.slice('Bearer '.length));
    if (!session) {
      unauthorized(request, reply);
      return;
    }

    const actor = await actorResolver.resolveActor(session);
    if (!actor) {
      unauthorized(request, reply);
      return;
    }

    request.actor = {
      ...actor,
      correlationId: request.correlationId,
      mfaSatisfied: session.mfaSatisfied,
    };
  };
}
