import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@caredesk/db';
import type { Container } from '../container.js';
import { makeAuthenticate } from '../plugins/authenticate.js';
import { ScenarioExpenseService } from '../scenario-expense-service.js';
import type { RateLimiter, RouteRateLimit } from '../rate-limit.js';
import { sendError, sendValidationError } from './http-errors.js';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const params = z.object({
  caseId: z.string().uuid(),
  expenseId: z.string().uuid().optional(),
});
const fields = {
  label: z.string().trim().min(1).max(120),
  amount: z.number().finite().min(0).max(10_000_000),
  kind: z.enum(['recurring', 'one_time']),
  startMonth: z.string().regex(MONTH),
  endMonth: z.string().regex(MONTH).nullable().optional(),
};
const monthWindow = (
  value: { kind: 'recurring' | 'one_time'; startMonth: string; endMonth?: string | null },
  ctx: z.RefinementCtx,
) => {
  if (value.endMonth && value.endMonth < value.startMonth)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endMonth'],
      message: 'endMonth must not precede startMonth',
    });
  if (value.kind === 'one_time' && value.endMonth)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endMonth'],
      message: 'one_time expenses take no window end',
    });
};
/** Create: there is no existing row, so there is nothing to be stale against. */
const body = z
  .object({ ...fields, version: z.number().int().positive().optional() })
  .strict()
  .superRefine(monthWindow);
/**
 * Root 4 (API-03): update and delete both address a row that already exists, so
 * `version` is required — the schema, not the service, is where a client that
 * omits it is told. `LeaveEntryService.update` has always had this contract
 * (`version: z.number().int().positive()`, routes/leave-entries.ts); the
 * scenario-expense and payroll paths were the two that made it optional, which
 * meant the last writer won silently.
 */
const updateBody = z
  .object({ ...fields, version: z.number().int().positive() })
  .strict()
  .superRefine(monthWindow);
const removeBody = z.object({ version: z.number().int().positive() }).strict();

const MINUTE_MS = 60_000;
export const SCENARIO_EXPENSE_RATE_LIMITS = {
  list: { max: 60, timeWindow: MINUTE_MS, bucket: 'list' },
  save: { max: 20, timeWindow: MINUTE_MS, bucket: 'save' },
  remove: { max: 20, timeWindow: MINUTE_MS, bucket: 'remove' },
} as const satisfies Record<string, RouteRateLimit>;

function makeScenarioRateLimit(
  limiter: RateLimiter,
  policy: RouteRateLimit,
): preHandlerHookHandler {
  return async (request, reply) => {
    const principal = request.actor
      ? `${request.actor.tenantId}:${request.actor.userId}`
      : `unauthenticated:${request.ip}`;
    const decision = await limiter.consume(
      `scenario-expense:${policy.bucket}:${principal}`,
      policy.max,
      policy.timeWindow,
    );
    if (decision.allowed) return;
    if (decision.retryAfterSeconds) reply.header('retry-after', decision.retryAfterSeconds);
    sendError(request, reply, 429, 'RATE_LIMITED');
  };
}

