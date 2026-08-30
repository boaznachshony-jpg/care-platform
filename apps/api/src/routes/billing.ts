import { createHash, timingSafeEqual } from 'node:crypto';
import { AuthorizationError } from '@caredesk/application';
import {
  cardcomWebhookSchema,
  startBillingSetupRequestSchema,
  type BillingCheckoutResponse,
  type BillingPlanResponse,
} from '@caredesk/schemas';
import type { FastifyInstance } from 'fastify';
import { deriveBillingAccessState } from '../billing/access-state.js';
import type { Container } from '../container.js';
import type { Env } from '../env.js';
import { makeAuthenticate } from '../plugins/authenticate.js';
import { requireMfa } from '../plugins/mfa.js';
import { safeErrorDetails } from '../plugins/safe-error.js';
import { sendError, sendValidationError } from './http-errors.js';

function secureEqual(actual: string, expected: string): boolean {
  const left = createHash('sha256').update(actual).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}

function webhookId(value: unknown): string | null {
  const parsed = cardcomWebhookSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data.LowProfileId ?? parsed.data.lowprofilecode ?? parsed.data.lowProfileId ?? null;
}

export function registerBillingRoutes(app: FastifyInstance, container: Container, env: Env): void {
  const authenticate = makeAuthenticate(container.auth, container.actorResolver);
  const options = { preHandler: authenticate };
  const manageOptions = { preHandler: [authenticate, requireMfa(env, 'billing.manage')] };

  app.get('/billing/subscription', options, async (request, reply) => {
    const actor = request.actor;
    if (!actor) return;
    try {
      const plan = await container.getProductSubscription.execute(actor);
      // accessState is derived on every read (never stored): the same plan
      // data plus the clock fully determine whether the account is frozen.
      const response: BillingPlanResponse = {
        ...plan,
        ...deriveBillingAccessState(plan, env.BILLING_GRACE_DAYS, new Date()),
        // Sent unconditionally so the cancellation dialog can tell the customer
        // how long access survives losing the card, before any window opens.
        graceDays: env.BILLING_GRACE_DAYS,
      };
      reply.send(response);
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return sendError(request, reply, 403, 'FORBIDDEN');
      }
      throw error;
    }
  });

  app.post('/billing/payment-method/setup', manageOptions, async (request, reply) => {
    const actor = request.actor;
    if (!actor) return;
    const parsed = startBillingSetupRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(request, reply, parsed.error);
    try {
      const response: BillingCheckoutResponse = await container.startProductBillingSetup.execute(
        actor,
        parsed.data,
      );
      reply.status(201).send(response);
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return sendError(request, reply, 403, 'FORBIDDEN');
      }
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'BILLING_PROVIDER_UNAVAILABLE'
      ) {
        return sendError(request, reply, 503, 'BILLING_PROVIDER_UNAVAILABLE');
      }
      request.log.error(safeErrorDetails(error), 'Billing setup failed');
      return sendError(request, reply, 502, 'BILLING_SETUP_FAILED');
    }
  });

  app.delete('/billing/subscription', manageOptions, async (request, reply) => {
    const actor = request.actor;
    if (!actor) return;
    try {
      await container.cancelProductSubscription.execute(actor);
      reply.status(204).send();
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return sendError(request, reply, 403, 'FORBIDDEN');
      }
      throw error;
    }
  });

  // Cardcom's notification is only a trigger. The use case independently
  // retrieves and verifies the result from Cardcom before accepting a token.
  app.post('/billing/webhooks/cardcom', async (request, reply) => {
    const providerSetupId = webhookId(request.body) ?? webhookId(request.query);
    if (!providerSetupId) {
      return sendError(request, reply, 400, 'INVALID_BILLING_WEBHOOK');
    }
    try {
      await container.completeProductBillingSetup.execute(providerSetupId);
      reply.status(200).send({ received: true });
    } catch (error) {
      request.log.error(safeErrorDetails(error), 'Cardcom webhook verification failed');
      // Non-200 intentionally asks Cardcom to retry its notification.
      return sendError(request, reply, 502, 'BILLING_WEBHOOK_VERIFICATION_FAILED');
    }
  });

  app.get('/billing/jobs/collect', async (request, reply) => {
    const authorization = request.headers.authorization ?? '';
    if (!env.CRON_SECRET || !secureEqual(authorization, `Bearer ${env.CRON_SECRET}`)) {
      return sendError(request, reply, 401, 'UNAUTHENTICATED');
    }
    try {
      reply.send(await container.collectDueProductSubscriptions.execute());
    } catch (error) {
      request.log.error(safeErrorDetails(error), 'Recurring subscription collection failed');
      return sendError(request, reply, 503, 'BILLING_COLLECTION_UNAVAILABLE');
    }
  });
}
