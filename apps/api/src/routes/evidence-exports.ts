import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { InMemoryAuditService, InMemoryTimelineService } from '@caredesk/infrastructure';
import type { Container } from '../container.js';
import { makeAuthenticate } from '../plugins/authenticate.js';
import {
  InMemoryEvidenceExportService,
  PgEvidenceExportService,
  type EvidenceExportService,
} from '../evidence-export-service.js';
import type { RateLimiter, RouteRateLimit } from '../rate-limit.js';
import { sendError, sendValidationError } from './http-errors.js';

const params = z.object({ caseId: z.string().uuid() });
/** A sha256 hex digest and nothing else — no probing through the verifier. */
const verifyQuery = z.object({ hash: z.string().regex(/^[0-9a-fA-F]{64}$/) });

const MINUTE_MS = 60_000;
export const EVIDENCE_EXPORT_RATE_LIMITS = {
  export: { max: 5, timeWindow: MINUTE_MS, bucket: 'export' },
  verify: { max: 20, timeWindow: MINUTE_MS, bucket: 'verify' },
} as const satisfies Record<string, RouteRateLimit>;

function makeEvidenceRateLimit(
  limiter: RateLimiter,
  policy: RouteRateLimit,
): preHandlerHookHandler {
  return async (request, reply) => {
    const principal = request.actor
      ? `${request.actor.tenantId}:${request.actor.userId}`
      : `unauthenticated:${request.ip}`;
    const decision = await limiter.consume(
      `evidence-export:${policy.bucket}:${principal}`,
      policy.max,
      policy.timeWindow,
    );
    if (decision.allowed) return;
    if (decision.retryAfterSeconds) reply.header('retry-after', decision.retryAfterSeconds);
    sendError(request, reply, 429, 'RATE_LIMITED');
  };
}

/**
 * Unified evidence export & verification journey (capability #10).
 *
 * GET /cases/:caseId/evidence-export — manager/owner-only, rate limited —
 * returns the chronological audit + timeline metadata manifest for the case
 * with a deterministic sha256, and writes the `evidence.exported` audit
 * receipt. GET …/evidence-export/verify?hash=… re-computes the hash and
 * reports integrity. Metadata only — never document bytes or message bodies.
 */
export function registerEvidenceExportRoutes(
  app: FastifyInstance,
  container: Container,
  rateLimiter: RateLimiter,
  serviceOverride?: EvidenceExportService,
): void {
  const auth = makeAuthenticate(container.auth, container.actorResolver);
  const service =
    serviceOverride ??
    (container.pool
      ? new PgEvidenceExportService(container.pool)
      : new InMemoryEvidenceExportService({
          getCase: container.getCase,
          listDocuments: container.listDocuments,
          listTasks: container.listTasks,
          readAuditEvents: () =>
            container.audit instanceof InMemoryAuditService ? container.audit.events : [],
          readTimelineEvents: () =>
            container.timeline instanceof InMemoryTimelineService ? container.timeline.events : [],
          audit: container.audit,
          // In-memory mode resolves the actor's tenant-wide role through the
          // same authenticated read the Family Access page uses.
          resolveRole: async (actor) => {
            const access = await container.listFamilyMembers.execute(actor).catch(() => null);
            return access?.members.find((member) => member.isCurrentUser)?.role ?? null;
          },
        }));

  const authorize = async (actor: NonNullable<FastifyRequest['actor']>, caseId: string) =>
    container.getCase.execute(actor, caseId).catch(() => null);

  const failWith = (
    req: FastifyRequest,
    reply: Parameters<typeof sendError>[1],
    error: unknown,
  ): void => {
    const message = error instanceof Error ? error.message : '';
    if (message === 'forbidden_role') return sendError(req, reply, 403, 'FORBIDDEN');
    if (message === 'case_not_found') return sendError(req, reply, 404, 'NOT_FOUND');
    throw error;
  };

  app.get<{ Params: { caseId: string } }>(
    '/cases/:caseId/evidence-export',
    {
      config: { rateLimit: EVIDENCE_EXPORT_RATE_LIMITS.export },
      preHandler: [auth, makeEvidenceRateLimit(rateLimiter, EVIDENCE_EXPORT_RATE_LIMITS.export)],
    },
    async (req, reply) => {
      const p = params.safeParse(req.params);
      if (!p.success) return sendValidationError(req, reply, p.error);
      if (!req.actor) return;
      // Case access first: another tenant's case stays an indistinguishable 404.
      if (!(await authorize(req.actor, p.data.caseId)))
        return sendError(req, reply, 404, 'NOT_FOUND');
      try {
        return await service.export(req.actor, p.data.caseId);
      } catch (error) {
        return failWith(req, reply, error);
      }
    },
  );

  app.get<{ Params: { caseId: string }; Querystring: { hash?: string } }>(
    '/cases/:caseId/evidence-export/verify',
    {
      config: { rateLimit: EVIDENCE_EXPORT_RATE_LIMITS.verify },
      preHandler: [auth, makeEvidenceRateLimit(rateLimiter, EVIDENCE_EXPORT_RATE_LIMITS.verify)],
    },
    async (req, reply) => {
      const p = params.safeParse(req.params);
      if (!p.success) return sendValidationError(req, reply, p.error);
      const q = verifyQuery.safeParse(req.query);
      if (!q.success) return sendValidationError(req, reply, q.error);
      if (!req.actor) return;
      if (!(await authorize(req.actor, p.data.caseId)))
        return sendError(req, reply, 404, 'NOT_FOUND');
      try {
        return await service.verify(req.actor, p.data.caseId, q.data.hash);
      } catch (error) {
        return failWith(req, reply, error);
      }
    },
  );
}