export function registerScenarioExpenseRoutes(
  app: FastifyInstance,
  container: Container,
  rateLimiter: RateLimiter,
) {
  if (!container.pool) return;
  const pool = container.pool;
  const auth = makeAuthenticate(container.auth, container.actorResolver);
  const service = new ScenarioExpenseService(pool);
  const authorize = async (a: NonNullable<FastifyRequest['actor']>, id: string) =>
    container.getCase.execute(a, id).catch(() => null);

  /**
   * Scenario mutations are manager-only, like every payroll mutation: reading
   * a case never confers authority to shape its financial planning layer.
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

  const requireIdempotencyKey = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 200) {
      sendError(req, reply, 400, 'IDEMPOTENCY_KEY_REQUIRED');
      return null;
    }
    return key;
  };

  const mapError = (req: FastifyRequest, reply: FastifyReply, e: unknown) => {
    const m = e instanceof Error ? e.message : '';
    if (m === 'case_not_found' || m === 'expense_not_found')
      return sendError(req, reply, 404, 'NOT_FOUND');
    // API-03: 428 Precondition Required — the write is refused until the client
    // states which version it is replacing. Matches the payroll-entry route.
    if (m === 'version_required') return sendError(req, reply, 428, 'VERSION_REQUIRED');
    if (m === 'idempotency_conflict' || m === 'version_conflict')
      return sendError(
        req,
        reply,
        409,
        m === 'version_conflict' ? 'VERSION_CONFLICT' : 'IDEMPOTENCY_CONFLICT',
      );
    throw e;
  };

  app.get<{ Params: { caseId: string } }>(
    '/cases/:caseId/scenario-expenses',
    {
      config: { rateLimit: SCENARIO_EXPENSE_RATE_LIMITS.list },
      preHandler: [auth, makeScenarioRateLimit(rateLimiter, SCENARIO_EXPENSE_RATE_LIMITS.list)],
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

  app.post<{ Params: { caseId: string } }>(
    '/cases/:caseId/scenario-expenses',
    {
      config: { rateLimit: SCENARIO_EXPENSE_RATE_LIMITS.save },
      preHandler: [auth, makeScenarioRateLimit(rateLimiter, SCENARIO_EXPENSE_RATE_LIMITS.save)],
    },
    async (req, reply) => {
      const p = params.safeParse(req.params),
        b = body.safeParse(req.body);
      if (!p.success) return sendValidationError(req, reply, p.error);
      if (!b.success) return sendValidationError(req, reply, b.error);
      const key = requireIdempotencyKey(req, reply);
      if (!key) return;
      if (!req.actor) return;
      if (!(await authorize(req.actor, p.data.caseId)))
        return sendError(req, reply, 404, 'NOT_FOUND');
      if (!(await requireManager(req, reply))) return;
      try {
        const result = await service.save(req.actor, p.data.caseId, key, b.data);
        return reply.status(result.replayed ? 200 : 201).send(result);
      } catch (e) {
        return mapError(req, reply, e);
      }
    },
  );

  app.put<{ Params: { caseId: string; expenseId: string } }>(
    '/cases/:caseId/scenario-expenses/:expenseId',
    {
      config: { rateLimit: SCENARIO_EXPENSE_RATE_LIMITS.save },
      preHandler: [auth, makeScenarioRateLimit(rateLimiter, SCENARIO_EXPENSE_RATE_LIMITS.save)],
    },
    async (req, reply) => {
      const p = params.safeParse(req.params),
        // API-03: updateBody, not body — `version` is mandatory here.
        b = updateBody.safeParse(req.body);
      if (!p.success) return sendValidationError(req, reply, p.error);
      if (!b.success) return sendValidationError(req, reply, b.error);
      // The routed path always carries :expenseId; this guard is defensive only.
      if (!p.data.expenseId) return sendError(req, reply, 404, 'NOT_FOUND');
      const key = requireIdempotencyKey(req, reply);
      if (!key) return;
      if (!req.actor) return;
      if (!(await authorize(req.actor, p.data.caseId)))
        return sendError(req, reply, 404, 'NOT_FOUND');
      if (!(await requireManager(req, reply))) return;
      try {
        const result = await service.save(req.actor, p.data.caseId, key, b.data, p.data.expenseId);
        return reply.status(200).send(result);
      } catch (e) {
        return mapError(req, reply, e);
      }
    },
  );

  app.delete<{ Params: { caseId: string; expenseId: string } }>(
    '/cases/:caseId/scenario-expenses/:expenseId',
    {
      config: { rateLimit: SCENARIO_EXPENSE_RATE_LIMITS.remove },
      preHandler: [auth, makeScenarioRateLimit(rateLimiter, SCENARIO_EXPENSE_RATE_LIMITS.remove)],
    },
    async (req, reply) => {
      const p = params.safeParse(req.params);
      if (!p.success) return sendValidationError(req, reply, p.error);
      // The routed path always carries :expenseId; this guard is defensive only.
      if (!p.data.expenseId) return sendError(req, reply, 404, 'NOT_FOUND');
      const b = removeBody.safeParse(req.body ?? {});
      if (!b.success) return sendValidationError(req, reply, b.error);
      const key = requireIdempotencyKey(req, reply);
      if (!key) return;
      if (!req.actor) return;
      if (!(await authorize(req.actor, p.data.caseId)))
        return sendError(req, reply, 404, 'NOT_FOUND');
      if (!(await requireManager(req, reply))) return;
      try {
        const result = await service.remove(
          req.actor,
          p.data.caseId,
          p.data.expenseId,
          key,
          b.data.version,
        );
        return reply.status(200).send(result);
      } catch (e) {
        return mapError(req, reply, e);
      }
    },
  );
}
