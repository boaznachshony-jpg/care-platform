import type { FastifyInstance } from 'fastify';
import { AuthorizationError, type EmploymentCaseGraph } from '@caredesk/application';
import {
  openEmploymentCaseRequestSchema,
  updateCaregiverRequestSchema,
  type ApiError,
  type CaregiverResponse,
  type EmploymentCaseResponse,
} from '@caredesk/schemas';
import type { Container } from '../container.js';
import { makeAuthenticate } from '../plugins/authenticate.js';
import { sendError, sendValidationError } from './http-errors.js';

function toResponse(graph: EmploymentCaseGraph): EmploymentCaseResponse {
  return {
    id: graph.employmentCase.id,
    status: graph.employmentCase.status,
    startDate: graph.employmentCase.startDate,
    endDate: graph.employmentCase.endDate,
    legacyClientId: graph.employmentCase.legacyClientId,
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

  /**
   * The caregiver identity fields already had a canonical table (`caregiver`,
   * migration 0003) but no way to edit them after intake — see
   * UpdateCaregiverProfileUseCase for why the passport number field is
   * deliberately absent from this contract.
   */
  app.patch<{ Params: { caseId: string } }>(
    '/cases/:caseId/caregiver',
    { preHandler: authenticate },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      const body = updateCaregiverRequestSchema.safeParse(request.body);
      if (!body.success) return sendValidationError(request, reply, body.error);
      try {
        // The route takes no caregiverId in the URL — the case/caregiver
        // relationship is 1:1 today (employment_case_active_pair_unique), so
        // resolving it from the case graph avoids exposing a second id the
        // web client would otherwise have to track for no reason.
        const graph = await container.getCase.execute(actor, request.params.caseId);
        if (!graph) return sendError(request, reply, 404, 'NOT_FOUND');
        const updated = await container.updateCaregiver.execute(
          actor,
          request.params.caseId,
          graph.caregiver.id,
          body.data,
        );
        if (!updated) return sendError(request, reply, 404, 'NOT_FOUND');
        const response: CaregiverResponse = {
          id: updated.id,
          legalName: updated.legalName,
          preferredName: updated.preferredName,
          nationality: updated.nationality,
          primaryLanguage: updated.primaryLanguage,
        };
        reply.send(response);
      } catch (error) {
        if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
        throw error;
      }
    },
  );

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
