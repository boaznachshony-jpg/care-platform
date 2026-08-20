import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@caredesk/db';
import type { Container } from '../container.js';
import { makeAuthenticate } from '../plugins/authenticate.js';
import { LeaveEntryService } from '../leave-entry-service.js';
import type { RateLimiter, RouteRateLimit } from '../rate-limit.js';
import { sendError, sendValidationError } from './http-errors.js';

const params = z.object({
  caseId: z.string().uuid(),
  entryId: z.string().uuid().optional(),
});
const base = z
  .object({
    entryType: z.enum(['annual', 'sick', 'holiday']),
    startDate: z.string().date(),
    endDate: z.string().date(),
    days: z.number().finite().gt(0).max(366),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
const range = (value: { startDate: string; endDate: string }): boolean =>
  value.startDate <= value.endDate;
const rangeIssue = { message: 'endDate must not precede startDate', path: ['endDate'] };
const createBody = base.refine(range, rangeIssue);
const updateBody = base
  .extend({
    status: z.enum(['recorded', 'cancelled']),
    version: z.number().int().positive(),
  })
  .strict()
  .refine(range, rangeIssue);

const MINUTE_MS = 60_000;
export const LEAVE_ENTRY_RATE_LIMITS = {
  list: { max: 60, timeWindow: MINUTE_MS, bucket: 'list' },
  save: { max: 20, timeWindow: MINUTE_MS, bucket: 'save' },
} as const satisfies Record<string, RouteRateLimit>;

function makeLeaveRateLimit(limiter: RateLimiter, policy: RouteRateLimit): preHandlerHookHandler {
  return async (request, reply) => {
    const principal = request.actor
      ? `${request.actor.tenantId}:${request.actor.userId}`
      : `unauthenticated:${request.ip}`;
    const decision = await limiter.consume(
      `leave-entry:${policy.bucket}:${principal}`,
      policy.max,
      policy.timeWindow,
    );
    if (decision.allowed) return;
    if (decision.retryAfterSeconds) reply.header('retry-after', decision.retryAfterSeconds);
    sendError(request, reply, 429, 'RATE_LIMITED');
  };
}

const idempotencyKeyOf = (request: FastifyRequest): string | null => {
  const key = request.headers['idempotency-key'];
  return typeof key === 'string' && key.length >= 8 && key.length <= 200 ? key : null;
};

export function registerLeaveEntryRoutes(
  app: FastifyInstance,
  container: Container,
  rateLimiter: RateLimiter,
) {
  if (!container.pool) return;
  const pool = container.pool;
  const auth = makeAuthenticate(container.auth, container.actorResolver);
  const service = new LeaveEntryService(pool);
  const authorize = async (a: NonNullable<FastifyRequest['actor']>, id: string) =>
    container.getCase.execute(a, id).catch(() => null);

  /**
   * Leave ledger mutations are manager-only: reading a case never confers
   * authority to record leave facts. The active tenant membership role is
   * checked under forced RLS (the payroll-entry/wave5 pattern).
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

  const mapError = (req: FastifyRequest, reply: FastifyReply, e: unknown) => {
    const m = e instanceof Error ? e.message : '';
    if (m === 'case_not_found' || m === 'entry_not_found')
      return sendError(req, reply, 404, 'NOT_FOUND');
    if (m === 'idempotency_conflict') return sendError(req, reply, 409, 'IDEMPOTENCY_CONFLICT');
    if (m === 'version_conflict') return sendError(req, reply, 409, 'VERSION_CONFLICT');
    throw e;
  };

  app.get<{ Params: { caseId: string } }>(
    '/cases/:caseId/leave-entries',
    {
      config: { rateLimit: LEAVE_ENTRY_RATE_LIMITS.list },
      preHandler: [auth, makeLeaveRateLimit(rateLimiter, LEAVE_ENTRY_RATE_LIMITS.list)],
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
    '/cases/:caseId/leave-entries',
    {
      config: { rateLimit: LEAVE_ENTRY_RATE_LIMITS.save },
      preHandler: [auth, makeLeaveRateLimit(rateLimiter, LEAVE_ENTRY_RATE_LIMITS.save)],
    },
    async (req, reply) => {
      const p = params.safeParse(req.params),
        b = createBody.safeParse(req.body);
      if (!p.success) return sendValidationError(req, reply, p.error);
      if (!b.success) return sendValidationError(req, reply, b.error);
      const key = idempotencyKeyOf(req);
      if (!key) return sendError(req, reply, 400, 'IDEMPOTENCY_KEY_REQUIRED');
      if (!req.actor) return;
      if (!(await authorize(req.actor, p.data.caseId)))
        return sendError(req, reply, 404, 'NOT_FOUND');
      if (!(await requireManager(req, reply))) return;
      try {
        const result = await service.create(req.actor, p.data.caseId, key, b.data);
        return reply.status(result.replayed ? 200 : 201).send(result);
      } catch (e) {
        return mapError(req, reply, e);
      }
    },
  );

  app.put<{ Params: { caseId: string; entryId: string } }>(
    '/cases/:caseId/leave-entries/:entryId',
    {
      config: { rateLimit: LEAVE_ENTRY_RATE_LIMITS.save },
      preHandler: [auth, makeLeaveRateLimit(rateLimiter, LEAVE_ENTRY_RATE_LIMITS.save)],
    },
    async (req, reply) => {
      const p = params.safeParse(req.params),
        b = updateBody.safeParse(req.body);
      if (!p.success || !p.data.entryId) return sendError(req, reply, 400, 'VALIDATION_ERROR');
      if (!b.success) return sendValidationError(req, reply, b.error);
      const key = idempotencyKeyOf(req);
      if (!key) return sendError(req, reply, 400, 'IDEMPOTENCY_KEY_REQUIRED');
      if (!req.actor) return;
      if (!(await authorize(req.actor, p.data.caseId)))
        return sendError(req, reply, 404, 'NOT_FOUND');
      if (!(await requireManager(req, reply))) return;
      try {
        const result = await service.update(req.actor, p.data.caseId, p.data.entryId, key, b.data);
        return reply.status(200).send(result);
      } catch (e) {
        return mapError(req, reply, e);
      }
    },
  );
}
