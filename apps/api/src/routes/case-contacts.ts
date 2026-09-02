import type { FastifyInstance } from 'fastify';
import { AuthorizationError } from '@caredesk/application';
import { addContactRequestSchema } from '@caredesk/schemas';
import type { Container } from '../container.js';
import { makeAuthenticate } from '../plugins/authenticate.js';
import { sendError, sendValidationError } from './http-errors.js';

interface CaseParams {
  caseId: string;
}

function timelineActionTarget(
  eventTypeKey: string,
): '/documents' | '/tasks' | '/payroll' | undefined {
  if (eventTypeKey.includes('document') || eventTypeKey.includes('insurance')) return '/documents';
  if (eventTypeKey.includes('payroll')) return '/payroll';
  if (eventTypeKey.includes('task') || eventTypeKey.includes('renewal')) return '/tasks';
  return undefined;
}

/**
 * Case-scoped collections: contacts and the timeline. Every route
 * authenticates, then the use case performs the deny-by-default authorization
 * check — the route never decides access on its own.
 */
export function registerCaseSubResourceRoutes(app: FastifyInstance, container: Container): void {
  const authenticate = makeAuthenticate(container.auth, container.actorResolver);
  const options = { preHandler: authenticate };

  app.get<{ Params: CaseParams }>('/cases/:caseId/contacts', options, async (request, reply) => {
    const actor = request.actor;
    if (!actor) return;
    try {
      reply.send(await container.listContacts.execute(actor, request.params.caseId));
    } catch (error) {
      if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
      throw error;
    }
  });

  app.post<{ Params: CaseParams }>('/cases/:caseId/contacts', options, async (request, reply) => {
    const actor = request.actor;
    if (!actor) return;

    const parsed = addContactRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(request, reply, parsed.error);

    try {
      const result = await container.addContact.execute(actor, request.params.caseId, parsed.data);
      reply.status(201).send(result);
    } catch (error) {
      if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
      throw error;
    }
  });

  /*
   * The task routes used to live here, in the contacts file, and were the only
   * ones that existed. `case-tasks.ts` now owns the whole resource — list,
   * create, update, complete, archive and the cutover import — so keeping a
   * second copy here registered `GET /cases/:caseId/tasks` twice and Fastify
   * refused to start the server at all. One resource, one file.
   */

  app.get<{ Params: CaseParams }>('/cases/:caseId/timeline', options, async (request, reply) => {
    const actor = request.actor;
    if (!actor) return;
    try {
      const events = await container.listTimeline.execute(actor, request.params.caseId);
      reply.send(
        events.map((event) => ({
          ...event,
          actionTarget: timelineActionTarget(event.eventTypeKey),
        })),
      );
    } catch (error) {
      if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
      throw error;
    }
  });
}
