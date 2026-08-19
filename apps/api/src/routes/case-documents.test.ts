import { describe, expect, it } from 'vitest';
import type { InMemoryAuditService, InMemoryTimelineService } from '@caredesk/infrastructure';
import { buildContainer, DEV_TOKEN } from '../container.js';
import { loadEnv } from '../env.js';
import { buildServer } from '../create-server.js';

const AUTH = { authorization: `Bearer ${DEV_TOKEN}` };

const CASE_BODY = {
  careRecipient: { fullName: 'Synthetic Care Recipient' },
  employer: { fullName: 'Synthetic Employer', relationshipToRecipient: 'child' },
  caregiver: { legalName: 'Synthetic Caregiver', nationality: 'Philippines' },
  startDate: '2026-02-01',
};

/** Synthetic bytes only (Constitution §25). */
const CONTENT = Buffer.from('synthetic-pdf-bytes').toString('base64');

const UPLOAD_BODY = {
  documentType: 'passport',
  sensitivity: 'identity_sensitive',
  mediaType: 'application/pdf',
  content: CONTENT,
};

async function openCase(app: ReturnType<typeof buildServer>): Promise<string> {
  const created = await app.inject({
    method: 'POST',
    url: '/cases',
    headers: AUTH,
    payload: CASE_BODY,
  });
  return created.json().id as string;
}

describe('case document routes', () => {
  it('uploads a document and lists it back', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await openCase(app);

    const created = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/documents`,
      headers: AUTH,
      payload: { ...UPLOAD_BODY, expiresOn: '2026-09-01' },
    });
    expect(created.statusCode).toBe(201);
    const document = created.json();
    expect(document.documentType).toBe('passport');
    expect(document.currentVersionNumber).toBe(1);
    // Day start, so an expiry cannot drift to the previous calendar day.
    expect(document.expiresAt).toBe('2026-09-01T00:00:00.000Z');

    const listed = await app.inject({
      method: 'GET',
      url: `/cases/${caseId}/documents`,
      headers: AUTH,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);
  });

  it('never returns the storage key, checksum, or file content to a client', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await openCase(app);

    const created = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/documents`,
      headers: AUTH,
      payload: UPLOAD_BODY,
    });

    const body = created.json();
    expect(body).not.toHaveProperty('storageKey');
    expect(body).not.toHaveProperty('checksum');
    expect(body).not.toHaveProperty('content');
    expect(created.body).not.toContain(CONTENT);
  });

  it('issues a short-lived signed download link', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await openCase(app);

    const created = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/documents`,
      headers: AUTH,
      payload: UPLOAD_BODY,
    });
    const documentId = created.json().id as string;

    const link = await app.inject({
      method: 'GET',
      url: `/cases/${caseId}/documents/${documentId}/download-url`,
      headers: AUTH,
    });
    expect(link.statusCode).toBe(200);
    expect(link.json().expiresInSeconds).toBe(900);
    expect(link.json().url).toContain('mock://signed/');
  });

  it('404s for a document id that is not on this case, revealing nothing', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await openCase(app);
    const otherCaseId = await openCase(app);

    const created = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/documents`,
      headers: AUTH,
      payload: UPLOAD_BODY,
    });
    const documentId = created.json().id as string;

    const link = await app.inject({
      method: 'GET',
      url: `/cases/${otherCaseId}/documents/${documentId}/download-url`,
      headers: AUTH,
    });
    expect(link.statusCode).toBe(404);
  });

  it('rejects a media type outside the allow-list with a field-level error', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await openCase(app);

    const response = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/documents`,
      headers: AUTH,
      // SVG is a script container, not an inert document.
      payload: { ...UPLOAD_BODY, mediaType: 'image/svg+xml' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().fieldErrors).toHaveProperty('mediaType');
  });

  it('rejects an unknown document type', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await openCase(app);

    const response = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/documents`,
      headers: AUTH,
      payload: { ...UPLOAD_BODY, documentType: 'not_a_real_type' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().fieldErrors).toHaveProperty('documentType');
  });

  it('requires authentication on every document route', async () => {
    const app = buildServer(loadEnv({}));
    expect((await app.inject({ method: 'GET', url: '/cases/any/documents' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: '/cases/any/documents', payload: UPLOAD_BODY }))
        .statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/cases/any/documents/any/download-url' }))
        .statusCode,
    ).toBe(401);
  });
});

