import { describe, expect, it, vi } from 'vitest';
import type { AuthorizationService } from '@caredesk/application';
import { GetProductSubscription } from '@caredesk/application';
import {
  InMemoryAuditService,
  InMemoryBillingRepository,
  MockProductBillingGateway,
  SystemClock,
  UuidIdGenerator,
} from '@caredesk/infrastructure';
import { buildContainer, DEV_TOKEN } from '../container.js';
import { buildServer } from '../create-server.js';
import { loadEnv } from '../env.js';

const AUTH = { authorization: `Bearer ${DEV_TOKEN}` };

/**
 * A charge-date policy anchored decades in the past always reads as frozen,
 * regardless of the real clock the test happens to run on (the guard uses
 * wall-clock time, exactly like GET /billing/subscription does — see
 * freeze-guard.ts point 5 for why it is not given an injectable clock).
 */
const LONG_FROZEN_DEFAULTS = {
  priceAgorot: 3900,
  vatRateBps: 1800,
  launchDiscountPercent: 0,
  chargingStartsAt: '2000-01-01',
};

const PERMISSIVE_AUTH: AuthorizationService = {
  check: async () => ({ allowed: true, reason: 'test' }),
};

/**
 * Builds a real server via the real container (so DEV_TOKEN authentication,
 * /cases and /billing routing all behave exactly as production does), but
 * swaps in a standalone GetProductSubscription backed by its own in-memory
 * billing repository seeded to read as permanently frozen for the dev
 * tenant. Everything else on the container — case authorization, the actual
 * /cases use cases — is untouched.
 */
function buildFrozenTenantServer() {
  const env = loadEnv({ BILLING_PROVIDER: 'mock' });
  const container = buildContainer(env);
  const billing = new InMemoryBillingRepository();
  const getProductSubscription = new GetProductSubscription({
    authorization: PERMISSIVE_AUTH,
    billing,
    gateway: new MockProductBillingGateway(),
    audit: new InMemoryAuditService(),
    clock: new SystemClock(),
    ids: new UuidIdGenerator(),
    defaults: LONG_FROZEN_DEFAULTS,
  });
  const executeSpy = vi.spyOn(getProductSubscription, 'execute');
  container.getProductSubscription = getProductSubscription;
  const app = buildServer(env, container);
  return { app, executeSpy };
}

describe('account freeze guard', () => {
  it('refuses a write from a frozen tenant with a distinct machine-readable code', async () => {
    const { app } = buildFrozenTenantServer();
    const response = await app.inject({
      method: 'POST',
      url: '/cases',
      headers: AUTH,
      payload: {},
    });
    expect(response.statusCode).toBe(402);
    expect(response.json()).toMatchObject({ code: 'ACCOUNT_FROZEN' });
  });

  it('still allows a frozen tenant to read their own data', async () => {
    const { app } = buildFrozenTenantServer();
    const response = await app.inject({ method: 'GET', url: '/cases', headers: AUTH });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it('exempts the billing routes themselves — a frozen tenant must be able to fix payment', async () => {
    const { app } = buildFrozenTenantServer();
    const response = await app.inject({
      method: 'POST',
      url: '/billing/payment-method/setup',
      headers: AUTH,
      payload: {
        billingName: 'Frozen Tenant',
        billingEmail: 'frozen@example.test',
        acceptsRecurringCharge: true,
        termsVersion: '2026-08-04',
      },
    });
    expect(response.statusCode).not.toBe(402);
  });

  it('exempts emergency binder exports — the freeze must never trap this document', async () => {
    const { app } = buildFrozenTenantServer();
    const caseId = '00000000-0000-4000-8000-000000000099';
    const post = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/binder-exports`,
      headers: { ...AUTH, 'idempotency-key': 'freeze-guard-test-key-000001' },
      payload: { sections: ['contacts'], documentIds: [] },
    });
    // Not frozen — the request reaches the ordinary "case not found" check
    // (there is no such case for this tenant), proving the guard stepped
    // aside rather than refusing the write outright.
    expect(post.statusCode).not.toBe(402);
    expect(post.statusCode).toBe(404);

    const list = await app.inject({
      method: 'GET',
      url: `/cases/${caseId}/binder-exports`,
      headers: AUTH,
    });
    expect(list.statusCode).not.toBe(402);
  });

  it('does not call GetProductSubscription on every request — the derived state is cached briefly', async () => {
    const { app, executeSpy } = buildFrozenTenantServer();
    await app.inject({ method: 'POST', url: '/cases', headers: AUTH, payload: {} });
    await app.inject({ method: 'POST', url: '/cases', headers: AUTH, payload: {} });
    expect(executeSpy).toHaveBeenCalledTimes(1);
  });

  it('lets a non-frozen tenant write normally (no charge-date policy applies by default)', async () => {
    const env = loadEnv({ BILLING_PROVIDER: 'mock' });
    const app = buildServer(env, buildContainer(env));
    const response = await app.inject({
      method: 'POST',
      url: '/cases',
      headers: AUTH,
      payload: {},
    });
    // No employmentCase payload was sent, so this fails validation — the
    // point is only that it is refused for that reason (400), not frozen
    // (402): the request reached the route's own body validation.
    expect(response.statusCode).toBe(400);
  });

  it('does not require an actor to reach an unauthenticated route (health check)', async () => {
    const { app } = buildFrozenTenantServer();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
  });

  it('stays silent (lets the route 401) when the bearer token does not resolve', async () => {
    const { app } = buildFrozenTenantServer();
    const response = await app.inject({
      method: 'POST',
      url: '/cases',
      headers: { authorization: 'Bearer not-a-real-token' },
      payload: {},
    });
    expect(response.statusCode).toBe(401);
  });
});
