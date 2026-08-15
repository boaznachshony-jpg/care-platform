import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import {
  projectCaseHealth,
  validateAssistantResponse,
  type HealthFactor,
} from '@caredesk/application';
import { withTenant } from '@caredesk/db';
import type { Container } from '../container.js';
import { makeAuthenticate } from '../plugins/authenticate.js';
import { sendError, sendValidationError } from './http-errors.js';
import type { RateLimiter, RouteRateLimit } from '../rate-limit.js';

const caseParams = z.object({ caseId: z.string().uuid() });
const reviewBody = z.object({
  category: z.enum([
    'payroll',
    'employment',
    'visa_authorization',
    'document',
    'termination',
    'general',
  ]),
  reason: z.string().trim().min(3).max(500),
  summary: z.string().trim().min(3).max(1000),
  source: z.enum(['case_ai', 'event_wizard', 'regulation_engine', 'caredesk_score', 'manual']),
  relatedEntityType: z.string().max(50).optional(),
  relatedEntityId: z.string().uuid().optional(),
});
const assistantBody = z.object({
  question: z.string().trim().min(3).max(500),
  intent: z.enum(['travel_check', 'missing_file_facts', 'explain_attention', 'checklist']),
});
const checklistBody = z.object({
  items: z.array(z.string().trim().min(1).max(160)).min(1).max(25),
});

