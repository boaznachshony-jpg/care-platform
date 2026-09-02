import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import {
  CASE_HEALTH_TASK_FACTORS,
  projectCaseHealth,
  validateAssistantResponse,
  type HealthFactor,
} from '@caredesk/application';
import type { DocumentType } from '@caredesk/domain';
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
const reviewParams = z.object({ caseId: z.string().uuid(), reviewId: z.string().uuid() });
const transitionBody = z
  .object({
    status: z.enum(['acknowledged', 'in_review', 'resolved', 'cancelled']),
    // Free-text professional name/contact for a MANUAL handoff. CareDesk never
    // contacts a provider and never claims fulfilment (fail closed by design).
    assignedTo: z.string().trim().min(2).max(200).optional(),
    resolutionNote: z.string().trim().min(3).max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status === 'resolved' && !value.resolutionNote) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['resolutionNote'],
        message: 'A resolution note is required to resolve an escalation',
      });
    }
  });

type ReviewStatus = 'requested' | 'acknowledged' | 'in_review' | 'resolved' | 'cancelled';

/**
 * The only legal escalation lifecycle. Everything else is rejected: the
 * lifecycle is manual/fail-closed evidence, never a provider fulfilment claim.
 */
export const ESCALATION_TRANSITIONS: Record<ReviewStatus, readonly ReviewStatus[]> = {
  requested: ['acknowledged', 'cancelled'],
  acknowledged: ['in_review', 'cancelled'],
  in_review: ['resolved', 'cancelled'],
  resolved: [],
  cancelled: [],
};

