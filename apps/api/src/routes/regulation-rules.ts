import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { Container } from '../container.js';
import { makeAuthenticate } from '../plugins/authenticate.js';
import type { RateLimiter, RouteRateLimit } from '../rate-limit.js';
import { sendError, sendValidationError } from './http-errors.js';

const ruleParams = z.object({ ruleId: z.string().uuid() });

const createBody = z
  .object({
    ruleKey: z.string().regex(/^[a-z0-9_]{3,80}$/),
    title: z.string().trim().min(3).max(200),
    statement: z.string().trim().min(10).max(2000),
    sourceCitation: z.string().trim().min(3).max(300),
    sourceAuthority: z.string().trim().min(2).max(200).optional(),
    effectiveFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    effectiveTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

const transitionBody = z
  .object({
    status: z.enum(['in_review', 'approved', 'active', 'retired']),
    // Free-text professional reviewer name for a MANUAL review. CareDesk never
    // contacts a provider and never claims legal validation (fail closed).
    reviewedBy: z.string().trim().min(2).max(200).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === 'approved' && !value.reviewedBy) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reviewedBy'],
        message: 'A professional reviewer name is required to approve a rule',
      });
    }
  });

const MINUTE_MS = 60_000;
export const REGULATION_RULE_RATE_LIMITS = {
  list: { max: 60, timeWindow: MINUTE_MS, bucket: 'regulation-list' },
  create: { max: 10, timeWindow: MINUTE_MS, bucket: 'regulation-create' },
  transition: { max: 20, timeWindow: MINUTE_MS, bucket: 'regulation-transition' },
} as const satisfies Record<string, RouteRateLimit>;

function makeRegulationRateLimit(
  limiter: RateLimiter,
  policy: RouteRateLimit,
): preHandlerHookHandler {
  return async (request, reply) => {
    const principal = request.actor
      ? `${request.actor.tenantId}:${request.actor.userId}`
      : `unauthenticated:${request.ip}`;
    const decision = await limiter.consume(
      `regulation-rule:${policy.bucket}:${principal}`,
      policy.max,
      policy.timeWindow,
    );
    if (decision.allowed) return;
    if (decision.retryAfterSeconds) reply.header('retry-after', decision.retryAfterSeconds);
    sendError(request, reply, 429, 'RATE_LIMITED');
  };
}

/**
 * Regulation Engine lifecycle routes (capability #11). Reading is available to
 * every authenticated tenant member; authoring and every lifecycle transition
 * (submit for review, approve with a named professional reviewer, activate,
 * retire) is manager-only, idempotent and audit-evidenced. The transition map
 * is enforced by the service — an illegal jump is rejected with 409, so
 * content can never reach assistant/wizard context without explicit review,
 * approval and activation.
 */
export function registerRegulationRuleRoutes(
  app: FastifyInstance,
  container: Container,
  rateLimiter: RateLimiter,
): void {
  const authenticate = makeAuthenticate(container.auth, container.actorResolver);
  const service = container.regulationRules;

  const failWith = (req: FastifyRequest, reply: FastifyReply, error: unknown): void => {
    const message = error instanceof Error ? error.message : '';
    if (message === 'forbidden_role') return sendError(req, reply, 403, 'MANAGER_REQUIRED');
    if (message === 'rule_not_found') return sendError(req, reply, 404, 'NOT_FOUND');
    if (message === 'invalid_transition') return sendError(req, reply, 409, 'INVALID_TRANSITION');
    if (message === 'reviewer_required') return sendError(req, reply, 400, 'REVIEWER_REQUIRED');
    if (message === 'effective_from_required')
      return sendError(req, reply, 422, 'EFFECTIVE_FROM_REQUIRED');
    if (message === 'rule_exists') return sendError(req, reply, 409, 'RULE_EXISTS');
    if (message === 'idempotency_conflict')
      return sendError(req, reply, 409, 'IDEMPOTENCY_CONFLICT');
    throw error;
  };

  const idempotencyKeyOf = (req: FastifyRequest): string | null => {
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 200) return null;
    return key;
  };

  app.get(
    '/regulation-rules',
    {
      config: { rateLimit: REGULATION_RULE_RATE_LIMITS.list },
      preHandler: [
        authenticate,
        makeRegulationRateLimit(rateLimiter, REGULATION_RULE_RATE_LIMITS.list),
      ],
    },
    async (request, reply) => {
      if (!request.actor) return;
      try {
        return reply.send(await service.list(request.actor));
      } catch (error) {
        return failWith(request, reply, error);
      }
    },
  );

  app.get<{ Params: { ruleId: string } }>(
    '/regulation-rules/:ruleId',
    {
      config: { rateLimit: REGULATION_RULE_RATE_LIMITS.list },
      preHandler: [
        authenticate,
        makeRegulationRateLimit(rateLimiter, REGULATION_RULE_RATE_LIMITS.list),
      ],
    },
    async (request, reply) => {
      const params = ruleParams.safeParse(request.params);
      if (!params.success) return sendValidationError(request, reply, params.error);
      if (!request.actor) return;
      try {
        return reply.send(await service.get(request.actor, params.data.ruleId));
      } catch (error) {
        return failWith(request, reply, error);
      }
    },
  );

  app.post(
    '/regulation-rules',
    {
      config: { rateLimit: REGULATION_RULE_RATE_LIMITS.create },
      preHandler: [
        authenticate,
        makeRegulationRateLimit(rateLimiter, REGULATION_RULE_RATE_LIMITS.create),
      ],
    },
    async (request, reply) => {
      const body = createBody.safeParse(request.body);
      if (!body.success) return sendValidationError(request, reply, body.error);
      if (!request.actor) return;
      const key = idempotencyKeyOf(request);
      if (!key) return sendError(request, reply, 400, 'IDEMPOTENCY_KEY_REQUIRED');
      try {
        const result = await service.create(request.actor, body.data, key);
        return reply.status(result.replayed ? 200 : 201).send(result);
      } catch (error) {
        return failWith(request, reply, error);
      }
    },
  );

  app.patch<{ Params: { ruleId: string } }>(
    '/regulation-rules/:ruleId',
    {
      config: { rateLimit: REGULATION_RULE_RATE_LIMITS.transition },
      preHandler: [
        authenticate,
        makeRegulationRateLimit(rateLimiter, REGULATION_RULE_RATE_LIMITS.transition),
      ],
    },
    async (request, reply) => {
      const params = ruleParams.safeParse(request.params);
      if (!params.success) return sendValidationError(request, reply, params.error);
      const body = transitionBody.safeParse(request.body);
      if (!body.success) return sendValidationError(request, reply, body.error);
      if (!request.actor) return;
      const key = idempotencyKeyOf(request);
      if (!key) return sendError(request, reply, 400, 'IDEMPOTENCY_KEY_REQUIRED');
      try {
        const result = await service.transition(
          request.actor,
          params.data.ruleId,
          body.data.status,
          body.data.reviewedBy,
          key,
        );
        return reply.send(result);
      } catch (error) {
        return failWith(request, reply, error);
      }
    },
  );
}
