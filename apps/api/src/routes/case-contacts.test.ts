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

describe('case contacts routes', () => {
  it('adds a contact with an inline organization and lists it', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await openCase(app);

    const created = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/contacts`,
      headers: AUTH,
      payload: {
        fullName: 'Synthetic Social Worker',
        roleType: 'social_worker',
        isPrimary: true,
        organization: { name: 'Synthetic Welfare Office', organizationType: 'public_authority' },
      },
    });
    expect(created.statusCode).toBe(201);

    const listed = await app.inject({
      method: 'GET',
      url: `/cases/${caseId}/contacts`,
      headers: AUTH,
    });
    expect(listed.statusCode).toBe(200);
    const body = listed.json();
    expect(body).toHaveLength(1);
    expect(body[0].organizationName).toBe('Synthetic Welfare Office');
  });

  it('rejects an unknown organization type with a field-level error', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await openCase(app);

    const response = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/contacts`,
      headers: AUTH,
      payload: {
        fullName: 'Synthetic Contact',
        roleType: 'social_worker',
        organization: { name: 'Somewhere', organizationType: 'not_a_real_type' },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().fieldErrors).toHaveProperty('organization.organizationType');
  });

  it('requires authentication', async () => {
    const app = buildServer(loadEnv({}));
    const response = await app.inject({ method: 'GET', url: '/cases/any/contacts' });
    expect(response.statusCode).toBe(401);
  });
});

describe('case task routes', () => {
  it('creates, lists, and completes a task', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await openCase(app);

    const created = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/tasks`,
      headers: AUTH,
      payload: { title: 'Renew visa', priority: 'high', dueDate: '2026-09-01' },
    });
    expect(created.statusCode).toBe(201);
    const task = created.json();
    expect(task.status).toBe('open');
    // Day start, so a deadline cannot drift to the previous calendar day.
    expect(task.dueAt).toBe('2026-09-01T00:00:00.000Z');

    const listed = await app.inject({
      method: 'GET',
      url: `/cases/${caseId}/tasks`,
      headers: AUTH,
    });
    expect(listed.json()).toHaveLength(1);

    const completed = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/tasks/${task.id}/complete`,
      headers: AUTH,
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().status).toBe('completed');

    // Completing again is not an error path that reveals anything — it 404s.
    const again = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/tasks/${task.id}/complete`,
      headers: AUTH,
    });
    expect(again.statusCode).toBe(404);
  });

  it('rejects a task with a too-short title', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await openCase(app);
    const response = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/tasks`,
      headers: AUTH,
      payload: { title: 'x' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().fieldErrors).toHaveProperty('title');
  });
});

describe('case timeline route', () => {
  it('returns events newest first for actions taken on the case', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await openCase(app);

    await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/tasks`,
      headers: AUTH,
      payload: { title: 'Renew visa' },
    });

    const timeline = await app.inject({
      method: 'GET',
      url: `/cases/${caseId}/timeline`,
      headers: AUTH,
    });
    expect(timeline.statusCode).toBe(200);
    const events = timeline.json() as Array<{ eventTypeKey: string; actionTarget?: string }>;
    const keys = events.map((event) => event.eventTypeKey);
    expect(keys[0]).toBe('timeline.task.created');
    expect(events[0]?.actionTarget).toBe('/tasks');
    expect(keys).toContain('timeline.case.opened');
  });
});
