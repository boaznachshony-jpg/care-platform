import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../container.js';
import { makeAuthenticate } from '../plugins/authenticate.js';
import { CanonicalIntelligenceService } from '../product-intelligence/canonical-intelligence-service.js';
import { sendError, sendValidationError } from './http-errors.js';

const paramsSchema = z.object({ caseId: z.string().uuid() });
const closeSchema = z
  .object({
    payrollReference: z.string().trim().min(1).max(200),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    paymentDate: z.string().date(),
    paymentMethod: z.enum(['bank_transfer', 'cash', 'check', 'other']),
    total: z.number().positive().max(10_000_000),
    baseSalary: z.number().nonnegative().max(10_000_000),
    additions: z.number().nonnegative().max(10_000_000),
    deductions: z.number().nonnegative().max(10_000_000),
  })
  .refine(
    (value) => Math.abs(value.baseSalary + value.additions - value.deductions - value.total) < 0.01,
    {
      message: 'Close amounts do not reconcile',
      path: ['total'],
    },
  );

export function registerCanonicalProductIntelligenceRoutes(
  app: FastifyInstance,
  container: Container,
) {
  if (!container.pool) return;
  const authenticate = makeAuthenticate(container.auth, container.actorResolver);
  const service = new CanonicalIntelligenceService(container.pool);

  app.get<{ Params: { caseId: string } }>(
    '/cases/:caseId/payroll-month-closes',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = paramsSchema.safeParse(request.params);
      if (!parsed.success) return sendValidationError(request, reply, parsed.error);
      const actor = request.actor;
      if (!actor) return;
      const authorized = await container.getCase
        .execute(actor, parsed.data.caseId)
        .catch(() => null);
      if (!authorized) return sendError(request, reply, 404, 'NOT_FOUND');
      reply.send(await service.list(actor, parsed.data.caseId));
    },
  );

  app.post<{ Params: { caseId: string } }>(
    '/cases/:caseId/payroll-month-closes',
    { preHandler: authenticate },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      const body = closeSchema.safeParse(request.body);
      if (!params.success) return sendValidationError(request, reply, params.error);
      if (!body.success) return sendValidationError(request, reply, body.error);
      const key = request.headers['idempotency-key'];
      if (typeof key !== 'string' || key.length < 8 || key.length > 200)
        return sendError(request, reply, 400, 'IDEMPOTENCY_KEY_REQUIRED');
      const actor = request.actor;
      if (!actor) return;
      const authorized = await container.getCase
        .execute(actor, params.data.caseId)
        .catch(() => null);
      if (!authorized) return sendError(request, reply, 404, 'NOT_FOUND');
      try {
        const result = await service.close(actor, params.data.caseId, key, body.data);
        reply.status(result.replayed ? 200 : 201).send(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message === 'manager_required') return sendError(request, reply, 403, 'FORBIDDEN');
        if (message === 'case_not_found') return sendError(request, reply, 404, 'NOT_FOUND');
        if (message === 'idempotency_conflict')
          return sendError(request, reply, 409, 'IDEMPOTENCY_CONFLICT');
        throw error;
      }
    },
  );
}
