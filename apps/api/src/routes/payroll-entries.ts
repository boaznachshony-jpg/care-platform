import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Container } from '../container.js';
import { makeAuthenticate } from '../plugins/authenticate.js';
import { PayrollEntryService } from '../payroll-entry-service.js';
import { sendError, sendValidationError } from './http-errors.js';
const params = z.object({
  caseId: z.string().uuid(),
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
});
const amount = z.number().finite().min(0).max(10_000_000);
const days = z.number().finite().min(0).max(31);
const body = z
  .object({
    baseSalary: amount,
    workDays: days,
    paidRestDays: z.number().min(0).max(6),
    restDayRate: amount,
    paidHolidays: z.number().min(0).max(10),
    holidayPay: amount,
    vacationDays: days,
    vacationPay: amount,
    sickDays: days,
    sickPay: amount,
    otherAbsenceDays: days,
    employerContributions: amount,
    additionalPayments: z
      .array(z.object({ description: z.string().trim().min(1).max(120), amount }))
      .max(50),
    pocketMoney: amount,
    deductions: amount,
    advances: amount,
    agreedDeductions: amount,
    total: z.number().finite().min(-10_000_000).max(10_000_000),
    status: z.enum(['draft', 'final']),
    version: z.number().int().positive().optional(),
  })
  .strict();
export function registerPayrollEntryRoutes(app: FastifyInstance, container: Container) {
  if (!container.pool) return;
  const auth = makeAuthenticate(container.auth, container.actorResolver);
  const service = new PayrollEntryService(container.pool);
  const authorize = async (a: NonNullable<FastifyRequest['actor']>, id: string) =>
    container.getCase.execute(a, id).catch(() => null);
  app.get<{ Params: { caseId: string } }>(
    '/cases/:caseId/payroll-entries',
    { preHandler: auth },
    async (req, reply) => {
      const p = params.safeParse(req.params);
      if (!p.success) return sendValidationError(req, reply, p.error);
      if (!req.actor) return;
      if (!(await authorize(req.actor, p.data.caseId)))
        return sendError(req, reply, 404, 'NOT_FOUND');
      return service.list(req.actor, p.data.caseId);
    },
  );
  app.get<{ Params: { caseId: string; month: string } }>(
    '/cases/:caseId/payroll-entries/:month',
    { preHandler: auth },
    async (req, reply) => {
      const p = params.safeParse(req.params);
      if (!p.success) return sendValidationError(req, reply, p.error);
      if (!req.actor) return;
      if (!(await authorize(req.actor, p.data.caseId)))
        return sendError(req, reply, 404, 'NOT_FOUND');
      const entry = await service.get(req.actor, p.data.caseId, p.data.month!);
      if (!entry) return sendError(req, reply, 404, 'NOT_FOUND');
      return entry;
    },
  );
  app.put<{ Params: { caseId: string; month: string } }>(
    '/cases/:caseId/payroll-entries/:month',
    { preHandler: auth },
    async (req, reply) => {
      const p = params.safeParse(req.params),
        b = body.safeParse(req.body);
      if (!p.success) return sendValidationError(req, reply, p.error);
      if (!b.success) return sendValidationError(req, reply, b.error);
      const key = req.headers['idempotency-key'];
      if (typeof key !== 'string' || key.length < 8 || key.length > 200)
        return sendError(req, reply, 400, 'IDEMPOTENCY_KEY_REQUIRED');
      if (!req.actor) return;
      if (!(await authorize(req.actor, p.data.caseId)))
        return sendError(req, reply, 404, 'NOT_FOUND');
      try {
        const result = await service.save(req.actor, p.data.caseId, p.data.month!, key, b.data);
        return reply.status(result.replayed ? 200 : 201).send(result);
      } catch (e) {
        const m = e instanceof Error ? e.message : '';
        if (m === 'case_not_found') return sendError(req, reply, 404, 'NOT_FOUND');
        if (m === 'idempotency_conflict' || m === 'version_conflict')
          return sendError(
            req,
            reply,
            409,
            m === 'version_conflict' ? 'VERSION_CONFLICT' : 'IDEMPOTENCY_CONFLICT',
          );
        throw e;
      }
    },
  );
}
