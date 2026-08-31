import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@caredesk/db';
import { PayrollComponentError } from '@caredesk/domain';
import type { Container } from '../container.js';
import { makeAuthenticate } from '../plugins/authenticate.js';
import { PayrollEntryService } from '../payroll-entry-service.js';
import type { RateLimiter, RouteRateLimit } from '../rate-limit.js';
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
    // DOM-02: still accepted, but only as an assertion the server checks
    // against its own recomputation. A mismatch is a 422; the value stored is
    // always the derived one. Negative is legitimate (DOM-07 carry-forward).
    total: z.number().finite().min(-10_000_000).max(10_000_000),
    status: z.enum(['draft', 'final']),
    // API-03: optional HERE because this route upserts and only the service,
    // holding the row lock, can tell a create from an update. The service
    // requires it whenever a row exists; see `version_required` below.
    version: z.number().int().positive().optional(),
  })
  .strict();

const MINUTE_MS = 60_000;
export const PAYROLL_ENTRY_RATE_LIMITS = {
  list: { max: 60, timeWindow: MINUTE_MS, bucket: 'list' },
  get: { max: 60, timeWindow: MINUTE_MS, bucket: 'get' },
  save: { max: 20, timeWindow: MINUTE_MS, bucket: 'save' },
} as const satisfies Record<string, RouteRateLimit>;

function makePayrollRateLimit(limiter: RateLimiter, policy: RouteRateLimit): preHandlerHookHandler {
  return async (request, reply) => {
    const principal = request.actor
      ? `${request.actor.tenantId}:${request.actor.userId}`
      : `unauthenticated:${request.ip}`;
    const decision = await limiter.consume(
      `payroll-entry:${policy.bucket}:${principal}`,
      policy.max,
      policy.timeWindow,
    );
    if (decision.allowed) return;
    if (decision.retryAfterSeconds) reply.header('retry-after', decision.retryAfterSeconds);
    sendError(request, reply, 429, 'RATE_LIMITED');
  };
}

export function registerPayrollEntryRoutes(
  app: FastifyInstance,
  container: Container,
  rateLimiter: RateLimiter,
) {
  if (!container.pool) return;
  const pool = container.pool;
  const auth = makeAuthenticate(container.auth, container.actorResolver);
  const service = new PayrollEntryService(pool);
  const authorize = async (a: NonNullable<FastifyRequest['actor']>, id: string) =>
    container.getCase.execute(a, id).catch(() => null);

  /**
   * Payroll mutations are manager-only: reading a case never confers authority
   * to record salary facts. The active tenant membership role is checked under
   * forced RLS (the product-differentiation/wave5 pattern).
   */
  const requireManager = async (req: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    const actor = req.actor;
    if (!actor) return false;
    const allowed = await withTenant(pool, actor.tenantId, (client) =>
      client.query(
        `select 1 from tenant_membership where tenant_id=$1 and user_id=$2 and status='active' and role in ('owner','manager')`,
        [actor.tenantId, actor.userId],
      ),
    );
    if (allowed.rowCount) return true;
    sendError(req, reply, 403, 'MANAGER_REQUIRED');
    return false;
  };

  app.get<{ Params: { caseId: string } }>(
    '/cases/:caseId/payroll-entries',
    {
      config: { rateLimit: PAYROLL_ENTRY_RATE_LIMITS.list },
      preHandler: [auth, makePayrollRateLimit(rateLimiter, PAYROLL_ENTRY_RATE_LIMITS.list)],
    },
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
    {
      config: { rateLimit: PAYROLL_ENTRY_RATE_LIMITS.get },
      preHandler: [auth, makePayrollRateLimit(rateLimiter, PAYROLL_ENTRY_RATE_LIMITS.get)],
    },
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
    {
      config: { rateLimit: PAYROLL_ENTRY_RATE_LIMITS.save },
      preHandler: [auth, makePayrollRateLimit(rateLimiter, PAYROLL_ENTRY_RATE_LIMITS.save)],
    },
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
      if (!(await requireManager(req, reply))) return;
      try {
        const result = await service.save(req.actor, p.data.caseId, p.data.month!, key, b.data);
        return reply.status(result.replayed ? 200 : 201).send(result);
      } catch (e) {
        // Root 4: a component the domain refuses (DOM-07) is a bad request, not
        // a 500. It is unreachable through this route's schema and is mapped
        // anyway, because the service is not the route's private property.
        if (e instanceof PayrollComponentError)
          return sendError(req, reply, 400, 'VALIDATION_ERROR', {
            [e.component]: [e.problem],
          });
        const m = e instanceof Error ? e.message : '';
        if (m === 'case_not_found') return sendError(req, reply, 404, 'NOT_FOUND');
        // DOM-02/DB-06: the submitted total does not equal what its own
        // components produce. 422 rather than 400 — the payload is well formed,
        // its arithmetic is not.
        if (m === 'total_mismatch') return sendError(req, reply, 422, 'TOTAL_MISMATCH');
        // DOM-01: the month has a close receipt. Correcting it requires a
        // governed reopen path, which does not exist yet (see the report).
        if (m === 'payroll_month_closed') return sendError(req, reply, 409, 'PAYROLL_MONTH_CLOSED');
        // API-03: 428 Precondition Required is the exact semantic — the write
        // is refused until the client states which version it is replacing.
        if (m === 'version_required') return sendError(req, reply, 428, 'VERSION_REQUIRED');
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