describe('document intake review confirmation (audit evidence)', () => {
  const REVIEW_BODY = {
    classification: { family: 'passport', confidence: 0.92, provenance: 'ai' },
    reviewState: 'user_confirmed',
    fields: [
      { key: 'expiry_date', validationStatus: 'valid', provenance: 'ai', userConfirmed: true },
      { key: 'holder_name', validationStatus: 'valid', provenance: 'ocr', userConfirmed: true },
    ],
    providerName: 'synthetic-provider',
    providerRequestId: 'req-0001',
  };

  function makeApp() {
    const env = loadEnv({});
    const container = buildContainer(env);
    const app = buildServer(env, container);
    return { app, container };
  }

  async function uploadDocument(
    app: ReturnType<typeof buildServer>,
    caseId: string,
  ): Promise<string> {
    const created = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/documents`,
      headers: AUTH,
      payload: UPLOAD_BODY,
    });
    expect(created.statusCode).toBe(201);
    return created.json().id as string;
  }

  it('records a confirmed review with an audit event and a timeline event', async () => {
    const { app, container } = makeApp();
    const caseId = await openCase(app);
    const documentId = await uploadDocument(app, caseId);

    const response = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/documents/${documentId}/intake-reviews`,
      headers: AUTH,
      payload: REVIEW_BODY,
    });
    expect(response.statusCode).toBe(201);
    const review = response.json();
    expect(review.reviewState).toBe('user_confirmed');
    expect(review.documentId).toBe(documentId);
    expect(review.confirmedBy).toBeTruthy();
    expect(review.confirmedAt).toBeTruthy();

    const audit = container.audit as InMemoryAuditService;
    const receipt = audit.events.find(
      (event) => event.action === 'document.intake_review_confirmed',
    );
    expect(receipt).toBeDefined();
    expect(receipt?.resourceType).toBe('document_intake_review');
    expect(receipt?.resourceId).toBe(review.id);
    expect(receipt?.sensitivity).toBe('identity_sensitive');

    const timeline = container.timeline as InMemoryTimelineService;
    const timelineEvent = timeline.events.find(
      (event) => event.eventTypeKey === 'timeline.document.intake_reviewed',
    );
    expect(timelineEvent).toBeDefined();
    expect(timelineEvent?.employmentCaseId).toBe(caseId);
  });

  it('records a cancellation with its own audit action and no confirmer', async () => {
    const { app, container } = makeApp();
    const caseId = await openCase(app);
    const documentId = await uploadDocument(app, caseId);

    const response = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/documents/${documentId}/intake-reviews`,
      headers: AUTH,
      payload: { ...REVIEW_BODY, reviewState: 'cancelled' },
    });
    expect(response.statusCode).toBe(201);
    const review = response.json();
    expect(review.reviewState).toBe('cancelled');
    expect(review.confirmedBy).toBeNull();
    expect(review.confirmedAt).toBeNull();

    const audit = container.audit as InMemoryAuditService;
    expect(audit.events.some((event) => event.action === 'document.intake_review_cancelled')).toBe(
      true,
    );
  });

  it('never accepts or stores extracted values — metadata only', async () => {
    const { app } = makeApp();
    const caseId = await openCase(app);
    const documentId = await uploadDocument(app, caseId);

    // proposedValue is content, not evidence metadata — the strict schema
    // rejects it so extracted values cannot enter the durable receipt.
    const response = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/documents/${documentId}/intake-reviews`,
      headers: AUTH,
      payload: {
        ...REVIEW_BODY,
        fields: [
          {
            key: 'holder_name',
            validationStatus: 'valid',
            provenance: 'ai',
            userConfirmed: true,
            proposedValue: 'Synthetic Caregiver',
          },
        ],
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('404s for a document outside the case and lists reviews back', async () => {
    const { app } = makeApp();
    const caseId = await openCase(app);
    const otherCaseId = await openCase(app);
    const documentId = await uploadDocument(app, caseId);

    const crossCase = await app.inject({
      method: 'POST',
      url: `/cases/${otherCaseId}/documents/${documentId}/intake-reviews`,
      headers: AUTH,
      payload: REVIEW_BODY,
    });
    expect(crossCase.statusCode).toBe(404);

    const created = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/documents/${documentId}/intake-reviews`,
      headers: AUTH,
      payload: REVIEW_BODY,
    });
    expect(created.statusCode).toBe(201);

    const listed = await app.inject({
      method: 'GET',
      url: `/cases/${caseId}/documents/${documentId}/intake-reviews`,
      headers: AUTH,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);
  });

  it('requires authentication', async () => {
    const { app } = makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/cases/00000000-0000-4000-8000-000000000001/documents/00000000-0000-4000-8000-000000000002/intake-reviews',
      payload: REVIEW_BODY,
    });
    expect(response.statusCode).toBe(401);
  });
});
