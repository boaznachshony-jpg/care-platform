import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { AuthorizationError, VisaRenewalValidationError } from '@caredesk/application';
import { startVisaRenewalRequestSchema } from '@caredesk/schemas';
import type { Container } from '../container.js';
import { makeAuthenticate } from '../plugins/authenticate.js';
import { sendError, sendValidationError } from './http-errors.js';

interface CaseParams {
  caseId: string;
}
interface WorkflowParams extends CaseParams {
  workflowId: string;
}

function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Tenant authority comes exclusively from request.actor, never request data. */
export function registerVisaRenewalRoutes(app: FastifyInstance, container: Container): void {
  const options = { preHandler: makeAuthenticate(container.auth, container.actorResolver) };

  app.post<{ Params: CaseParams }>(
    '/cases/:caseId/visa-renewals',
    options,
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      const parsed = startVisaRenewalRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(request, reply, parsed.error);
      const idempotency = request.headers['idempotency-key'];
      if (typeof idempotency !== 'string' || idempotency.length < 1 || idempotency.length > 200)
        return sendError(request, reply, 400, 'IDEMPOTENCY_KEY_REQUIRED');
      try {
        const evaluation = await container.visaRenewalEvaluation.evaluate(parsed.data.asOf);
        const workflow = await container.startVisaRenewal.execute(actor, request.params.caseId, {
          templateVersionId: parsed.data.templateVersionId,
          currentAuthorizationId: parsed.data.currentAuthorizationId,
          assignments: parsed.data.assignments,
          evaluation,
          idempotencyKey: idempotency,
          requestHash: requestHash(parsed.data),
        });
        reply.status(201).send(workflow);
      } catch (error) {
        if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
        if (error instanceof VisaRenewalValidationError)
          return sendError(
            request,
            reply,
            error.code === 'IDEMPOTENCY_KEY_REUSED' ? 409 : 422,
            error.code,
          );
        throw error;
      }
    },
  );

  app.get<{ Params: CaseParams }>(
    '/cases/:caseId/visa-renewals',
    options,
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      try {
        reply.send(await container.listVisaRenewals.execute(actor, request.params.caseId));
      } catch (error) {
        if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
        throw error;
      }
    },
  );

  app.get<{ Params: WorkflowParams }>(
    '/cases/:caseId/visa-renewals/:workflowId',
    options,
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      try {
        const workflow = await container.getVisaRenewal.execute(
          actor,
          request.params.caseId,
          request.params.workflowId,
        );
        if (!workflow) return sendError(request, reply, 404, 'NOT_FOUND');
        reply.send(workflow);
      } catch (error) {
        if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
        throw error;
      }
    },
  );
}
