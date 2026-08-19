import { describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildContainer, DEV_TOKEN, type Container } from '../container.js';
import { buildServer } from '../create-server.js';
import { loadEnv } from '../env.js';
import { InMemoryRateLimiter } from '../rate-limit.js';
import { InMemoryBinderExportService } from '../binder-export-service.js';
import { BINDER_EXPORT_RATE_LIMITS, registerBinderExportRoutes } from './binder-exports.js';

const AUTH = { authorization: `Bearer ${DEV_TOKEN}` };
const VALID_CASE = {
  careRecipient: { fullName: 'Synthetic Care Recipient' },
  employer: { fullName: 'Synthetic Employer', relationshipToRecipient: 'child' },
  caregiver: { legalName: 'Synthetic Caregiver', nationality: 'Philippines' },
  startDate: '2026-02-01',
};
const UNKNOWN_CASE_ID = '00000000-0000-4000-8000-00000000dead';
const FOREIGN_DOCUMENT_ID = '00000000-0000-4000-8000-00000000beef';

/**
 * Route registration is pending in create-server.ts (merged centrally), so
 * each test wires the module onto a full buildServer app the same way the
 * central registration will.
 */
function makeApp(options?: { role?: 'viewer' | 'manager' }): {
  app: FastifyInstance;
  container: Container;
} {
  const env = loadEnv({});
  const container = buildContainer(env);
  const app = buildServer(env, container);
  const service = options?.role
    ? new InMemoryBinderExportService({
        getCase: container.getCase,
        listDocuments: container.listDocuments,
        audit: container.audit,
        resolveRole: async () => options.role ?? null,
      })
    : undefined;
  registerBinderExportRoutes(app, container, new InMemoryRateLimiter(), service);
  return { app, container };
}

async function createCase(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/cases',
    headers: AUTH,
    payload: VALID_CASE,
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string }>().id;
}

async function uploadDocument(app: FastifyInstance, caseId: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: `/cases/${caseId}/documents`,
    headers: AUTH,
    payload: {
      documentType: 'passport',
      mediaType: 'application/pdf',
      content: Buffer.from('synthetic binder test bytes').toString('base64'),
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string }>().id;
}

function exportBinder(
  app: FastifyInstance,
  caseId: string,
  key: string,
  payload: InjectOptions['payload'] = { sections: ['case', 'contacts'], documentIds: [] },
  headers: Record<string, string> = AUTH,
) {
  return app.inject({
    method: 'POST',
    url: `/cases/${caseId}/binder-exports`,
    headers: { ...headers, 'idempotency-key': key },
    payload,
  });
}

