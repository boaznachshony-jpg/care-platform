import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AuthorizationError } from '@caredesk/application';
import { buildContainer, DEV_TOKEN, type Container } from '../container.js';
import { buildServer } from '../create-server.js';
import { loadEnv } from '../env.js';
import { InMemoryRateLimiter } from '../rate-limit.js';
import { registerEventActionPlanRoutes } from './event-action-plans.js';

const AUTH = { authorization: `Bearer ${DEV_TOKEN}` };
const CASE_BODY = {
  careRecipient: { fullName: 'Synthetic Care Recipient' },
  employer: { fullName: 'Synthetic Employer', relationshipToRecipient: 'child' },
  caregiver: { legalName: 'Synthetic Caregiver', nationality: 'Philippines' },
  startDate: '2026-02-01',
};
const CONFIRMED_PLAN = {
  eventType: 'caregiver_resigned',
  answers: [{ questionId: 'event_date', value: '2026-09-01' }],
  status: 'confirmed',
};

function makeApp(): { app: FastifyInstance; container: Container } {
  const container = buildContainer(loadEnv({}));
  const app = buildServer(loadEnv({}), container);
  registerEventActionPlanRoutes(app, container, new InMemoryRateLimiter());
  return { app, container };
}

async function createCase(app: FastifyInstance): Promise<string> {
  const created = await app.inject({
    method: 'POST',
    url: '/cases',
    headers: AUTH,
    payload: CASE_BODY,
  });
  expect(created.statusCode).toBe(201);
  return created.json().id as string;
}

async function taskCount(app: FastifyInstance, caseId: string): Promise<number> {
  const tasks = await app.inject({ method: 'GET', url: `/cases/${caseId}/tasks`, headers: AUTH });
  expect(tasks.statusCode).toBe(200);
  return (tasks.json() as unknown[]).length;
}

describe('event action plan commit', () => {
  it('rejects unauthenticated commits', async () => {
    const { app } = makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/cases/00000000-0000-4000-8000-000000000001/event-plans',
      payload: CONFIRMED_PLAN,
    });
    expect(response.statusCode).toBe(401);
  });

  it('requires an idempotency key', async () => {
    const { app } = makeApp();
    const caseId = await createCase(app);
    const response = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/event-plans`,
      headers: AUTH,
      payload: CONFIRMED_PLAN,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  });

  it('commits exactly once and replays the identical stored receipt', async () => {
    const { app } = makeApp();
    const caseId = await createCase(app);
    const headers = { ...AUTH, 'idempotency-key': 'event-plan-replay-key-1' };

    const first = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/event-plans`,
      headers,
      payload: CONFIRMED_PLAN,
    });
    expect(first.statusCode).toBe(201);
    const receipt = first.json();
    expect(receipt.replayed).toBe(false);
    expect(receipt.eventType).toBe('caregiver_resigned');
    // The resignation plan executes exactly one actionable step (professional
    // review task); the two `check` items create nothing.
    const actionable = receipt.committedItems.filter(
      (item: { taskId: string | null }) => item.taskId,
    );
    expect(actionable).toHaveLength(1);
    expect(await taskCount(app, caseId)).toBe(1);

    const replay = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/event-plans`,
      headers,
      payload: CONFIRMED_PLAN,
    });
    expect(replay.statusCode).toBe(200);
    const replayed = replay.json();
    expect(replayed.replayed).toBe(true);
    expect(replayed.confirmationId).toBe(receipt.confirmationId);
    expect(replayed.committedItems).toEqual(receipt.committedItems);
    // No double task creation on replay.
    expect(await taskCount(app, caseId)).toBe(1);
  });

  it('keeps concurrent duplicates safe: exactly one execution', async () => {
    const { app } = makeApp();
    const caseId = await createCase(app);
    const headers = { ...AUTH, 'idempotency-key': 'event-plan-concurrent-key' };
    const request = () =>
      app.inject({
        method: 'POST',
        url: `/cases/${caseId}/event-plans`,
        headers,
        payload: CONFIRMED_PLAN,
      });
    const [a, b] = await Promise.all([request(), request()]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses[0] === 201 || statuses[1] === 201).toBe(true);
    for (const status of statuses) expect([200, 201, 409]).toContain(status);
    expect(await taskCount(app, caseId)).toBe(1);
  });

  it('rejects the same key reused with a different plan', async () => {
    const { app } = makeApp();
    const caseId = await createCase(app);
    const headers = { ...AUTH, 'idempotency-key': 'event-plan-reuse-key-1' };
    const first = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/event-plans`,
      headers,
      payload: CONFIRMED_PLAN,
    });
    expect(first.statusCode).toBe(201);
    const reused = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/event-plans`,
      headers,
      payload: {
        ...CONFIRMED_PLAN,
        answers: [{ questionId: 'event_date', value: '2026-10-01' }],
      },
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await taskCount(app, caseId)).toBe(1);
  });

  it('rejects a cancelled plan without any mutation', async () => {
    const { app } = makeApp();
    const caseId = await createCase(app);
    const response = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/event-plans`,
      headers: { ...AUTH, 'idempotency-key': 'event-plan-cancel-key' },
      payload: { ...CONFIRMED_PLAN, status: 'cancelled' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await taskCount(app, caseId)).toBe(0);
  });

  it('rejects an invalid plan (missing required answer, bad travel dates) without mutation', async () => {
    const { app } = makeApp();
    const caseId = await createCase(app);
    const missingAnswer = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/event-plans`,
      headers: { ...AUTH, 'idempotency-key': 'event-plan-invalid-key-1' },
      payload: { eventType: 'caregiver_resigned', answers: [], status: 'confirmed' },
    });
    expect(missingAnswer.statusCode).toBe(422);
    expect(missingAnswer.json()).toMatchObject({ code: 'PLAN_INVALID' });

    const badTravel = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/event-plans`,
      headers: { ...AUTH, 'idempotency-key': 'event-plan-invalid-key-2' },
      payload: {
        eventType: 'caregiver_travel',
        answers: [
          { questionId: 'departure_date', value: '2026-09-10' },
          { questionId: 'return_date', value: '2026-09-01' },
          { questionId: 'destination', value: 'Synthetic City' },
          { questionId: 'intends_return', value: true },
        ],
        status: 'confirmed',
      },
    });
    expect(badTravel.statusCode).toBe(422);
    expect(badTravel.json()).toMatchObject({ code: 'PLAN_INVALID' });
    expect(await taskCount(app, caseId)).toBe(0);
  });

  it('denies cross-tenant commits with 404 and no change', async () => {
    const { app, container } = makeApp();
    const caseId = await createCase(app);
    vi.spyOn(container.getCase, 'execute').mockRejectedValue(
      new AuthorizationError('cross-tenant'),
    );
    const response = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/event-plans`,
      headers: { ...AUTH, 'idempotency-key': 'event-plan-cross-tenant-key' },
      payload: CONFIRMED_PLAN,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
    vi.restoreAllMocks();
    expect(await taskCount(app, caseId)).toBe(0);
  });
});
