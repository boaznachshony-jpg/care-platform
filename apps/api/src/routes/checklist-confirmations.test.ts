import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DEV_TOKEN } from '../container.js';
import { buildServer } from '../create-server.js';
import { loadEnv } from '../env.js';

const AUTH = { authorization: `Bearer ${DEV_TOKEN}` };
const CASE_BODY = {
  careRecipient: { fullName: 'Synthetic Care Recipient' },
  employer: { fullName: 'Synthetic Employer', relationshipToRecipient: 'child' },
  caregiver: { legalName: 'Synthetic Caregiver', nationality: 'Philippines' },
  startDate: '2026-02-01',
};
const ITEMS = ['Review passport validity', 'Review visa / authorization validity'];

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

describe('assistant checklist confirmation durable idempotency', () => {
  it('confirms once and replays the identical stored receipt without double task creation', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await createCase(app);
    const headers = { ...AUTH, 'idempotency-key': 'checklist-replay-key-1' };

    const first = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/assistant/checklist-confirmations`,
      headers,
      payload: { items: ITEMS },
    });
    expect(first.statusCode).toBe(201);
    const receipt = first.json();
    expect(receipt.replayed).toBe(false);
    expect(receipt.created).toHaveLength(ITEMS.length);
    expect(receipt.confirmationId).toBe(receipt.receiptId);
    expect(await taskCount(app, caseId)).toBe(ITEMS.length);

    const replay = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/assistant/checklist-confirmations`,
      headers,
      payload: { items: ITEMS },
    });
    expect(replay.statusCode).toBe(200);
    const replayed = replay.json();
    expect(replayed.replayed).toBe(true);
    expect(replayed.confirmationId).toBe(receipt.confirmationId);
    expect(replayed.created).toEqual(receipt.created);
    expect(await taskCount(app, caseId)).toBe(ITEMS.length);
  });

  it('keeps concurrent duplicates safe: the checklist executes exactly once', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await createCase(app);
    const headers = { ...AUTH, 'idempotency-key': 'checklist-concurrent-key' };
    const request = () =>
      app.inject({
        method: 'POST',
        url: `/cases/${caseId}/assistant/checklist-confirmations`,
        headers,
        payload: { items: ITEMS },
      });
    const [a, b] = await Promise.all([request(), request()]);
    const statuses = [a.statusCode, b.statusCode];
    expect(statuses).toContain(201);
    for (const status of statuses) expect([200, 201, 409]).toContain(status);
    expect(await taskCount(app, caseId)).toBe(ITEMS.length);
  });

  it('rejects the same key reused with different items', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await createCase(app);
    const headers = { ...AUTH, 'idempotency-key': 'checklist-reuse-key-1' };
    const first = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/assistant/checklist-confirmations`,
      headers,
      payload: { items: ITEMS },
    });
    expect(first.statusCode).toBe(201);
    const reused = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/assistant/checklist-confirmations`,
      headers,
      payload: { items: ['A different checklist item'] },
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await taskCount(app, caseId)).toBe(ITEMS.length);
  });

  it('still requires an idempotency key and an authorized case', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await createCase(app);
    const missingKey = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/assistant/checklist-confirmations`,
      headers: AUTH,
      payload: { items: ITEMS },
    });
    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });

    const unknownCase = await app.inject({
      method: 'POST',
      url: '/cases/00000000-0000-4000-8000-0000000000aa/assistant/checklist-confirmations',
      headers: { ...AUTH, 'idempotency-key': 'checklist-unknown-case-key' },
      payload: { items: ITEMS },
    });
    expect(unknownCase.statusCode).toBe(404);
    expect(await taskCount(app, caseId)).toBe(0);
  });
});