interface ReviewRow {
  id: string;
  employmentCaseId: string;
  category: z.infer<typeof reviewBody>['category'];
  reason: string;
  summary: string;
  source: z.infer<typeof reviewBody>['source'];
  status: 'draft' | 'open' | 'in_review' | 'resolved' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

const MINUTE_MS = 60_000;
export const PRODUCT_DIFFERENTIATION_RATE_LIMITS = {
  health: { max: 60, timeWindow: MINUTE_MS, bucket: 'health' },
  assistant: { max: 10, timeWindow: MINUTE_MS, bucket: 'assistant' },
  checklistConfirmation: { max: 20, timeWindow: MINUTE_MS, bucket: 'checklist' },
  reviewList: { max: 60, timeWindow: MINUTE_MS, bucket: 'review-list' },
  reviewCreate: { max: 10, timeWindow: MINUTE_MS, bucket: 'review-create' },
} as const satisfies Record<string, RouteRateLimit>;

/**
 * Uses the repository's provider-neutral limiter after authentication. The key
 * is scoped to tenant and user so one family cannot consume another's quota;
 * IP is only a fail-closed fallback if this hook is ever ordered incorrectly.
 */
function makeProductRateLimit(limiter: RateLimiter, policy: RouteRateLimit): preHandlerHookHandler {
  return async (request, reply) => {
    const principal = request.actor
      ? `${request.actor.tenantId}:${request.actor.userId}`
      : `unauthenticated:${request.ip}`;
    const decision = await limiter.consume(
      `product-differentiation:${policy.bucket}:${principal}`,
      policy.max,
      policy.timeWindow,
    );
    if (decision.allowed) return;
    if (decision.retryAfterSeconds) reply.header('retry-after', decision.retryAfterSeconds);
    sendError(request, reply, 429, 'RATE_LIMITED');
  };
}

/** Authenticated completion-wave APIs. Case authorization always precedes data access. */
export function registerProductDifferentiationRoutes(
  app: FastifyInstance,
  container: Container,
  rateLimiter: RateLimiter,
): void {
  const authenticate = makeAuthenticate(container.auth, container.actorResolver);
  const memoryReviews = new Map<string, ReviewRow>();
  const idempotency = new Map<string, unknown>();

  async function authorizeCase(request: FastifyRequest, reply: FastifyReply, caseId: string) {
    const actor = request.actor;
    if (!actor) return null;
    const graph = await container.getCase.execute(actor, caseId).catch(() => null);
    if (!graph) {
      sendError(request, reply, 404, 'NOT_FOUND');
      return null;
    }
    return { actor, graph };
  }

  app.get<{ Params: { caseId: string } }>(
    '/cases/:caseId/health',
    {
      config: { rateLimit: PRODUCT_DIFFERENTIATION_RATE_LIMITS.health },
      preHandler: [
        authenticate,
        makeProductRateLimit(rateLimiter, PRODUCT_DIFFERENTIATION_RATE_LIMITS.health),
      ],
    },
    async (request, reply) => {
      const params = caseParams.safeParse(request.params);
      if (!params.success) return sendValidationError(request, reply, params.error);
      const authorized = await authorizeCase(request, reply, params.data.caseId);
      if (!authorized) return;
      const [tasks, documents] = await Promise.all([
        container.listTasks.execute(authorized.actor, params.data.caseId),
        container.listDocuments.execute(authorized.actor, params.data.caseId),
      ]);
      const documentFactor = (
        id: string,
        title: string,
        type: string,
        weight: number,
      ): HealthFactor => {
        const matches = documents.filter((document) => document.document.documentType === type);
        const healthy = matches.some((document) => document.document.complianceStatus === 'valid');
        return {
          id,
          title,
          status: healthy ? 'good' : 'attention',
          points: healthy ? weight : 0,
          weight,
          explanation: healthy
            ? 'A valid document is stored in the case'
            : 'No currently valid document was found',
          recommendedAction: healthy ? undefined : 'Upload or review the document',
          actionTarget: healthy ? undefined : `/cases/${params.data.caseId}#documents`,
          provenance: {
            sourceType: 'document',
            sourceIds: matches.map((item) => item.document.id),
          },
        };
      };
      const openTasks = tasks.filter((task) => task.status !== 'completed');
      const factors: HealthFactor[] = [
        documentFactor('passport', 'Passport', 'passport', 25),
        documentFactor('visa', 'Visa / authorization', 'visa', 25),
        documentFactor('medical_insurance', 'Medical insurance', 'medical_insurance', 25),
        {
          id: 'governed_tasks',
          title: 'Open governed tasks',
          status: openTasks.length ? 'attention' : 'good',
          points: openTasks.length ? 0 : 25,
          weight: 25,
          explanation: openTasks.length
            ? `${openTasks.length} open task(s) require attention`
            : 'No open tasks',
          recommendedAction: openTasks.length ? 'Review open tasks' : undefined,
          actionTarget: openTasks.length ? `/cases/${params.data.caseId}#tasks` : undefined,
          provenance: { sourceType: 'task', sourceIds: openTasks.map((task) => task.id) },
        },
      ];
      reply.send(projectCaseHealth(factors));
    },
  );

  app.post<{ Params: { caseId: string } }>(
    '/cases/:caseId/assistant',
    {
      config: { rateLimit: PRODUCT_DIFFERENTIATION_RATE_LIMITS.assistant },
      preHandler: [
        authenticate,
        makeProductRateLimit(rateLimiter, PRODUCT_DIFFERENTIATION_RATE_LIMITS.assistant),
      ],
    },
    async (request, reply) => {
      const params = caseParams.safeParse(request.params);
      const body = assistantBody.safeParse(request.body);
      if (!params.success) return sendValidationError(request, reply, params.error);
      if (!body.success) return sendValidationError(request, reply, body.error);
      const authorized = await authorizeCase(request, reply, params.data.caseId);
      if (!authorized) return;
      const [tasks, documents] = await Promise.all([
        container.listTasks.execute(authorized.actor, params.data.caseId),
        container.listDocuments.execute(authorized.actor, params.data.caseId),
      ]);
      const context = {
        caseSummary: { caseId: params.data.caseId, status: authorized.graph.employmentCase.status },
        caregiverSummary: {
          displayName:
            authorized.graph.caregiver.preferredName ?? authorized.graph.caregiver.legalName,
        },
        documentStatusSummary: documents.map((item) => ({
          documentId: item.document.id,
          type: item.document.documentType,
          expiresAt: item.document.expiresAt,
          status: item.document.complianceStatus,
        })),
        activeTasks: tasks
          .filter((task) => task.status !== 'completed')
          .map((task) => ({
            id: task.id,
            title: task.title ?? task.titleKey ?? 'Task',
            dueAt: task.dueAt,
          })),
        relevantTimelineEvents: [],
        relevantApprovedRules: [],
      };
      const missing = ['passport', 'visa', 'medical_insurance'].filter(
        (type) =>
          !context.documentStatusSummary.some(
            (document) => document.type === type && document.status === 'valid',
          ),
      );
      const checklist =
        body.data.intent === 'checklist' || body.data.intent === 'travel_check'
          ? [
              'Review passport validity',
              'Review visa / authorization validity',
              'Review medical insurance dates',
            ]
          : undefined;
      const response = validateAssistantResponse(
        {
          answer: missing.length
            ? `Your CareDesk file is missing valid evidence for: ${missing.join(', ')}.`
            : `The stored case facts show valid core documents. ${context.activeTasks.length} open task(s) remain.`,
          factsUsed: [
            { factPath: 'caseSummary.status', label: `Case status: ${context.caseSummary.status}` },
            ...context.documentStatusSummary.map((_item, index) => ({
              factPath: `documentStatusSummary.${index}.status`,
              label: `Stored document ${index + 1} status`,
            })),
          ],
          uncertainties: context.relevantApprovedRules.length
            ? []
            : [
                {
                  code: 'no_approved_rule',
                  message: 'No approved rule was available for professional interpretation.',
                },
              ],
          recommendedActions: [
            ...(missing.length
              ? [
                  {
                    type: 'upload_document' as const,
                    label: 'Upload missing evidence',
                    mutatesCase: false,
                  },
                ]
              : []),
            ...(checklist
              ? [
                  {
                    type: 'create_checklist' as const,
                    label: 'Create these tasks',
                    mutatesCase: true,
                  },
                ]
              : []),
            {
              type: 'request_professional_review' as const,
              label: 'Request professional review',
              mutatesCase: true,
            },
          ],
          proposedChecklist: checklist,
          escalation: {
            required: true,
            reason: 'No approved rule covers professional interpretation',
          },
        },
        context,
      );
      reply.send({
        ...response,
        groundingLabel: 'Based on your CareDesk file',
        providerStatus: 'deterministic_fallback',
      });
    },
  );

  app.post<{ Params: { caseId: string } }>(
    '/cases/:caseId/assistant/checklist-confirmations',
    {
      config: { rateLimit: PRODUCT_DIFFERENTIATION_RATE_LIMITS.checklistConfirmation },
      preHandler: [
        authenticate,
        makeProductRateLimit(
          rateLimiter,
          PRODUCT_DIFFERENTIATION_RATE_LIMITS.checklistConfirmation,
        ),
      ],
    },
    async (request, reply) => {
      const params = caseParams.safeParse(request.params);
      const body = checklistBody.safeParse(request.body);
      if (!params.success) return sendValidationError(request, reply, params.error);
      if (!body.success) return sendValidationError(request, reply, body.error);
      const authorized = await authorizeCase(request, reply, params.data.caseId);
      if (!authorized) return;
      const key = request.headers['idempotency-key'];
      if (typeof key !== 'string' || key.length < 8)
        return sendError(request, reply, 400, 'IDEMPOTENCY_KEY_REQUIRED');
      const cacheKey = `${authorized.actor.tenantId}:${key}`;
      if (idempotency.has(cacheKey)) return reply.send(idempotency.get(cacheKey));
      const created = [];
      for (const title of body.data.items)
        created.push(
          await container.createTask.execute(authorized.actor, params.data.caseId, { title }),
        );
      const result = { created, confirmationId: randomUUID() };
      idempotency.set(cacheKey, result);
      reply.status(201).send(result);
    },
  );

  app.get<{ Params: { caseId: string } }>(
    '/cases/:caseId/professional-reviews',
    {
      config: { rateLimit: PRODUCT_DIFFERENTIATION_RATE_LIMITS.reviewList },
      preHandler: [
        authenticate,
        makeProductRateLimit(rateLimiter, PRODUCT_DIFFERENTIATION_RATE_LIMITS.reviewList),
      ],
    },
    async (request, reply) => {
      const params = caseParams.safeParse(request.params);
      if (!params.success) return sendValidationError(request, reply, params.error);
      const authorized = await authorizeCase(request, reply, params.data.caseId);
      if (!authorized) return;
      if (!container.pool)
        return reply.send(
          [...memoryReviews.values()].filter((row) => row.employmentCaseId === params.data.caseId),
        );
      const rows = await withTenant(
        container.pool,
        authorized.actor.tenantId,
        async (client) =>
          (
            await client.query(
              `select id, employment_case_id as "employmentCaseId", category, reason, summary, source, status, created_at as "createdAt", updated_at as "updatedAt" from professional_review_request where employment_case_id=$1 order by created_at desc`,
              [params.data.caseId],
            )
          ).rows,
      );
      reply.send(rows);
    },
  );

  app.post<{ Params: { caseId: string } }>(
    '/cases/:caseId/professional-reviews',
    {
      config: { rateLimit: PRODUCT_DIFFERENTIATION_RATE_LIMITS.reviewCreate },
      preHandler: [
        authenticate,
        makeProductRateLimit(rateLimiter, PRODUCT_DIFFERENTIATION_RATE_LIMITS.reviewCreate),
      ],
    },
    async (request, reply) => {
      const params = caseParams.safeParse(request.params);
      const body = reviewBody.safeParse(request.body);
      if (!params.success) return sendValidationError(request, reply, params.error);
      if (!body.success) return sendValidationError(request, reply, body.error);
      const authorized = await authorizeCase(request, reply, params.data.caseId);
      if (!authorized) return;
      const key = request.headers['idempotency-key'];
      if (typeof key !== 'string' || key.length < 8)
        return sendError(request, reply, 400, 'IDEMPOTENCY_KEY_REQUIRED');
      const now = new Date().toISOString();
      const row: ReviewRow = {
        id: randomUUID(),
        employmentCaseId: params.data.caseId,
        ...body.data,
        status: 'open',
        createdAt: now,
        updatedAt: now,
      };
      if (container.pool) {
        const saved = await withTenant(
          container.pool,
          authorized.actor.tenantId,
          async (client) =>
            (
              await client.query(
                `insert into professional_review_request (tenant_id,id,employment_case_id,created_by,category,reason,summary,source,related_entity_type,related_entity_id,idempotency_key) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (tenant_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning id, employment_case_id as "employmentCaseId", category, reason, summary, source, status, created_at as "createdAt", updated_at as "updatedAt"`,
                [
                  authorized.actor.tenantId,
                  row.id,
                  params.data.caseId,
                  authorized.actor.userId,
                  body.data.category,
                  body.data.reason,
                  body.data.summary,
                  body.data.source,
                  body.data.relatedEntityType ?? null,
                  body.data.relatedEntityId ?? null,
                  key,
                ],
              )
            ).rows[0],
        );
        await container.audit.record({
          tenantId: authorized.actor.tenantId,
          actorId: authorized.actor.userId,
          action: 'professional_review.created',
          resourceType: 'professional_review_request',
          resourceId: saved.id,
          correlationId: authorized.actor.correlationId,
          occurredAt: now,
          changeSummary: `Review category ${body.data.category} created.`,
          sensitivity: 'employment_sensitive',
        });
        return reply.status(201).send(saved);
      }
      const cacheKey = `${authorized.actor.tenantId}:${key}`;
      const existing = idempotency.get(cacheKey);
      if (existing) return reply.send(existing);
      memoryReviews.set(row.id, row);
      idempotency.set(cacheKey, row);
      reply.status(201).send(row);
    },
  );
}
