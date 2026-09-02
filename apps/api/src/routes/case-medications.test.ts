import { describe, expect, it } from 'vitest';
import { DEV_TOKEN } from '../container.js';
import { loadEnv } from '../env.js';
import { buildServer } from '../create-server.js';

const AUTH = { authorization: `Bearer ${DEV_TOKEN}` };

const CASE_BODY = {
  careRecipient: { fullName: 'Synthetic Care Recipient' },
  employer: { fullName: 'Synthetic Employer', relationshipToRecipient: 'child' },
  caregiver: { legalName: 'Synthetic Caregiver', nationality: 'Philippines' },
  startDate: '2026-02-01',
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

const MEDICATION_BODY = {
  name: 'Synthetic Medication',
  dosage: '1 tablet',
  timesOfDay: ['morning'],
  daily: true,
  prescribingDoctor: 'Dr. Synthetic',
  notes: '',
};

/** The one genuinely new server-side domain in this round — see migration 0046. */
describe('case medication routes', () => {
  it('creates a medication and lists it back', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await openCase(app);

    const created = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/medications`,
      headers: AUTH,
      payload: MEDICATION_BODY,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().status).toBe('active');

    const listed = await app.inject({
      method: 'GET',
      url: `/cases/${caseId}/medications`,
      headers: AUTH,
    });
    expect(listed.json()).toHaveLength(1);
  });

  it('archives a medication instead of deleting it', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await openCase(app);
    const created = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/medications`,
      headers: AUTH,
      payload: MEDICATION_BODY,
    });
    const medication = created.json();

    const archived = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/medications/${medication.id}/archive`,
      headers: AUTH,
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().status).toBe('archived');

    // Archived medications drop out of the active list — history, not deletion.
    const listed = await app.inject({
      method: 'GET',
      url: `/cases/${caseId}/medications`,
      headers: AUTH,
    });
    expect(listed.json()).toHaveLength(0);
  });

  it('imports a browser-only medication idempotently on legacyLocalId', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await openCase(app);
    const payload = { ...MEDICATION_BODY, legacyLocalId: 'local-med-xyz' };

    const first = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/medications/import`,
      headers: AUTH,
      payload,
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/medications/import`,
      headers: AUTH,
      payload,
    });
    expect(second.json().id).toBe(first.json().id);

    const listed = await app.inject({
      method: 'GET',
      url: `/cases/${caseId}/medications`,
      headers: AUTH,
    });
    expect(listed.json()).toHaveLength(1);
  });

  it('rejects an unauthenticated request', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await openCase(app);
    const response = await app.inject({ method: 'GET', url: `/cases/${caseId}/medications` });
    expect(response.statusCode).toBe(401);
  });
});
