import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { InMemoryAuditService, InMemoryTimelineService } from '@caredesk/infrastructure';
import { buildContainer, DEV_TOKEN, type Container } from '../container.js';
import { buildServer } from '../create-server.js';
import { loadEnv } from '../env.js';
import { InMemoryRateLimiter } from '../rate-limit.js';
import {
  computeEvidenceExportHash,
  InMemoryEvidenceExportService,
  verifyEvidenceExportHash,
  type EvidenceExportManifest,
} from '../evidence-export-service.js';
import { EVIDENCE_EXPORT_RATE_LIMITS, registerEvidenceExportRoutes } from './evidence-exports.js';

const AUTH = { authorization: `Bearer ${DEV_TOKEN}` };
const VALID_CASE = {
  careRecipient: { fullName: 'Synthetic Care Recipient' },
  employer: { fullName: 'Synthetic Employer', relationshipToRecipient: 'child' },
  caregiver: { legalName: 'Synthetic Caregiver', nationality: 'Philippines' },
  startDate: '2026-02-01',
};
const UNKNOWN_CASE_ID = '00000000-0000-4000-8000-00000000dead';
const SYNTHETIC_BYTES = 'synthetic evidence export test bytes';
const CONTENT_BASE64 = Buffer.from(SYNTHETIC_BYTES).toString('base64');

/**
 * Central registration in create-server.ts consumes
 * `container.evidenceExportService`, so the role-override tests inject their
 * deterministic service through the container before buildServer runs. The
 * hasRoute guard keeps this suite valid both before and after the central
 * registration line lands (same pattern as leave-entries.test.ts).
 */
function makeApp(options?: { role?: 'viewer' | 'manager' }): {
  app: FastifyInstance;
  container: Container;
} {
  const env = loadEnv({});
  const container = buildContainer(env);
  const audit = container.audit as InMemoryAuditService;
  const timeline = container.timeline as InMemoryTimelineService;
  const service = options?.role
    ? new InMemoryEvidenceExportService({
        getCase: container.getCase,
        listDocuments: container.listDocuments,
        listTasks: container.listTasks,
        readAuditEvents: () => audit.events,
        readTimelineEvents: () => timeline.events,
        audit: container.audit,
        resolveRole: async () => options.role ?? null,
      })
    : undefined;
  container.evidenceExportService = service;
  const app = buildServer(env, container);
  if (!app.hasRoute({ method: 'GET', url: '/cases/:caseId/evidence-export' })) {
    registerEvidenceExportRoutes(app, container, new InMemoryRateLimiter(), service);
  }
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
      content: CONTENT_BASE64,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string }>().id;
}

function exportEvidence(app: FastifyInstance, caseId: string) {
  return app.inject({
    method: 'GET',
    url: `/cases/${caseId}/evidence-export`,
    headers: AUTH,
  });
}

describe('evidence export hash (pure)', () => {
  const manifest: EvidenceExportManifest = {
    version: 1,
    tenantId: '00000000-0000-4000-8000-000000000010',
    caseId: '00000000-0000-4000-8000-000000000011',
    auditEvents: [
      {
        id: null,
        action: 'document.uploaded',
        resourceType: 'document',
        resourceId: 'doc-1',
        actorId: 'user-1',
        occurredAt: '2026-01-02T00:00:00.000Z',
        correlationId: 'corr-2',
        permissionDecision: 'allowed',
        sensitivity: 'identity_sensitive',
        changeSummary: 'Document type passport uploaded.',
      },
      {
        id: null,
        action: 'employment_case.opened',
        resourceType: 'employment_case',
        resourceId: 'case-1',
        actorId: 'user-1',
        occurredAt: '2026-01-01T00:00:00.000Z',
        correlationId: 'corr-1',
        permissionDecision: 'allowed',
        sensitivity: 'employment_sensitive',
        changeSummary: null,
      },
    ],
    timelineEvents: [
      {
        id: null,
        eventTypeKey: 'timeline.document.uploaded',
        summaryKey: 'timeline.document.uploaded.summary',
        occurredAt: '2026-01-02T00:00:00.000Z',
        sourceType: null,
        sourceId: null,
        sensitivity: 'general',
      },
    ],
  };

  it('is deterministic and insensitive to input event order', () => {
    const reordered: EvidenceExportManifest = {
      ...manifest,
      auditEvents: [...manifest.auditEvents].reverse(),
    };
    const hash = computeEvidenceExportHash(manifest);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(computeEvidenceExportHash(reordered)).toBe(hash);
    expect(verifyEvidenceExportHash(manifest, hash)).toBe(true);
    expect(verifyEvidenceExportHash(manifest, hash.toUpperCase())).toBe(true);
  });

  it('changes when any evidence record changes', () => {
    const tampered: EvidenceExportManifest = {
      ...manifest,
      auditEvents: [
        { ...manifest.auditEvents[0]!, changeSummary: 'Document type visa uploaded.' },
        manifest.auditEvents[1]!,
      ],
    };
    expect(computeEvidenceExportHash(tampered)).not.toBe(computeEvidenceExportHash(manifest));
    expect(verifyEvidenceExportHash(tampered, computeEvidenceExportHash(manifest))).toBe(false);
  });
});

