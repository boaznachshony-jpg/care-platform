import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { AuthService } from '@caredesk/application';
import type { ApiError } from '@caredesk/schemas';

declare module 'fastify' {
  interface FastifyRequest {
    actor?: { userId: string; tenantId: string; correlationId: string };
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
  tenantByUser: ReadonlyMap<string, string>,
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

    const tenantId = tenantByUser.get(session.userId);
    if (!tenantId) {
      unauthorized(request, reply);
      return;
    }

    request.actor = {
      userId: session.userId,
      tenantId,
      correlationId: request.correlationId,
    };
  };
}
