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
    const app = buildServer(loadEnv({ NODE_ENV: 'production' }));
    const response = await app.inject({
      method: 'GET',
      url: '/cases',
      headers: AUTH,
    });
    expect(response.statusCode).toBe(401);
  });
});
