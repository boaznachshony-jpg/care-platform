import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Container } from '../container.js';
import { makeAuthenticate } from '../plugins/authenticate.js';
import { sendError, sendValidationError } from './http-errors.js';

const id = z.string().uuid();
const responsibility = z.enum([
  'case_management',
  'payroll',
  'documents_compliance',
  'visa_authorization',
  'insurance',
  'general_administration',
]);
const requestBody = z
  .object({
    type: z.enum(['vacation', 'document', 'payment_question', 'general']),
    message: z.string().trim().min(1).max(1000),
    startDate: z.string().date().optional(),
    endDate: z.string().date().optional(),
  })
  .refine(
    (value) =>
      value.type === 'vacation'
        ? Boolean(value.startDate && value.endDate && value.startDate <= value.endDate)
        : !value.startDate && !value.endDate,
    { message: 'Dates are required only for a valid vacation range' },
  );

declare module 'fastify' {
  interface FastifyRequest {
    workerUserId?: string;
  }
}

async function workerIdentity(request: FastifyRequest, container: Container) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return container.auth.verifySession(header.slice(7));
}

export function registerWave5Routes(app: FastifyInstance, container: Container): void {
  const service = container.wave5;
  if (!service) return;
  const employer = { preHandler: makeAuthenticate(container.auth, container.actorResolver) };
  const worker = {
    preHandler: async (request: FastifyRequest, reply: any) => {
      const session = await workerIdentity(request, container);
      if (!session) return sendError(request, reply, 401, 'UNAUTHENTICATED');
      const context = await service.workerContext(session.userId);
      if (!context) return sendError(request, reply, 403, 'FORBIDDEN');
      request.workerUserId = session.userId;
    },
  };

  app.get<{ Params: { caseId: string } }>(
    '/cases/:caseId/collaboration',
    employer,
    async (request, reply) => {
      if (!request.actor || !id.safeParse(request.params.caseId).success)
        return sendError(request, reply, 400, 'VALIDATION_ERROR');
      reply.send(await service.collaboration(request.actor, request.params.caseId));
    },
  );
  app.put<{ Params: { caseId: string } }>(
    '/cases/:caseId/responsibilities/:kind',
    employer,
    async (request, reply) => {
      const params = z.object({ caseId: id, kind: responsibility }).safeParse(request.params);
      const body = z.object({ assigneeMembershipId: id.nullable() }).safeParse(request.body);
      if (!params.success) return sendValidationError(request, reply, params.error);
      if (!body.success) return sendValidationError(request, reply, body.error);
      try {
        reply.send(
          await service.assignResponsibility(
            request.actor!,
            params.data.caseId,
            params.data.kind,
            body.data.assigneeMembershipId,
          ),
        );
      } catch {
        return sendError(request, reply, 403, 'FORBIDDEN');
      }
    },
  );
  app.post('/worker/invitations', employer, async (request, reply) => {
    const body = z
      .object({
        caseId: id,
        workerId: id,
        destination: z.string().email(),
        expiresInHours: z.number().int().min(1).max(168).optional(),
      })
      .safeParse(request.body);
    if (!body.success) return sendValidationError(request, reply, body.error);
    try {
      reply.status(201).send(await service.inviteWorker(request.actor!, body.data));
    } catch {
      return sendError(request, reply, 403, 'FORBIDDEN');
    }
  });
  app.post('/worker/activate', async (request, reply) => {
    const session = await workerIdentity(request, container);
    if (!session) return sendError(request, reply, 401, 'UNAUTHENTICATED');
    const body = z.object({ token: z.string().min(32).max(200) }).safeParse(request.body);
    if (!body.success) return sendValidationError(request, reply, body.error);
    try {
      reply.send(await service.consumeInvitation(session.userId, body.data.token));
    } catch {
      return sendError(request, reply, 410, 'INVITATION_INVALID');
    }
  });
  app.get('/worker/portal', worker, async (request, reply) => {
    const context = await service.workerContext(request.workerUserId!);
    if (!context) return sendError(request, reply, 403, 'FORBIDDEN');
    reply.send(await service.workerHome(context));
  });
  app.post<{ Params: { closeId: string } }>(
    '/worker/payments/:closeId/acknowledgements',
    worker,
    async (request, reply) => {
      if (!id.safeParse(request.params.closeId).success)
        return sendError(request, reply, 400, 'VALIDATION_ERROR');
      const context = await service.workerContext(request.workerUserId!);
      try {
        reply.status(201).send(await service.acknowledge(context!, request.params.closeId));
      } catch {
        return sendError(request, reply, 404, 'NOT_FOUND');
      }
    },
  );
  app.post('/worker/requests', worker, async (request, reply) => {
    const body = requestBody.safeParse(request.body);
    if (!body.success) return sendValidationError(request, reply, body.error);
    reply
      .status(201)
      .send(
        await service.createRequest(
          (await service.workerContext(request.workerUserId!))!,
          body.data,
        ),
      );
  });
  app.patch<{ Params: { requestId: string } }>(
    '/worker-requests/:requestId',
    employer,
    async (request, reply) => {
      const body = z
        .object({
          status: z.enum(['in_review', 'approved', 'rejected', 'resolved']),
          assigneeMembershipId: id.optional(),
        })
        .safeParse(request.body);
      if (!id.safeParse(request.params.requestId).success || !body.success)
        return sendError(request, reply, 400, 'VALIDATION_ERROR');
      try {
        reply.send(
          await service.updateRequest(
            request.actor!,
            request.params.requestId,
            body.data.status,
            body.data.assigneeMembershipId,
          ),
        );
      } catch {
        return sendError(request, reply, 409, 'INVALID_STATE_TRANSITION');
      }
    },
  );
}