interface ReviewRow {
  id: string;
  employmentCaseId: string;
  category: z.infer<typeof reviewBody>['category'];
  reason: string;
  summary: string;
  source: z.infer<typeof reviewBody>['source'];
  status: ReviewStatus;
  assignedTo: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TransitionRow {
  id: string;
  fromStatus: ReviewStatus;
  toStatus: ReviewStatus;
  changedBy: string;
  assignedTo: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

const MINUTE_MS = 60_000;
export const PRODUCT_DIFFERENTIATION_RATE_LIMITS = {
  health: { max: 60, timeWindow: MINUTE_MS, bucket: 'health' },
  assistant: { max: 10, timeWindow: MINUTE_MS, bucket: 'assistant' },
  checklistConfirmation: { max: 20, timeWindow: MINUTE_MS, bucket: 'checklist' },
  reviewList: { max: 60, timeWindow: MINUTE_MS, bucket: 'review-list' },
  reviewCreate: { max: 10, timeWindow: MINUTE_MS, bucket: 'review-create' },
  reviewGet: { max: 60, timeWindow: MINUTE_MS, bucket: 'review-get' },
  reviewTransition: { max: 20, timeWindow: MINUTE_MS, bucket: 'review-transition' },
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
  const memoryTransitions = new Map<string, TransitionRow[]>();
  const idempotency = new Map<string, unknown>();

  const REVIEW_COLUMNS = `id, employment_case_id as "employmentCaseId", category, reason, summary,
       source, status, assigned_to_name as "assignedTo", resolution_note as "resolutionNote",
       resolved_at as "resolvedAt", created_at as "createdAt", updated_at as "updatedAt"`;

  /**
   * Escalation lifecycle mutations are manager-only. With PostgreSQL the
   * active tenant membership role is checked under forced RLS (wave5 pattern).
   * The in-memory fallback exists for development/tests only, where the sole
   * seeded synthetic identity is the tenant owner.
   */
  async function requireManager(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    const actor = request.actor;
    if (!actor) return false;
    if (!container.pool) return true;
    const allowed = await withTenant(container.pool, actor.tenantId, (client) =>
      client.query(
        `select 1 from tenant_membership where tenant_id=$1 and user_id=$2 and status='active' and role in ('owner','manager')`,
        [actor.tenantId, actor.userId],
      ),
    );
    if (allowed.rowCount) return true;
    sendError(request, reply, 403, 'MANAGER_REQUIRED');
    return false;
  }

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
        type: DocumentType,
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
      // Bug fix while wiring task auto-completion to this same factor set: the
      // third documentFactor() argument is compared against a real
      // Document.documentType (packages/domain/src/status.ts DOCUMENT_TYPES),
      // which has no 'medical_insurance' member — only 'insurance_policy'
      // does. Passed literally, this factor could never go 'good' for any
      // document a family could actually upload; it was silently dead.
      // CASE_HEALTH_TASK_FACTORS (@caredesk/application) is now the single
      // source for documentType per factor, shared with the task-seeding and
      // task-auto-completion code this factor set must stay in lockstep with.
      const medicalInsuranceDocumentType = CASE_HEALTH_TASK_FACTORS.find(
        (factor) => factor.sourceKey === 'case_health:medical_insurance',
      )!.documentType;
      const factors: HealthFactor[] = [
        documentFactor('passport', 'Passport', 'passport', 25),
        documentFactor('visa', 'Visa / authorization', 'visa', 25),
        documentFactor('medical_insurance', 'Medical insurance', medicalInsuranceDocumentType, 25),
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
      // Reviewed regulation context (migration 0032): the service query only
      // ever returns status='active' rules whose effective window covers
      // today — draft/in-review/approved/retired content can never leak here.
      const rulesAsOf = new Date().toISOString().slice(0, 10);
      const [tasks, documents, activeRules] = await Promise.all([
        container.listTasks.execute(authorized.actor, params.data.caseId),
        container.listDocuments.execute(authorized.actor, params.data.caseId),
        container.regulationRules.listActiveForContext(authorized.actor, rulesAsOf),
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
        relevantApprovedRules: activeRules.map((rule) => ({
          id: rule.id,
          version: String(rule.version),
          title: rule.title,
        })),
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
      // Every string below is deliberately kept in English: `validateAssistantResponse`
      // and the AssistantResponse consumers (support tooling, evidence exports) rely on
      // that fixed text. A Hebrew-first customer never sees it directly — the reply below
      // attaches a stable *Id (+ params) alongside each string, following the same
      // server-decides/locale-translates/unknown-id-falls-back-to-server-text contract as
      // apps/web/src/health-factors.ts. Losing that identifier is what made the whole
      // assistant answer render in English on the case panel.
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
            ...context.relevantApprovedRules.map((rule, index) => ({
              factPath: `relevantApprovedRules.${index}.title`,
              label: `Approved rule: ${rule.title}`,
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
          // Escalation stays required either way: reviewed content is marked
          // requires_professional_validation, so it informs but never replaces
          // the professional review boundary.
          escalation: {
            required: true,
            reason: context.relevantApprovedRules.length
              ? 'Approved rules were applied; professional validation is still required before reliance'
              : 'No approved rule covers professional interpretation',
          },
        },
        context,
      );
      // Per-fact translation identifiers, positionally aligned with response.factsUsed
      // above (built from the exact same three sources, in the same order).
      const factsMeta: Array<{ labelId: string; labelParams: Record<string, unknown> }> = [
        {
          labelId: 'assistant.fact.caseStatus',
          labelParams: { status: context.caseSummary.status },
        },
        ...context.documentStatusSummary.map((_item, index) => ({
          labelId: 'assistant.fact.documentStatus',
          labelParams: { index: index + 1 },
        })),
        ...context.relevantApprovedRules.map((rule) => ({
          labelId: 'assistant.fact.approvedRule',
          labelParams: { title: rule.title },
        })),
      ];
      reply.send({
        ...response,
        factsUsed: response.factsUsed.map((fact, index) => ({ ...fact, ...factsMeta[index] })),
        answerId: missing.length
          ? 'assistant.answer.missingDocuments'
          : 'assistant.answer.documentsValid',
        answerParams: missing.length
          ? { missingTypes: missing }
          : { count: context.activeTasks.length },
        escalation: {
          ...response.escalation,
          reasonId: context.relevantApprovedRules.length
            ? 'assistant.escalation.reasonRulesApplied'
            : 'assistant.escalation.reasonNoRule',
        },
        groundingLabel: 'Based on your CareDesk file',
        groundingLabelId: 'assistant.groundingLabel',
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
      if (typeof key !== 'string' || key.length < 8 || key.length > 200)
        return sendError(request, reply, 400, 'IDEMPOTENCY_KEY_REQUIRED');
      // Durable tenant-scoped receipt (migration 0029): the claim replaces the
      // old process-memory map, so a replayed request returns the stored
      // receipt and a concurrent duplicate resolves on the unique constraint
      // instead of creating the tasks twice.
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ caseId: params.data.caseId, items: body.data.items }))
        .digest('hex');
      const claim = await container.automationReceipts.claim<Record<string, unknown>>(
        authorized.actor.tenantId,
        {
          operation: 'checklist_confirmation',
          idempotencyKey: key,
          requestHash,
          employmentCaseId: params.data.caseId,
          createdBy: authorized.actor.userId,
        },
      );
      if (claim.outcome === 'replay')
        return reply.status(200).send({ ...(claim.receipt.response ?? {}), replayed: true });
      if (claim.outcome === 'in_progress')
        return sendError(request, reply, 409, 'CONFIRMATION_IN_PROGRESS');
      if (claim.outcome === 'hash_mismatch')
        return sendError(request, reply, 409, 'IDEMPOTENCY_KEY_REUSED');
      try {
        const created = [];
        for (const title of body.data.items)
          created.push(
            await container.createTask.execute(authorized.actor, params.data.caseId, { title }),
          );
        const now = new Date().toISOString();
        await container.timeline.record({
          tenantId: authorized.actor.tenantId,
          employmentCaseId: params.data.caseId,
          eventTypeKey: 'timeline.automation.checklist_confirmed',
          occurredAt: now,
          summaryKey: 'timeline.automation.checklist_confirmed.summary',
          sensitivity: 'general',
        });
        await container.audit.record({
          tenantId: authorized.actor.tenantId,
          actorId: authorized.actor.userId,
          action: 'assistant_checklist.confirmed',
          resourceType: 'automation_execution_receipt',
          resourceId: claim.receiptId,
          correlationId: authorized.actor.correlationId,
          occurredAt: now,
          changeSummary: `Checklist confirmation created ${created.length} task(s).`,
          sensitivity: 'employment_sensitive',
        });
        const result = {
          created,
          confirmationId: claim.receiptId,
          receiptId: claim.receiptId,
          replayed: false,
        };
        await container.automationReceipts.complete(authorized.actor.tenantId, claim.receiptId, {
          ...result,
        });
        reply.status(201).send(result);
      } catch (error) {
        // Release the claim so a retry with the same key can execute.
        await container.automationReceipts.fail(authorized.actor.tenantId, claim.receiptId);
        throw error;
      }
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
              `select ${REVIEW_COLUMNS} from professional_review_request where employment_case_id=$1 order by created_at desc`,
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
        status: 'requested',
        assignedTo: null,
        resolutionNote: null,
        resolvedAt: null,
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
                `insert into professional_review_request (tenant_id,id,employment_case_id,created_by,category,reason,summary,source,related_entity_type,related_entity_id,idempotency_key) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (tenant_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning ${REVIEW_COLUMNS}`,
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

  app.get<{ Params: { caseId: string; reviewId: string } }>(
    '/cases/:caseId/professional-reviews/:reviewId',
    {
      config: { rateLimit: PRODUCT_DIFFERENTIATION_RATE_LIMITS.reviewGet },
      preHandler: [
        authenticate,
        makeProductRateLimit(rateLimiter, PRODUCT_DIFFERENTIATION_RATE_LIMITS.reviewGet),
      ],
    },
    async (request, reply) => {
      const params = reviewParams.safeParse(request.params);
      if (!params.success) return sendValidationError(request, reply, params.error);
      const authorized = await authorizeCase(request, reply, params.data.caseId);
      if (!authorized) return;
      if (!container.pool) {
        const review = memoryReviews.get(params.data.reviewId);
        if (!review || review.employmentCaseId !== params.data.caseId)
          return sendError(request, reply, 404, 'NOT_FOUND');
        return reply.send({ review, history: memoryTransitions.get(review.id) ?? [] });
      }
      const result = await withTenant(container.pool, authorized.actor.tenantId, async (client) => {
        const review = (
          await client.query<ReviewRow>(
            `select ${REVIEW_COLUMNS} from professional_review_request where id=$1 and employment_case_id=$2`,
            [params.data.reviewId, params.data.caseId],
          )
        ).rows[0];
        if (!review) return null;
        const history = (
          await client.query<TransitionRow>(
            `select id, from_status as "fromStatus", to_status as "toStatus", changed_by as "changedBy",
               assigned_to_name as "assignedTo", resolution_note as "resolutionNote", created_at as "createdAt"
             from professional_review_transition where review_id=$1 order by created_at asc`,
            [params.data.reviewId],
          )
        ).rows;
        return { review, history };
      });
      if (!result) return sendError(request, reply, 404, 'NOT_FOUND');
      reply.send(result);
    },
  );

  app.patch<{ Params: { caseId: string; reviewId: string } }>(
    '/cases/:caseId/professional-reviews/:reviewId',
    {
      config: { rateLimit: PRODUCT_DIFFERENTIATION_RATE_LIMITS.reviewTransition },
      preHandler: [
        authenticate,
        makeProductRateLimit(rateLimiter, PRODUCT_DIFFERENTIATION_RATE_LIMITS.reviewTransition),
      ],
    },
    async (request, reply) => {
      const params = reviewParams.safeParse(request.params);
      const body = transitionBody.safeParse(request.body);
      if (!params.success) return sendValidationError(request, reply, params.error);
      if (!body.success) return sendValidationError(request, reply, body.error);
      const authorized = await authorizeCase(request, reply, params.data.caseId);
      if (!authorized) return;
      if (!(await requireManager(request, reply))) return;
      const key = request.headers['idempotency-key'];
      if (typeof key !== 'string' || key.length < 8)
        return sendError(request, reply, 400, 'IDEMPOTENCY_KEY_REQUIRED');
      const now = new Date().toISOString();

      if (!container.pool) {
        // Development/test fallback only (no durable persistence claim).
        const cacheKey = `transition:${authorized.actor.tenantId}:${key}`;
        const replayed = idempotency.get(cacheKey);
        if (replayed) return reply.send(replayed);
        const review = memoryReviews.get(params.data.reviewId);
        if (!review || review.employmentCaseId !== params.data.caseId)
          return sendError(request, reply, 404, 'NOT_FOUND');
        if (!ESCALATION_TRANSITIONS[review.status].includes(body.data.status))
          return sendError(request, reply, 409, 'INVALID_TRANSITION');
        const transition: TransitionRow = {
          id: randomUUID(),
          fromStatus: review.status,
          toStatus: body.data.status,
          changedBy: authorized.actor.userId,
          assignedTo: body.data.assignedTo ?? null,
          resolutionNote: body.data.resolutionNote ?? null,
          createdAt: now,
        };
        review.status = body.data.status;
        review.assignedTo = body.data.assignedTo ?? review.assignedTo;
        review.resolutionNote = body.data.resolutionNote ?? review.resolutionNote;
        review.resolvedAt = body.data.status === 'resolved' ? now : review.resolvedAt;
        review.updatedAt = now;
        memoryTransitions.set(review.id, [...(memoryTransitions.get(review.id) ?? []), transition]);
        idempotency.set(cacheKey, review);
        return reply.send(review);
      }

      const outcome = await withTenant(
        container.pool,
        authorized.actor.tenantId,
        async (client) => {
          const replay = (
            await client.query<{ review_id: string }>(
              `select review_id from professional_review_transition where idempotency_key=$1`,
              [key],
            )
          ).rows[0];
          if (replay) {
            if (replay.review_id !== params.data.reviewId)
              return { kind: 'idempotency_conflict' as const };
            const review = (
              await client.query<ReviewRow>(
                `select ${REVIEW_COLUMNS} from professional_review_request where id=$1 and employment_case_id=$2`,
                [params.data.reviewId, params.data.caseId],
              )
            ).rows[0];
            return review ? { kind: 'replayed' as const, review } : { kind: 'not_found' as const };
          }
          const current = (
            await client.query<{ status: ReviewStatus }>(
              `select status from professional_review_request where id=$1 and employment_case_id=$2 for update`,
              [params.data.reviewId, params.data.caseId],
            )
          ).rows[0];
          if (!current) return { kind: 'not_found' as const };
          if (!ESCALATION_TRANSITIONS[current.status].includes(body.data.status))
            return { kind: 'invalid_transition' as const };
          const review = (
            await client.query<ReviewRow>(
              `update professional_review_request set status=$2,
                 assigned_to_name=coalesce($3, assigned_to_name),
                 resolution_note=coalesce($4, resolution_note),
                 resolved_at=case when $2='resolved' then now() else resolved_at end,
                 updated_at=now()
               where id=$1 returning ${REVIEW_COLUMNS}`,
              [
                params.data.reviewId,
                body.data.status,
                body.data.assignedTo ?? null,
                body.data.resolutionNote ?? null,
              ],
            )
          ).rows[0]!;
          await client.query(
            `insert into professional_review_transition
               (tenant_id, review_id, from_status, to_status, changed_by, assigned_to_name, resolution_note, idempotency_key)
             values ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              authorized.actor.tenantId,
              params.data.reviewId,
              current.status,
              body.data.status,
              authorized.actor.userId,
              body.data.assignedTo ?? null,
              body.data.resolutionNote ?? null,
              key,
            ],
          );
          await client.query(
            `insert into timeline_event (tenant_id, employment_case_id, event_type_key, summary_key, source_type, source_id, sensitivity)
             values ($1,$2,'escalation.status_changed','Professional review status changed.','professional_review_request',$3,'general')`,
            [authorized.actor.tenantId, params.data.caseId, params.data.reviewId],
          );
          return { kind: 'ok' as const, review, fromStatus: current.status };
        },
      );
      if (outcome.kind === 'not_found') return sendError(request, reply, 404, 'NOT_FOUND');
      if (outcome.kind === 'invalid_transition')
        return sendError(request, reply, 409, 'INVALID_TRANSITION');
      if (outcome.kind === 'idempotency_conflict')
        return sendError(request, reply, 409, 'IDEMPOTENCY_CONFLICT');
      if (outcome.kind === 'ok') {
        await container.audit.record({
          tenantId: authorized.actor.tenantId,
          actorId: authorized.actor.userId,
          action: 'professional_review.status_changed',
          resourceType: 'professional_review_request',
          resourceId: outcome.review.id,
          correlationId: authorized.actor.correlationId,
          occurredAt: now,
          changeSummary: `Review status changed from ${outcome.fromStatus} to ${outcome.review.status} (manual handoff).`,
          sensitivity: 'employment_sensitive',
        });
      }
      reply.send(outcome.review);
    },
  );
}
