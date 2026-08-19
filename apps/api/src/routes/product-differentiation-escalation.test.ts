import { describe, expect, it, vi } from 'vitest';
import { AuthorizationError } from '@caredesk/application';
import { buildContainer, DEV_TOKEN } from '../container.js';
import { buildServer } from '../create-server.js';
import { loadEnv } from '../env.js';
import { ESCALATION_TRANSITIONS } from './product-differentiation.js';
import type { FastifyInstance } from 'fastify';

// Constitution §16: synthetic data only.
const AUTH = { authorization: `Bearer ${DEV_TOKEN}` };
const VALID_CASE = {
  careRecipient: { fullName: 'Synthetic Care Recipient' },
  employer: { fullName: 'Synthetic Employer', relationshipToRecipient: 'child' },
  caregiver: { legalName: 'Synthetic Caregiver', nationality: 'Philippines' },
  startDate: '2026-02-01',
};
const REVIEW_BODY = {
  category: 'general',
  reason: 'Synthetic escalation reason',
  summary: 'Synthetic escalation summary',
  source: 'manual',
};

async function createCaseWithReview(app: FastifyInstance) {
  const createdCase = await app.inject({
    method: 'POST',
    url: '/cases',
    headers: AUTH,
    payload: VALID_CASE,
  });
  expect(createdCase.statusCode).toBe(201);
  const caseId = createdCase.json().id as string;
  const createdReview = await app.inject({
    method: 'POST',
    url: `/cases/${caseId}/professional-reviews`,
    headers: { ...AUTH, 'idempotency-key': `create-${Math.random()}` },
    payload: REVIEW_BODY,
  });
  expect(createdReview.statusCode).toBe(201);
  return { caseId, reviewId: createdReview.json().id as string };
}

describe('human escalation lifecycle routes', () => {
  it('declares terminal states and no provider-fulfilment transition', () => {
    expect(ESCALATION_TRANSITIONS.resolved).toEqual([]);
    expect(ESCALATION_TRANSITIONS.cancelled).toEqual([]);
    expect(ESCALATION_TRANSITIONS.requested).toEqual(['acknowledged', 'cancelled']);
  });

  it('creates a review in requested status and reads it back with an empty history', async () => {
    const app = buildServer(loadEnv({}));
    const { caseId, reviewId } = await createCaseWithReview(app);
    const detail = await app.inject({
      method: 'GET',
      url: `/cases/${caseId}/professional-reviews/${reviewId}`,
      headers: AUTH,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ review: { status: 'requested' }, history: [] });
    await app.close();
  });

  it('rejects an illegal transition with 409 INVALID_TRANSITION', async () => {
    const app = buildServer(loadEnv({}));
    const { caseId, reviewId } = await createCaseWithReview(app);
    const response = await app.inject({
      method: 'PATCH',
      url: `/cases/${caseId}/professional-reviews/${reviewId}`,
      headers: { ...AUTH, 'idempotency-key': 'illegal-jump-key' },
      payload: { status: 'resolved', resolutionNote: 'Skipping the lifecycle is not allowed.' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'INVALID_TRANSITION' });
    await app.close();
  });

  it('requires a resolution note before a review may be resolved', async () => {
    const app = buildServer(loadEnv({}));
    const { caseId, reviewId } = await createCaseWithReview(app);
    const response = await app.inject({
      method: 'PATCH',
      url: `/cases/${caseId}/professional-reviews/${reviewId}`,
      headers: { ...AUTH, 'idempotency-key': 'resolve-no-note' },
      payload: { status: 'resolved' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.fieldErrors).toHaveProperty('resolutionNote');
    await app.close();
  });

  it('walks the legal lifecycle with a manual handoff assignment and full history', async () => {
    const app = buildServer(loadEnv({}));
    const { caseId, reviewId } = await createCaseWithReview(app);
    const url = `/cases/${caseId}/professional-reviews/${reviewId}`;

    const acknowledged = await app.inject({
      method: 'PATCH',
      url,
      headers: { ...AUTH, 'idempotency-key': 'ack-0000001' },
      payload: { status: 'acknowledged', assignedTo: 'Adv. Synthetic Professional, 03-0000000' },
    });
    expect(acknowledged.statusCode).toBe(200);
    expect(acknowledged.json()).toMatchObject({
      status: 'acknowledged',
      assignedTo: 'Adv. Synthetic Professional, 03-0000000',
    });

    const inReview = await app.inject({
      method: 'PATCH',
      url,
      headers: { ...AUTH, 'idempotency-key': 'rev-0000001' },
      payload: { status: 'in_review' },
    });
    expect(inReview.statusCode).toBe(200);
    expect(inReview.json()).toMatchObject({ status: 'in_review' });

    const resolved = await app.inject({
      method: 'PATCH',
      url,
      headers: { ...AUTH, 'idempotency-key': 'res-0000001' },
      payload: { status: 'resolved', resolutionNote: 'Reviewed manually by the named professional.' },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toMatchObject({
      status: 'resolved',
      resolutionNote: 'Reviewed manually by the named professional.',
    });
    expect(resolved.json().resolvedAt).toBeTruthy();

    const detail = await app.inject({ method: 'GET', url, headers: AUTH });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().history).toHaveLength(3);

    // Terminal state: nothing moves out of resolved.
    const afterTerminal = await app.inject({
      method: 'PATCH',
      url,
      headers: { ...AUTH, 'idempotency-key': 'post-terminal-1' },
      payload: { status: 'cancelled' },
    });
    expect(afterTerminal.statusCode).toBe(409);
    expect(afterTerminal.json()).toMatchObject({ code: 'INVALID_TRANSITION' });
    await app.close();
  });

  it('replays an idempotent transition without applying it twice', async () => {
    const app = buildServer(loadEnv({}));
    const { caseId, reviewId } = await createCaseWithReview(app);
    const url = `/cases/${caseId}/professional-reviews/${reviewId}`;
    const request = {
      method: 'PATCH' as const,
      url,
      headers: { ...AUTH, 'idempotency-key': 'replay-key-01' },
      payload: { status: 'acknowledged' },
    };
    const first = await app.inject(request);
    expect(first.statusCode).toBe(200);
    const replay = await app.inject(request);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ status: 'acknowledged' });

    const detail = await app.inject({ method: 'GET', url, headers: AUTH });
    expect(detail.json().history).toHaveLength(1);
    await app.close();
  });

  it('denies cross-tenant access with the standard 404 envelope', async () => {
    const container = buildContainer(loadEnv({}));
    vi.spyOn(container.getCase, 'execute').mockRejectedValue(
      new AuthorizationError('cross-tenant'),
    );
    const app = buildServer(loadEnv({}), container);
    const foreign = '00000000-0000-4000-8000-0000000000aa';
    const response = await app.inject({
      method: 'PATCH',
      url: `/cases/${foreign}/professional-reviews/${foreign}`,
      headers: { ...AUTH, 'idempotency-key': 'cross-tenant-1' },
      payload: { status: 'acknowledged' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
    await app.close();
  });

  it('requires authentication and an idempotency key on the transition endpoint', async () => {
    const app = buildServer(loadEnv({}));
    const { caseId, reviewId } = await createCaseWithReview(app);
    const url = `/cases/${caseId}/professional-reviews/${reviewId}`;

    const unauthenticated = await app.inject({
      method: 'PATCH',
      url,
      payload: { status: 'acknowledged' },
    });
    expect(unauthenticated.statusCode).toBe(401);

    const missingKey = await app.inject({
      method: 'PATCH',
      url,
      headers: AUTH,
      payload: { status: 'acknowledged' },
    });
    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    await app.close();
  });
});
