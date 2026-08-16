import type { FastifyInstance } from 'fastify';
import { AuthorizationError } from '@caredesk/application';
import { addContactRequestSchema, createTaskRequestSchema } from '@caredesk/schemas';
import type { Container } from '../container.js';
import { makeAuthenticate } from '../plugins/authenticate.js';
import { sendError, sendValidationError } from './http-errors.js';

interface CaseParams {
  caseId: string;
}

interface TaskParams extends CaseParams {
  taskId: string;
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
 * Case-scoped collections: contacts, tasks, and the timeline. Every route
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

  app.get<{ Params: CaseParams }>('/cases/:caseId/tasks', options, async (request, reply) => {
    const actor = request.actor;
    if (!actor) return;
    try {
      reply.send(await container.listTasks.execute(actor, request.params.caseId));
    } catch (error) {
      if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
      throw error;
    }
  });

  app.post<{ Params: CaseParams }>('/cases/:caseId/tasks', options, async (request, reply) => {
    const actor = request.actor;
    if (!actor) return;

    const parsed = createTaskRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(request, reply, parsed.error);

    try {
      const task = await container.createTask.execute(actor, request.params.caseId, parsed.data);
      reply.status(201).send(task);
    } catch (error) {
      if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
      throw error;
    }
  });

  app.post<{ Params: TaskParams }>(
    '/cases/:caseId/tasks/:taskId/complete',
    options,
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      try {
        const task = await container.completeTask.execute(
          actor,
          request.params.caseId,
          request.params.taskId,
        );
        // null means unknown, other tenant, or already complete — all reported
        // the same way so no caller can probe for another tenant's task ids.
        if (!task) return sendError(request, reply, 404, 'NOT_FOUND');
        reply.send(task);
      } catch (error) {
        if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
        throw error;
      }
    },
  );

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
