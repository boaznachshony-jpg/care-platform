import type { FastifyInstance } from 'fastify';
import { legalAcceptanceRequestSchema, type LegalAcceptanceResponse } from '@caredesk/schemas';
import type { Container } from '../container.js';
import { makeAuthenticate } from '../plugins/authenticate.js';
import { sendValidationError } from './http-errors.js';

/**
 * Recording that a named user accepted a named document at a named version.
 *
 * These are the two endpoints behind `terms_acceptance` (migration 0043). They
 * are deliberately small: an acceptance is a fact, not a resource with a
 * lifecycle. There is no PUT and no DELETE here, and there is no UPDATE or
 * DELETE grant on the table underneath them, because a record that can be
 * rewritten proves nothing about what somebody agreed to.
 *
 * WHY NO MFA GATE
 * ---------------
 * `/billing/payment-method/setup` is behind `requireMfa` because it moves
 * money. Recording an acceptance does not: it is append-only, tenant-scoped,
 * and the worst a replay can do is nothing at all (`on conflict do nothing`).
 * Putting an MFA challenge in front of it would put a challenge between the
 * consent checkbox and the acceptance record, which is precisely where a
 * failure loses the evidence the endpoint exists to capture.
 *
 * WHY THE ACTOR IS NOT IN THE BODY
 * --------------------------------
 * `tenantId` and `userId` come from the authenticated actor and are never read
 * from the request. An acceptance record that the client can address to
 * somebody else is not evidence about anybody.
 */
export function registerLegalAcceptanceRoutes(app: FastifyInstance, container: Container): void {
  const authenticate = makeAuthenticate(container.auth, container.actorResolver);
  const options = { preHandler: authenticate };

  app.post('/legal/acceptances', options, async (request, reply) => {
    const actor = request.actor;
    if (!actor) return;
    const parsed = legalAcceptanceRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(request, reply, parsed.error);

    const acceptances = await container.termsAcceptances.record(actor.tenantId, {
      userId: actor.userId,
      documents: parsed.data.documents,
      context: parsed.data.context,
      correlationId: request.correlationId,
    });
    const response: LegalAcceptanceResponse = { acceptances };
    // 201 on a first acceptance and on a replay alike. The client's question is
    // "is this on record", and after either outcome the answer is yes.
    return reply.status(201).send(response);
  });

  app.get('/legal/acceptances', options, async (request, reply) => {
    const actor = request.actor;
    if (!actor) return;
    const response: LegalAcceptanceResponse = {
      acceptances: await container.termsAcceptances.list(actor.tenantId, actor.userId),
    };
    return reply.send(response);
  });
}
