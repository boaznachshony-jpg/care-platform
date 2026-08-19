import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { Container } from '../container.js';
import { makeAuthenticate } from '../plugins/authenticate.js';
import {
  BINDER_SECTIONS,
  InMemoryBinderExportService,
  PgBinderExportService,
  type BinderExportService,
} from '../binder-export-service.js';
import type { RateLimiter, RouteRateLimit } from '../rate-limit.js';
import { sendError, sendValidationError } from './http-errors.js';

const params = z.object({ caseId: z.string().uuid() });

/**
 * The explicit selection manifest. Nothing is implied: a section or document
 * that was not named here was not exported, and every document id must belong
 * to the case (verified server-side) before a receipt exists.
 */
const body = z
  .object({
    sections: z.array(z.enum(BINDER_SECTIONS)).min(1).max(BINDER_SECTIONS.length),
    documentIds: z.array(z.string().uuid()).max(200).default([]),
  })
  .strict()
  .refine((value) => value.documentIds.length === 0 || value.sections.includes('documents'), {
    path: ['documentIds'],
    message: 'documentIds requires the documents section',
  });

const MINUTE_MS = 60_000;
export const BINDER_EXPORT_RATE_LIMITS = {
  list: { max: 60, timeWindow: MINUTE_MS, bucket: 'list' },
  create: { max: 10, timeWindow: MINUTE_MS, bucket: 'create' },
} as const satisfies Record<string, RouteRateLimit>;

function makeBinderRateLimit(limiter: RateLimiter, policy: RouteRateLimit): preHandlerHookHandler {
  return async (request, reply) => {
    const principal = request.actor
      ? `${request.actor.tenantId}:${request.actor.userId}`
      : `unauthenticated:${request.ip}`;
    const decision = await limiter.consume(
      `binder-export:${policy.bucket}:${principal}`,
      policy.max,
      policy.timeWindow,
    );
    if (decision.allowed) return;
    if (decision.retryAfterSeconds) reply.header('retry-after', decision.retryAfterSeconds);
    sendError(request, reply, 429, 'RATE_LIMITED');
  };
}

/**
 * Emergency Binder export receipts. POST records an export (employer/manager
 * only, idempotent, rate limited); GET lists prior receipts. There is — on
 * purpose — no public sharing route here: Binder sharing stays disabled
 * (fail-closed), and a receipt never grants access to the exported content.
 */
export function registerBinderExportRoutes(
  app: FastifyInstance,
  container: Container,
  rateLimiter: RateLimiter,
  serviceOverride?: BinderExportService,
): void {
  const auth = makeAuthenticate(container.auth, container.actorResolver);
  const service =
    serviceOverride ??
    (container.pool
      ? new PgBinderExportService(container.pool)
      : new InMemoryBinderExportService({
          getCase: container.getCase,
          listDocuments: container.listDocuments,
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
    if (message === 'document_not_in_case')
      return sendError(req, reply, 400, 'MANIFEST_DOCUMENT_NOT_IN_CASE');
    if (message === 'idempotency_conflict')
      return sendError(req, reply, 409, 'IDEMPOTENCY_CONFLICT');
    throw error;
  };

  app.post<{ Params: { caseId: string } }>(
    '/cases/:caseId/binder-exports',
    {
      config: { rateLimit: BINDER_EXPORT_RATE_LIMITS.create },
      preHandler: [auth, makeBinderRateLimit(rateLimiter, BINDER_EXPORT_RATE_LIMITS.create)],
    },
    async (req, reply) => {
      const p = params.safeParse(req.params);
      if (!p.success) return sendValidationError(req, reply, p.error);
      const b = body.safeParse(req.body);
      if (!b.success) return sendValidationError(req, reply, b.error);
      const key = req.headers['idempotency-key'];
      if (typeof key !== 'string' || key.length < 8 || key.length > 200)
        return sendError(req, reply, 400, 'IDEMPOTENCY_KEY_REQUIRED');
      if (!req.actor) return;
      // Case access first: another tenant's case stays an indistinguishable 404.
      if (!(await authorize(req.actor, p.data.caseId)))
        return sendError(req, reply, 404, 'NOT_FOUND');
      try {
        const result = await service.create(req.actor, p.data.caseId, b.data, key);
        return reply.status(result.replayed ? 200 : 201).send(result);
      } catch (error) {
        return failWith(req, reply, error);
      }
    },
  );

  app.get<{ Params: { caseId: string } }>(
    '/cases/:caseId/binder-exports',
    {
      config: { rateLimit: BINDER_EXPORT_RATE_LIMITS.list },
      preHandler: [auth, makeBinderRateLimit(rateLimiter, BINDER_EXPORT_RATE_LIMITS.list)],
    },
    async (req, reply) => {
      const p = params.safeParse(req.params);
      if (!p.success) return sendValidationError(req, reply, p.error);
      if (!req.actor) return;
      if (!(await authorize(req.actor, p.data.caseId)))
        return sendError(req, reply, 404, 'NOT_FOUND');
      try {
        return await service.list(req.actor, p.data.caseId);
      } catch (error) {
        return failWith(req, reply, error);
      }
    },
  );
}
