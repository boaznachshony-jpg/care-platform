import { createHash } from 'node:crypto';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { createEventPlan, EVENT_TYPES, type EventActionPlan } from '@caredesk/application';
import { withTenant } from '@caredesk/db';
import type { Container } from '../container.js';
import { makeAuthenticate } from '../plugins/authenticate.js';
import { sendError, sendValidationError } from './http-errors.js';
import type { RateLimiter, RouteRateLimit } from '../rate-limit.js';

const caseParams = z.object({ caseId: z.string().uuid() });
/**
 * Only a confirmed plan may be committed: a cancelled or malformed plan fails
 * validation here and never mutates the case (fail-closed by construction).
 */
const commitBody = z.object({
  eventType: z.enum(EVENT_TYPES),
  answers: z
    .array(
      z.object({
        questionId: z.string().trim().min(1).max(80),
        value: z.union([z.string().max(400), z.boolean()]),
      }),
    )
    .max(20),
  status: z.literal('confirmed'),
});

interface CommittedItem {
  itemId: string;
  kind: 'check' | 'create_task' | 'open_workflow' | 'professional_review';
  labelKey: string;
  taskId: string | null;
}

interface CommitReceiptResponse {
  planId: string | null;
  receiptId: string;
  confirmationId: string;
  eventType: (typeof EVENT_TYPES)[number];
  eventDate: string | null;
  uncertainties: string[];
  committedItems: CommittedItem[];
  replayed: boolean;
}

const MINUTE_MS = 60_000;
export const EVENT_ACTION_PLAN_RATE_LIMITS = {
  commit: { max: 10, timeWindow: MINUTE_MS, bucket: 'event-plan-commit' },
} as const satisfies Record<string, RouteRateLimit>;

function makeEventPlanRateLimit(
  limiter: RateLimiter,
  policy: RouteRateLimit,
): preHandlerHookHandler {
  return async (request, reply) => {
    const principal = request.actor
      ? `${request.actor.tenantId}:${request.actor.userId}`
      : `unauthenticated:${request.ip}`;
    const decision = await limiter.consume(
      `event-action-plan:${policy.bucket}:${principal}`,
      policy.max,
      policy.timeWindow,
    );
    if (decision.allowed) return;
    if (decision.retryAfterSeconds) reply.header('retry-after', decision.retryAfterSeconds);
    sendError(request, reply, 429, 'RATE_LIMITED');
  };
}

/**
 * Authenticated, idempotent Event Wizard plan commit. The plan is rebuilt
 * server-side from the submitted answers against canonical case facts
 * (deterministic — no AI provider), executed exactly once through the
 * canonical task service, evidenced in Timeline/Audit, persisted in the
 * durable `event_action_plan` foundation, and receipted in
 * `automation_execution_receipt` for replay.
 */