describe('evidence export routes', () => {
  it('declares bounded typed rate limits for every route', () => {
    expect(EVIDENCE_EXPORT_RATE_LIMITS).toEqual({
      export: { max: 5, timeWindow: 60_000, bucket: 'export' },
      verify: { max: 20, timeWindow: 60_000, bucket: 'verify' },
    });
  });

  it('rejects unauthenticated export and verify with 401', async () => {
    const { app } = makeApp();
    expect(
      (await app.inject({ url: `/cases/${UNKNOWN_CASE_ID}/evidence-export` })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          url: `/cases/${UNKNOWN_CASE_ID}/evidence-export/verify?hash=${'a'.repeat(64)}`,
        })
      ).statusCode,
    ).toBe(401);
  });

  it('returns the indistinguishable 404 for an unknown or cross-tenant case id', async () => {
    const { app } = makeApp();
    await createCase(app);
    const response = await exportEvidence(app, UNKNOWN_CASE_ID);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('denies a viewer and records the denial as audit evidence', async () => {
    const { app, container } = makeApp({ role: 'viewer' });
    const caseId = await createCase(app);
    const response = await exportEvidence(app, caseId);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });

    const audit = container.audit as InMemoryAuditService;
    const denial = audit.events.find((event) => event.action === 'evidence.export_denied');
    expect(denial).toBeDefined();
    expect(denial?.permissionDecision).toBe('denied');
    expect(denial?.reason).toContain('owner or manager');
  });

  it('exports a chronological metadata manifest with a matching sha256', async () => {
    const { app } = makeApp();
    const caseId = await createCase(app);
    await uploadDocument(app, caseId);

    const response = await exportEvidence(app, caseId);
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      manifest: EvidenceExportManifest;
      contentHash: string;
      hashAlgorithm: string;
      counts: { auditEvents: number; timelineEvents: number };
    }>();

    expect(body.hashAlgorithm).toBe('sha256');
    expect(body.contentHash).toMatch(/^[0-9a-f]{64}$/);
    // The response hash really is the hash of the returned manifest.
    expect(computeEvidenceExportHash(body.manifest)).toBe(body.contentHash);
    expect(verifyEvidenceExportHash(body.manifest, body.contentHash)).toBe(true);

    const actions = body.manifest.auditEvents.map((event) => event.action);
    expect(actions).toContain('employment_case.opened');
    expect(actions).toContain('document.uploaded');
    expect(body.counts.auditEvents).toBe(body.manifest.auditEvents.length);

    const timelineKeys = body.manifest.timelineEvents.map((event) => event.eventTypeKey);
    expect(timelineKeys).toContain('timeline.document.uploaded');

    // Chronological: never a record earlier than its predecessor.
    const times = body.manifest.auditEvents.map((event) => event.occurredAt);
    expect([...times].sort()).toEqual(times);
  });

  it('is deterministic: exporting the same case twice yields the same hash', async () => {
    const { app } = makeApp();
    const caseId = await createCase(app);
    await uploadDocument(app, caseId);

    const first = await exportEvidence(app, caseId);
    const second = await exportEvidence(app, caseId);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json<{ contentHash: string }>().contentHash).toBe(
      first.json<{ contentHash: string }>().contentHash,
    );
  });

  it('never leaks document bytes, storage keys or message bodies', async () => {
    const { app } = makeApp();
    const caseId = await createCase(app);
    await uploadDocument(app, caseId);

    const response = await exportEvidence(app, caseId);
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(CONTENT_BASE64);
    expect(response.body).not.toContain(SYNTHETIC_BYTES);
    expect(response.body).not.toContain('storageKey');
    expect(response.body).not.toContain('"content"');
  });

  it('audits the export itself with an evidence.exported receipt keyed by the hash', async () => {
    const { app, container } = makeApp();
    const caseId = await createCase(app);
    const response = await exportEvidence(app, caseId);
    const { contentHash } = response.json<{ contentHash: string }>();

    const audit = container.audit as InMemoryAuditService;
    const receipt = audit.events.find((event) => event.action === 'evidence.exported');
    expect(receipt).toBeDefined();
    expect(receipt?.resourceType).toBe('evidence_export');
    expect(receipt?.resourceId).toBe(contentHash);

    // The receipt is deliberately excluded from later manifests, so it can
    // never make the trail it fingerprints non-deterministic.
    const again = await exportEvidence(app, caseId);
    const manifest = again.json<{ manifest: EvidenceExportManifest }>().manifest;
    expect(manifest.auditEvents.some((event) => event.action.startsWith('evidence.'))).toBe(false);
  });

  it('verifies a previously issued hash and rejects a stale one', async () => {
    const { app, container } = makeApp();
    const caseId = await createCase(app);
    await uploadDocument(app, caseId);
    const { contentHash } = (await exportEvidence(app, caseId)).json<{ contentHash: string }>();

    const ok = await app.inject({
      url: `/cases/${caseId}/evidence-export/verify?hash=${contentHash}`,
      headers: AUTH,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      matches: true,
      previouslyIssued: true,
      computedHash: contentHash,
    });

    const stale = await app.inject({
      url: `/cases/${caseId}/evidence-export/verify?hash=${'a'.repeat(64)}`,
      headers: AUTH,
    });
    expect(stale.statusCode).toBe(200);
    expect(stale.json()).toMatchObject({ matches: false, previouslyIssued: false });

    const audit = container.audit as InMemoryAuditService;
    expect(audit.events.some((event) => event.action === 'evidence.export_verified')).toBe(true);
  });

  it('rejects a malformed verification hash before touching any data', async () => {
    const { app } = makeApp();
    const caseId = await createCase(app);
    const response = await app.inject({
      url: `/cases/${caseId}/evidence-export/verify?hash=not-a-hash`,
      headers: AUTH,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rate limits repeated exports per principal', async () => {
    const { app } = makeApp();
    const caseId = await createCase(app);
    let limited = false;
    for (let i = 0; i < EVIDENCE_EXPORT_RATE_LIMITS.export.max + 1; i += 1) {
      const response = await exportEvidence(app, caseId);
      if (response.statusCode === 429) limited = true;
    }
    expect(limited).toBe(true);
  });
});
