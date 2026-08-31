import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { payrollTotalMatches, roundShekels } from '@caredesk/domain';
import type { Container } from '../container.js';
import { makeAuthenticate } from '../plugins/authenticate.js';
import { CanonicalIntelligenceService } from '../product-intelligence/canonical-intelligence-service.js';
import { sendError, sendValidationError } from './http-errors.js';

const paramsSchema = z.object({ caseId: z.string().uuid() });
/** Every close amount is rounded to agorot the way `numeric(12,2)` will store it. */
const closeAmount = z
  .number()
  .finite()
  .min(-10_000_000)
  .max(10_000_000)
  .transform((value) => roundShekels(value));

/**
 * The current month in Israel, stated explicitly rather than inherited from the
 * host clock's zone (the DOM-03 defect, in the place DOM-24 needs it). Root 8
 * replaces this with the single timezone-explicit date type; until it lands,
 * one named helper is better than a second `new Date().toISOString()`.
 */
export function currentPayrollMonthInIsrael(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
  }).format(now);
}

/** Exported for the DOM-14/DOM-24 regression test; the route is its only caller. */
export const closeSchema = z
  .object({
    payrollReference: z.string().trim().min(1).max(200),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    paymentDate: z.string().date(),
    paymentMethod: z.enum(['bank_transfer', 'cash', 'check', 'other']),
    /**
     * DOM-24: was `z.number().positive()`, mirroring `check (total_amount > 0)`
     * in migration 0026. A month where the caregiver was absent unpaid, or
     * where advances exceeded salary, produces an entry the close endpoint
     * rejected forever — the month stayed permanently open and `hasOpenMonth`
     * nagged about it with no way for the user to resolve it. Migration 0041
     * widens the constraint to the same range `payroll_entry.total` has always
     * had, and this now matches it.
     */
    total: closeAmount,
    baseSalary: closeAmount.pipe(z.number().nonnegative()),
    additions: closeAmount.pipe(z.number().nonnegative()),
    deductions: closeAmount.pipe(z.number().nonnegative()),
  })
  /**
   * DOM-14: exact equality on rounded amounts, not a 0.01 tolerance window.
   *
   * The window was looser than the DB constraint it feeds, so
   * `{ baseSalary: 1000.126, additions: 0, deductions: 0, total: 1000.12 }`
   * passed validation (difference 0.006) and then violated
   * `payroll_month_close_amount_reconciles` after `numeric(12,2)` rounded the
   * base to 1000.13 — a bare 500 on the one operation the user cannot retry
   * their way out of. Rounding in the transform above and comparing exactly
   * here makes validation and constraint agree by construction.
   */
  .refine(
    (value) =>
      payrollTotalMatches(value.total, value.baseSalary + value.additions - value.deductions),
    {
      message: 'Close amounts do not reconcile',
      path: ['total'],
    },
  )
  // DOM-24, second half: a future month could be closed today. A close is a
  // statement about a month that has ended.
  .refine((value) => value.month <= currentPayrollMonthInIsrael(), {
    message: 'A future payroll month cannot be closed',
    path: ['month'],
  });

export function registerCanonicalProductIntelligenceRoutes(
  app: FastifyInstance,
  container: Container,
) {
  if (!container.pool) return;
  const authenticate = makeAuthenticate(container.auth, container.actorResolver);
  const service = new CanonicalIntelligenceService(container.pool);

  app.get<{ Params: { caseId: string } }>(
    '/cases/:caseId/payroll-month-closes',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = paramsSchema.safeParse(request.params);
      if (!parsed.success) return sendValidationError(request, reply, parsed.error);
      const actor = request.actor;
      if (!actor) return;
      const authorized = await container.getCase
        .execute(actor, parsed.data.caseId)
        .catch(() => null);
      if (!authorized) return sendError(request, reply, 404, 'NOT_FOUND');
      reply.send(await service.list(actor, parsed.data.caseId));
    },
  );

  app.post<{ Params: { caseId: string } }>(
    '/cases/:caseId/payroll-month-closes',
    { preHandler: authenticate },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      const body = closeSchema.safeParse(request.body);
      if (!params.success) return sendValidationError(request, reply, params.error);
      if (!body.success) return sendValidationError(request, reply, body.error);
      const key = request.headers['idempotency-key'];
      if (typeof key !== 'string' || key.length < 8 || key.length > 200)
        return sendError(request, reply, 400, 'IDEMPOTENCY_KEY_REQUIRED');
      const actor = request.actor;
      if (!actor) return;
      const authorized = await container.getCase
        .execute(actor, params.data.caseId)
        .catch(() => null);
      if (!authorized) return sendError(request, reply, 404, 'NOT_FOUND');
      try {
        const result = await service.close(actor, params.data.caseId, key, body.data);
        reply.status(result.replayed ? 200 : 201).send(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message === 'manager_required') return sendError(request, reply, 403, 'FORBIDDEN');
        if (message === 'case_not_found') return sendError(request, reply, 404, 'NOT_FOUND');
        if (message === 'idempotency_conflict')
          return sendError(request, reply, 409, 'IDEMPOTENCY_CONFLICT');
        throw error;
      }
    },
  );
}