describe('binder export routes', () => {
  it('declares bounded typed rate limits for every route', () => {
    expect(BINDER_EXPORT_RATE_LIMITS).toEqual({
      list: { max: 60, timeWindow: 60_000, bucket: 'list' },
      create: { max: 10, timeWindow: 60_000, bucket: 'create' },
    });
  });

  it('rejects unauthenticated create and list with 401', async () => {
    const { app } = makeApp();
    const post = await app.inject({
      method: 'POST',
      url: `/cases/${UNKNOWN_CASE_ID}/binder-exports`,
      payload: { sections: ['case'], documentIds: [] },
    });
    expect(post.statusCode).toBe(401);
    const get = await app.inject({
      method: 'GET',
      url: `/cases/${UNKNOWN_CASE_ID}/binder-exports`,
    });
    expect(get.statusCode).toBe(401);
  });

  it('returns the indistinguishable 404 for an unknown or cross-tenant case id', async () => {
    const { app } = makeApp();
    await createCase(app);
    const response = await exportBinder(app, UNKNOWN_CASE_ID, 'key-cross-tenant');
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('requires an idempotency key and an explicit, valid manifest', async () => {
    const { app } = makeApp();
    const caseId = await createCase(app);

    const noKey = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/binder-exports`,
      headers: AUTH,
      payload: { sections: ['case'], documentIds: [] },
    });
    expect(noKey.statusCode).toBe(400);
    expect(noKey.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });

    for (const payload of [
      { sections: [], documentIds: [] },
      { sections: ['everything'], documentIds: [] },
      // documents were named without the documents section — not explicit.
      { sections: ['case'], documentIds: [FOREIGN_DOCUMENT_ID] },
      { sections: ['case'], documentIds: [], extra: true },
    ]) {
      const response = await exportBinder(app, caseId, 'key-validation', payload);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
  });

  it('refuses a manifest naming a document that does not belong to the case', async () => {
    const { app } = makeApp();
    const caseId = await createCase(app);
    const response = await exportBinder(app, caseId, 'key-foreign-doc', {
      sections: ['documents'],
      documentIds: [FOREIGN_DOCUMENT_ID],
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'MANIFEST_DOCUMENT_NOT_IN_CASE' });
  });

  it('records an export with a deterministic sha256 receipt and lists it back', async () => {
    const { app } = makeApp();
    const caseId = await createCase(app);
    const documentId = await uploadDocument(app, caseId);

    const created = await exportBinder(app, caseId, 'key-create-1', {
      sections: ['documents', 'case'],
      documentIds: [documentId],
    });
    expect(created.statusCode).toBe(201);
    const first = created.json<{
      receipt: { id: string; caseId: string; contentHash: string; hashAlgorithm: string };
      replayed: boolean;
    }>();
    expect(first.replayed).toBe(false);
    expect(first.receipt.caseId).toBe(caseId);
    expect(first.receipt.hashAlgorithm).toBe('sha256');
    expect(first.receipt.contentHash).toMatch(/^[0-9a-f]{64}$/);

    // Same explicit selection in a different order — same hash, new receipt.
    const again = await exportBinder(app, caseId, 'key-create-2', {
      sections: ['case', 'documents'],
      documentIds: [documentId],
    });
    expect(again.statusCode).toBe(201);
    const second = again.json<{ receipt: { id: string; contentHash: string } }>();
    expect(second.receipt.contentHash).toBe(first.receipt.contentHash);
    expect(second.receipt.id).not.toBe(first.receipt.id);

    const listed = await app.inject({
      method: 'GET',
      url: `/cases/${caseId}/binder-exports`,
      headers: AUTH,
    });
    expect(listed.statusCode).toBe(200);
    const receipts = listed.json<Array<{ id: string }>>();
    expect(receipts).toHaveLength(2);
    expect(receipts.map((receipt) => receipt.id)).toContain(first.receipt.id);
  });

  it('replays the same idempotency key instead of writing a second receipt', async () => {
    const { app } = makeApp();
    const caseId = await createCase(app);
    const payload = { sections: ['case', 'payroll'], documentIds: [] };

    const created = await exportBinder(app, caseId, 'key-replay-1', payload);
    expect(created.statusCode).toBe(201);
    const original = created.json<{ receipt: { id: string; contentHash: string } }>().receipt;

    const replayed = await exportBinder(app, caseId, 'key-replay-1', payload);
    expect(replayed.statusCode).toBe(200);
    const replay = replayed.json<{
      receipt: { id: string; contentHash: string };
      replayed: boolean;
    }>();
    expect(replay.replayed).toBe(true);
    expect(replay.receipt.id).toBe(original.id);
    expect(replay.receipt.contentHash).toBe(original.contentHash);

    // Immutability: the replay changed nothing — still exactly one receipt.
    const listed = await app.inject({
      method: 'GET',
      url: `/cases/${caseId}/binder-exports`,
      headers: AUTH,
    });
    expect(listed.json<unknown[]>()).toHaveLength(1);
  });

  it('rejects reuse of an idempotency key with a different manifest', async () => {
    const { app } = makeApp();
    const caseId = await createCase(app);
    expect(
      (await exportBinder(app, caseId, 'key-conflict', { sections: ['case'], documentIds: [] }))
        .statusCode,
    ).toBe(201);
    const conflict = await exportBinder(app, caseId, 'key-conflict', {
      sections: ['contacts'],
      documentIds: [],
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('exposes no mutation surface for an existing receipt', async () => {
    const { app } = makeApp();
    const caseId = await createCase(app);
    const created = await exportBinder(app, caseId, 'key-immutable');
    const receiptId = created.json<{ receipt: { id: string } }>().receipt.id;

    for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
      const response = await app.inject({
        method,
        url: `/cases/${caseId}/binder-exports/${receiptId}`,
        headers: AUTH,
        payload: {},
      });
      expect(response.statusCode).toBe(404);
    }
  });

  it('denies a viewer even though the viewer can read the case', async () => {
    const { app } = makeApp({ role: 'viewer' });
    const caseId = await createCase(app);
    const post = await exportBinder(app, caseId, 'key-viewer');
    expect(post.statusCode).toBe(403);
    expect(post.json()).toMatchObject({ code: 'FORBIDDEN' });
    const get = await app.inject({
      method: 'GET',
      url: `/cases/${caseId}/binder-exports`,
      headers: AUTH,
    });
    expect(get.statusCode).toBe(403);
  });

  it('allows a manager to record an export', async () => {
    const { app } = makeApp({ role: 'manager' });
    const caseId = await createCase(app);
    const response = await exportBinder(app, caseId, 'key-manager');
    expect(response.statusCode).toBe(201);
  });

  it('rate limits export creation per actor with a retry-after header', async () => {
    const { app } = makeApp();
    const caseId = await createCase(app);
    for (let attempt = 0; attempt < BINDER_EXPORT_RATE_LIMITS.create.max; attempt += 1) {
      const response = await exportBinder(app, caseId, `key-rate-${attempt}`);
      expect(response.statusCode).toBe(201);
    }
    const limited = await exportBinder(app, caseId, 'key-rate-limited');
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

    // The list bucket is independent of the exhausted create bucket.
    const listed = await app.inject({
      method: 'GET',
      url: `/cases/${caseId}/binder-exports`,
      headers: AUTH,
    });
    expect(listed.statusCode).toBe(200);
  });
});