export function registerEventActionPlanRoutes(
  app: FastifyInstance,
  container: Container,
  rateLimiter: RateLimiter,
): void {
  const authenticate = makeAuthenticate(container.auth, container.actorResolver);

  app.post<{ Params: { caseId: string } }>(
    '/cases/:caseId/event-plans',
    {
      config: { rateLimit: EVENT_ACTION_PLAN_RATE_LIMITS.commit },
      preHandler: [
        authenticate,
        makeEventPlanRateLimit(rateLimiter, EVENT_ACTION_PLAN_RATE_LIMITS.commit),
      ],
    },
    async (request, reply) => {
      const params = caseParams.safeParse(request.params);
      const body = commitBody.safeParse(request.body);
      if (!params.success) return sendValidationError(request, reply, params.error);
      if (!body.success) return sendValidationError(request, reply, body.error);
      const actor = request.actor;
      if (!actor) return;
      // Server-derived tenant authority: cross-tenant or unknown cases read as
      // absent and nothing is written.
      const graph = await container.getCase.execute(actor, params.data.caseId).catch(() => null);
      if (!graph) return sendError(request, reply, 404, 'NOT_FOUND');
      const key = request.headers['idempotency-key'];
      if (typeof key !== 'string' || key.length < 8 || key.length > 200)
        return sendError(request, reply, 400, 'IDEMPOTENCY_KEY_REQUIRED');

      // Deterministic server-side rebuild of the plan from canonical facts.
      // Rule context comes exclusively from the regulation lifecycle's
      // active-only query (migration 0032): status='active' rules inside their
      // effective window — draft/in-review/approved/retired never leak here.
      const rulesAsOf = new Date().toISOString().slice(0, 10);
      const [documents, activeRules] = await Promise.all([
        container.listDocuments.execute(actor, params.data.caseId),
        container.regulationRules.listActiveForContext(actor, rulesAsOf),
      ]);
      let plan: EventActionPlan;
      try {
        plan = createEventPlan(body.data.eventType, body.data.answers, {
          caseId: params.data.caseId,
          documents: documents.map((item) => ({
            type: item.document.documentType,
            expiresAt: item.document.expiresAt,
          })),
          approvedRules: activeRules.map((rule) => ({
            id: rule.id,
            version: String(rule.version),
          })),
        });
      } catch {
        return sendError(request, reply, 422, 'PLAN_INVALID');
      }

      const requestHash = createHash('sha256')
        .update(
          JSON.stringify({
            caseId: params.data.caseId,
            eventType: body.data.eventType,
            answers: body.data.answers,
          }),
        )
        .digest('hex');
      const claim = await container.automationReceipts.claim<CommitReceiptResponse>(
        actor.tenantId,
        {
          operation: 'event_plan_commit',
          idempotencyKey: key,
          requestHash,
          employmentCaseId: params.data.caseId,
          createdBy: actor.userId,
        },
      );
      if (claim.outcome === 'replay')
        return reply.status(200).send({ ...(claim.receipt.response ?? {}), replayed: true });
      if (claim.outcome === 'in_progress')
        return sendError(request, reply, 409, 'COMMIT_IN_PROGRESS');
      if (claim.outcome === 'hash_mismatch')
        return sendError(request, reply, 409, 'IDEMPOTENCY_KEY_REUSED');

      try {
        const now = new Date().toISOString();
        // Exactly-once execution through the canonical task service: each
        // actionable step becomes a governed task with its own Timeline/Audit.
        const committedItems: CommittedItem[] = [];
        for (const item of plan.items) {
          if (item.kind === 'check') {
            committedItems.push({
              itemId: item.id,
              kind: item.kind,
              labelKey: item.labelKey,
              taskId: null,
            });
            continue;
          }
          const task = await container.createTask.execute(actor, params.data.caseId, {
            title: item.labelKey,
          });
          committedItems.push({
            itemId: item.id,
            kind: item.kind,
            labelKey: item.labelKey,
            taskId: task.id,
          });
        }

        // Durable committed plan row (canonical Wave 4 foundation).
        let planId: string | null = null;
        if (container.pool) {
          planId = await withTenant(container.pool, actor.tenantId, async (client) => {
            const inserted = await client.query<{ id: string }>(
              `insert into event_action_plan
                 (tenant_id, employment_case_id, event_type, event_date, status, answers,
                  committed_items, idempotency_key, confirmed_by, confirmed_at)
               values ($1,$2,$3,$4,'confirmed',$5,$6,$7,$8,$9)
               on conflict (tenant_id, idempotency_key) do nothing
               returning id`,
              [
                actor.tenantId,
                params.data.caseId,
                plan.eventType,
                plan.eventDate,
                JSON.stringify(body.data.answers),
                JSON.stringify(committedItems),
                key,
                actor.userId,
                now,
              ],
            );
            if (inserted.rows[0]) return inserted.rows[0].id;
            const existing = await client.query<{ id: string }>(
              `select id from event_action_plan where idempotency_key = $1`,
              [key],
            );
            return existing.rows[0]?.id ?? null;
          });
        }

        // Plan-level Timeline/Audit evidence for the commit itself.
        await container.timeline.record({
          tenantId: actor.tenantId,
          employmentCaseId: params.data.caseId,
          eventTypeKey: 'timeline.automation.event_plan_committed',
          occurredAt: now,
          summaryKey: 'timeline.automation.event_plan_committed.summary',
          sensitivity: 'general',
        });
        await container.audit.record({
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'event_plan.committed',
          resourceType: 'event_action_plan',
          resourceId: planId ?? claim.receiptId,
          correlationId: actor.correlationId,
          occurredAt: now,
          changeSummary: `Event plan ${plan.eventType} committed ${committedItems.filter((item) => item.taskId).length} task(s).`,
          sensitivity: 'employment_sensitive',
        });

        const result: CommitReceiptResponse = {
          planId,
          receiptId: claim.receiptId,
          confirmationId: claim.receiptId,
          eventType: plan.eventType,
          eventDate: plan.eventDate,
          uncertainties: plan.uncertainties,
          committedItems,
          replayed: false,
        };
        await container.automationReceipts.complete(actor.tenantId, claim.receiptId, result);
        reply.status(201).send(result);
      } catch (error) {
        // Release the claim so a retry with the same key can execute.
        await container.automationReceipts.fail(actor.tenantId, claim.receiptId);
        throw error;
      }
    },
  );
}
