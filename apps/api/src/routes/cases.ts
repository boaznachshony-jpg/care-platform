import type { FastifyInstance } from 'fastify';
import { AuthorizationError, type EmploymentCaseGraph } from '@caredesk/application';
import {
  openEmploymentCaseRequestSchema,
  type ApiError,
  type EmploymentCaseResponse,
} from '@caredesk/schemas';
import type { Container } from '../container.js';
import { makeAuthenticate } from '../plugins/authenticate.js';

function toResponse(graph: EmploymentCaseGraph): EmploymentCaseResponse {
  return {
    id: graph.employmentCase.id,
    status: graph.employmentCase.status,
    startDate: graph.employmentCase.startDate,
    endDate: graph.employmentCase.endDate,
    careRecipient: {
      id: graph.careRecipient.id,
      fullName: graph.careRecipient.fullName,
      careLevel: graph.careRecipient.careLevel,
      city: graph.careRecipient.city,
    },
    employer: {
      id: graph.employer.id,
      fullName: graph.employer.fullName,
      relationshipToRecipient: graph.employer.relationshipToRecipient,
      city: graph.employer.city,
    },
    caregiver: {
      id: graph.caregiver.id,
      legalName: graph.caregiver.legalName,
      preferredName: graph.caregiver.preferredName,
      nationality: graph.caregiver.nationality,
      primaryLanguage: graph.caregiver.primaryLanguage,
    },
  };
}

export function registerCaseRoutes(app: FastifyInstance, container: Container): void {
  const authenticate = makeAuthenticate(container.auth, container.actorResolver);

  app.post('/cases', { preHandler: authenticate }, async (request, reply) => {
    const actor = request.actor;
    if (!actor) return; // authenticate already replied

    const parsed = openEmploymentCaseRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.') || '(root)';
        (fieldErrors[path] ??= []).push(issue.message);
      }
      const body: ApiError = {
        code: 'VALIDATION_ERROR',
        message: 'Unable to complete the request',
        fieldErrors,
        correlationId: request.correlationId,
      };
      reply.status(400).send(body);
      return;
    }

    try {
      const created = await container.openCase.execute(actor, parsed.data);
      const graph = await container.getCase.execute(actor, created.id);
      reply.status(201).send(graph ? toResponse(graph) : { id: created.id });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        const body: ApiError = {
          code: 'FORBIDDEN',
          message: 'Unable to complete the request',
          correlationId: request.correlationId,
        };
        reply.status(403).send(body);
        return;
      }
      throw error;
    }
  });

  app.get('/cases', { preHandler: authenticate }, async (request, reply) => {
    const actor = request.actor;
    if (!actor) return;

    try {
      const graphs = await container.listCases.execute(actor);
      reply.send(graphs.map(toResponse));
    } catch (error) {
      if (error instanceof AuthorizationError) {
        const body: ApiError = {
          code: 'FORBIDDEN',
          message: 'Unable to complete the request',
          correlationId: request.correlationId,
        };
        reply.status(403).send(body);
        return;
      }
      throw error;
    }
  });

  app.get<{ Params: { caseId: string } }>(
    '/cases/:caseId',
    { preHandler: authenticate },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;

      try {
        const graph = await container.getCase.execute(actor, request.params.caseId);
        if (!graph) {
          const body: ApiError = {
            code: 'NOT_FOUND',
            message: 'Unable to complete the request',
            correlationId: request.correlationId,
          };
          reply.status(404).send(body);
          return;
        }
        reply.send(toResponse(graph));
      } catch (error) {
        if (error instanceof AuthorizationError) {
          const body: ApiError = {
            code: 'FORBIDDEN',
            message: 'Unable to complete the request',
            correlationId: request.correlationId,
          };
          reply.status(403).send(body);
          return;
        }
        throw error;
      }
    },
  );
}
