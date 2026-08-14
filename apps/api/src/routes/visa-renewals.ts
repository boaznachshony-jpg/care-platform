import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { AuthorizationError, VisaRenewalValidationError } from '@caredesk/application';
import {
  completeVisaRenewalRequestSchema,
  linkRenewedAuthorizationRequestSchema,
  resolveAuthorizationOverlapRequestSchema,
  startVisaRenewalRequestSchema,
  visaRenewalContactActivityRequestSchema,
} from '@caredesk/schemas';
import type { Container } from '../container.js';
import { makeAuthenticate } from '../plugins/authenticate.js';
import { sendError, sendValidationError } from './http-errors.js';

interface CaseParams {
  caseId: string;
}
interface WorkflowParams extends CaseParams {
  workflowId: string;
}
interface ReviewParams extends WorkflowParams {
  reviewId: string;
}

function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function idempotencyKey(headers: Record<string, unknown>): string | null {
  const value = headers['idempotency-key'];
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null;
}

function mutationError(
  request: Parameters<typeof sendError>[0],
  reply: Parameters<typeof sendError>[1],
  error: unknown,
) {
  if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
  if (error instanceof VisaRenewalValidationError) {
    const status =
      error.code === 'IDEMPOTENCY_KEY_REUSED'
        ? 409
        : error.code === 'WORKFLOW_NOT_FOUND'
          ? 404
          : 422;
    return sendError(request, reply, status, error.code);
  }
  throw error;
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

  app.post<{ Params: WorkflowParams }>(
    '/cases/:caseId/visa-renewals/:workflowId/contact-activities',
    options,
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      const parsed = visaRenewalContactActivityRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(request, reply, parsed.error);
      const key = idempotencyKey(request.headers);
      if (!key) return sendError(request, reply, 400, 'IDEMPOTENCY_KEY_REQUIRED');
      try {
        reply
          .status(201)
          .send(
            await container.recordVisaRenewalContact.execute(
              actor,
              request.params.caseId,
              request.params.workflowId,
              { ...parsed.data, idempotencyKey: key, requestHash: requestHash(parsed.data) },
            ),
          );
      } catch (error) {
        return mutationError(request, reply, error);
      }
    },
  );

  app.post<{ Params: WorkflowParams }>(
    '/cases/:caseId/visa-renewals/:workflowId/renewed-authorization',
    options,
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      const parsed = linkRenewedAuthorizationRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(request, reply, parsed.error);
      const key = idempotencyKey(request.headers);
      if (!key) return sendError(request, reply, 400, 'IDEMPOTENCY_KEY_REQUIRED');
      try {
        reply
          .status(201)
          .send(
            await container.linkRenewedVisaAuthorization.execute(
              actor,
              request.params.caseId,
              request.params.workflowId,
              { ...parsed.data, idempotencyKey: key, requestHash: requestHash(parsed.data) },
            ),
          );
      } catch (error) {
        return mutationError(request, reply, error);
      }
    },
  );

  app.post<{ Params: ReviewParams }>(
    '/cases/:caseId/visa-renewals/:workflowId/overlap-reviews/:reviewId/resolve',
    options,
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      const parsed = resolveAuthorizationOverlapRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(request, reply, parsed.error);
      const key = idempotencyKey(request.headers);
      if (!key) return sendError(request, reply, 400, 'IDEMPOTENCY_KEY_REQUIRED');
      try {
        reply.send(
          await container.resolveVisaAuthorizationOverlap.execute(
            actor,
            request.params.caseId,
            request.params.workflowId,
            request.params.reviewId,
            { ...parsed.data, idempotencyKey: key, requestHash: requestHash(parsed.data) },
          ),
        );
      } catch (error) {
        return mutationError(request, reply, error);
      }
    },
  );

  app.post<{ Params: WorkflowParams }>(
    '/cases/:caseId/visa-renewals/:workflowId/complete',
    options,
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      const parsed = completeVisaRenewalRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(request, reply, parsed.error);
      const key = idempotencyKey(request.headers);
      if (!key) return sendError(request, reply, 400, 'IDEMPOTENCY_KEY_REQUIRED');
      try {
        reply.send(
          await container.completeVisaRenewal.execute(
            actor,
            request.params.caseId,
            request.params.workflowId,
            { ...parsed.data, idempotencyKey: key, requestHash: requestHash(parsed.data) },
          ),
        );
      } catch (error) {
        return mutationError(request, reply, error);
      }
    },
  );
}
