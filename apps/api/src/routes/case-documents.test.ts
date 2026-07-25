import { describe, expect, it } from 'vitest';
import { DEV_TOKEN } from '../container.js';
import { loadEnv } from '../env.js';
import { buildServer } from '../server.js';

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
