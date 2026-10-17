import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@caredesk/db';
import { importNationalInsuranceReportRequestSchema } from '@caredesk/schemas';
import type { Container } from '../container.js';
import {
  NationalInsuranceReportError,
  NationalInsuranceReportService,
} from '../national-insurance-report-service.js';
import { makeAuthenticate } from '../plugins/authenticate.js';
import type { RateLimiter, RouteRateLimit } from '../rate-limit.js';
import { sendError, sendValidationError } from './http-errors.js';

const params = z.object({ caseId: z.string().uuid() });

const MINUTE_MS = 60_000;
export const NATIONAL_INSURANCE_REPORT_RATE_LIMITS = {
  list: { max: 60, timeWindow: MINUTE_MS, bucket: 'list' },
  // A family holds a handful of National Insurance payments a year; the copy
  // in stage 2 sends them one at a time.
  import: { max: 30, timeWindow: MINUTE_MS, bucket: 'import' },
} as const satisfies Record<string, RouteRateLimit>;

function makeReportRateLimit(limiter: RateLimiter, policy: RouteRateLimit): preHandlerHookHandler {
  return async (request, reply) => {
    const principal = request.actor
      ? `${request.actor.tenantId}:${request.actor.userId}`
      : `unauthenticated:${request.ip}`;
    const decision = await limiter.consume(
      `national-insurance-report:${policy.bucket}:${principal}`,
      policy.max,
      policy.timeWindow,
    );
    if (decision.allowed) return;
    if (decision.retryAfterSeconds) reply.header('retry-after', decision.retryAfterSeconds);
    sendError(request, reply, 429, 'RATE_LIMITED');
  };
}

/**
 * R5-09, stage 1 - see national-insurance-report-service.ts. Registered only
 * when the container is Postgres-backed, like the payroll routes beside it:
 * there is no in-memory National Insurance report, because in stage 1 nothing
 * in the product reads or writes one yet.
 */
export function registerNationalInsuranceReportRoutes(
  app: FastifyInstance,
  container: Container,
  rateLimiter: RateLimiter,
): void {
  if (!container.pool) return;
  const pool = container.pool;
  const auth = makeAuthenticate(container.auth, container.actorResolver);
  const service = new NationalInsuranceReportService(pool);
  // Case access first: another tenant's case stays an indistinguishable 404.
  const authorize = async (actor: NonNullable<FastifyRequest['actor']>, caseId: string) =>
    container.getCase.execute(actor, caseId).catch(() => null);

  /**
   * Writing a report is payroll authority: owner or manager, checked under
   * forced RLS exactly as the payroll-entry routes do. Reading the case never
   * confers it.
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
    '/cases/:caseId/national-insurance-reports',
    {
      config: { rateLimit: NATIONAL_INSURANCE_REPORT_RATE_LIMITS.list },
      preHandler: [
        auth,
        makeReportRateLimit(rateLimiter, NATIONAL_INSURANCE_REPORT_RATE_LIMITS.list),
      ],
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

  /**
   * Idempotent copy of one saved payment's report lines (stage 2). 201 when it
   * created the report, 200 when the report already existed - unchanged or
   * corrected in place. The body says which.
   */
  app.post<{ Params: { caseId: string } }>(
    '/cases/:caseId/national-insurance-reports/import',
    {
      config: { rateLimit: NATIONAL_INSURANCE_REPORT_RATE_LIMITS.import },
      preHandler: [
        auth,
        makeReportRateLimit(rateLimiter, NATIONAL_INSURANCE_REPORT_RATE_LIMITS.import),
      ],
    },
    async (req, reply) => {
      const p = params.safeParse(req.params);
      if (!p.success) return sendValidationError(req, reply, p.error);
      const b = importNationalInsuranceReportRequestSchema.safeParse(req.body);
      if (!b.success) return sendValidationError(req, reply, b.error);
      if (!req.actor) return;
      if (!(await authorize(req.actor, p.data.caseId)))
        return sendError(req, reply, 404, 'NOT_FOUND');
      if (!(await requireManager(req, reply))) return;
      try {
        const result = await service.importReport(req.actor, p.data.caseId, b.data);
        return reply.status(result.outcome === 'created' ? 201 : 200).send(result);
      } catch (error) {
        if (!(error instanceof NationalInsuranceReportError)) throw error;
        if (error.failure === 'case_not_found') return sendError(req, reply, 404, 'NOT_FOUND');
        const field = { [`months.${error.month}`]: [error.failure] };
        // The line's amount is not wage x rate: well-formed, wrong arithmetic,
        // so 422 like the payroll total (DOM-02).
        if (error.failure === 'amount_mismatch')
          return sendError(req, reply, 422, 'TOTAL_MISMATCH', field);
        // The copy would drop a month the server already holds. Refused, never
        // applied: nothing is deleted, and the workspace still has the data.
        return sendError(req, reply, 409, 'INVALID_STATE_TRANSITION', field);
      }
    },
  );
}
