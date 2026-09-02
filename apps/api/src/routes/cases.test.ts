import { describe, expect, it } from 'vitest';
import { DEV_TOKEN } from '../container.js';
import { loadEnv } from '../env.js';
import { buildServer } from '../create-server.js';

const VALID_BODY = {
  careRecipient: { fullName: 'Synthetic Care Recipient' },
  employer: { fullName: 'Synthetic Employer', relationshipToRecipient: 'child' },
  caregiver: { legalName: 'Synthetic Caregiver', nationality: 'Philippines' },
  startDate: '2026-02-01',
};

const AUTH = { authorization: `Bearer ${DEV_TOKEN}` };

describe('/cases routes', () => {
  it('rejects an unauthenticated POST with 401', async () => {
    const app = buildServer(loadEnv({}));
    const response = await app.inject({ method: 'POST', url: '/cases', payload: VALID_BODY });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects an invalid body with a field-level VALIDATION_ERROR envelope', async () => {
    const app = buildServer(loadEnv({}));
    const response = await app.inject({
      method: 'POST',
      url: '/cases',
      headers: AUTH,
      payload: { ...VALID_BODY, startDate: 'not-a-date' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.fieldErrors).toHaveProperty('startDate');
  });

  it('creates a case and reads it back through GET', async () => {
    const app = buildServer(loadEnv({}));

    const created = await app.inject({
      method: 'POST',
      url: '/cases',
      headers: AUTH,
      payload: VALID_BODY,
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json();
    expect(createdBody.status).toBe('draft');
    expect(createdBody.careRecipient.fullName).toBe('Synthetic Care Recipient');

    const fetched = await app.inject({
      method: 'GET',
      url: `/cases/${createdBody.id}`,
      headers: AUTH,
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().caregiver.nationality).toBe('Philippines');

    const listed = await app.inject({ method: 'GET', url: '/cases', headers: AUTH });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);
  });

  // --- WEB-11 / ADR-006: the legacy client link -------------------------
  //
  // Case creation is now driven from the end of onboarding, which is a step a
  // user reaches more than once. Without idempotence on legacyClientId every
  // retry is a second canonical case for one household, and the product then
  // has to guess which one is real.

  it('records the legacy client link and returns it on every read', async () => {
    const app = buildServer(loadEnv({}));

    const created = await app.inject({
      method: 'POST',
      url: '/cases',
      headers: AUTH,
      payload: { ...VALID_BODY, legacyClientId: 'client-synthetic-a' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().legacyClientId).toBe('client-synthetic-a');

    const fetched = await app.inject({
      method: 'GET',
      url: `/cases/${created.json().id}`,
      headers: AUTH,
    });
    expect(fetched.json().legacyClientId).toBe('client-synthetic-a');
  });

  it('opens exactly one case per legacy client, however many times it is asked', async () => {
    const app = buildServer(loadEnv({}));
    const payload = { ...VALID_BODY, legacyClientId: 'client-synthetic-a' };

    const first = await app.inject({ method: 'POST', url: '/cases', headers: AUTH, payload });
    const second = await app.inject({ method: 'POST', url: '/cases', headers: AUTH, payload });

    expect(second.statusCode).toBe(201);
    expect(second.json().id).toBe(first.json().id);

    const listed = await app.inject({ method: 'GET', url: '/cases', headers: AUTH });
    expect(listed.json()).toHaveLength(1);
  });

  it('leaves the link null when none is supplied, and never blocks a second such case', async () => {
    const app = buildServer(loadEnv({}));

    const first = await app.inject({
      method: 'POST',
      url: '/cases',
      headers: AUTH,
      payload: VALID_BODY,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/cases',
      headers: AUTH,
      payload: { ...VALID_BODY, careRecipient: { fullName: 'Synthetic Second Recipient' } },
    });

    expect(first.json().legacyClientId).toBeNull();
    expect(second.json().legacyClientId).toBeNull();
    expect(second.json().id).not.toBe(first.json().id);
    // Null is excluded from the unique index (0042), exactly so that unlinked
    // cases - every case that predates the migration - stay unconstrained.
    expect((await app.inject({ method: 'GET', url: '/cases', headers: AUTH })).json()).toHaveLength(
      2,
    );
  });

  // --- Caregiver identity corrections -----------------------------------
  //
  // The caregiver table (migration 0003) existed from the start, but nothing
  // let a family correct it after intake — see UpdateCaregiverProfileUseCase.

  it('corrects caregiver identity fields and returns the update on the case read', async () => {
    const app = buildServer(loadEnv({}));
    const created = await app.inject({
      method: 'POST',
      url: '/cases',
      headers: AUTH,
      payload: VALID_BODY,
    });
    const caseId = created.json().id as string;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/cases/${caseId}/caregiver`,
      headers: AUTH,
      payload: { primaryLanguage: 'Tagalog' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().primaryLanguage).toBe('Tagalog');
    // Unmentioned fields are untouched.
    expect(updated.json().nationality).toBe('Philippines');

    const fetched = await app.inject({ method: 'GET', url: `/cases/${caseId}`, headers: AUTH });
    expect(fetched.json().caregiver.primaryLanguage).toBe('Tagalog');
  });

  it('returns 404 for a caregiver update on an unknown case', async () => {
    const app = buildServer(loadEnv({}));
    const response = await app.inject({
      method: 'PATCH',
      url: '/cases/does-not-exist/caregiver',
      headers: AUTH,
      payload: { legalName: 'x' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('returns the standard 404 envelope for an unknown case id', async () => {
    const app = buildServer(loadEnv({}));
    const response = await app.inject({
      method: 'GET',
      url: '/cases/does-not-exist',
      headers: AUTH,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('does not seed the dev identity in production mode', async () => {
    // DB-03: a production environment only parses once it is complete, so this
    // case has to be configured even though it is about the dev identity and
    // not about any of these settings.
    const app = buildServer(
      loadEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://caredesk_app@localhost:5432/caredesk',
        WORKSPACE_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
        SUPABASE_URL: 'https://primary.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
        SUPABASE_SERVICE_ROLE_KEY: 'primary-server-only',
        SUPABASE_STORAGE_BUCKET: 'private-documents',
        BACKUP_SUPABASE_URL: 'https://backup.supabase.co',
        BACKUP_SUPABASE_SERVICE_ROLE_KEY: 'backup-server-only',
        BACKUP_SUPABASE_STORAGE_BUCKET: 'private-documents-backup',
      }),
    );
    const response = await app.inject({
      method: 'GET',
      url: '/cases',
      headers: AUTH,
    });
    expect(response.statusCode).toBe(401);
  });
});
