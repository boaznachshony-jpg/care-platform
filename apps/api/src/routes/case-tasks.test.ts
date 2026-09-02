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

/**
 * This is the route Milestone 1 shipped the use cases and the repository for
 * but never registered — see registerCaseTaskRoutes in case-tasks.ts for why.
 */
describe('case task routes', () => {
  it('creates a task, lists it back, and completes it', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await openCase(app);

    const created = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/tasks`,
      headers: AUTH,
      payload: { title: 'לחדש ויזה', priority: 'high' },
    });
    expect(created.statusCode).toBe(201);
    const task = created.json();
    expect(task.status).toBe('open');

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
  });

  it('updates a task via PATCH', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await openCase(app);
    const created = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/tasks`,
      headers: AUTH,
      payload: { title: 'Original' },
    });
    const task = created.json();

    const updated = await app.inject({
      method: 'PATCH',
      url: `/cases/${caseId}/tasks/${task.id}`,
      headers: AUTH,
      payload: { title: 'Updated' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().title).toBe('Updated');
  });

  it('archives a task instead of deleting it', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await openCase(app);
    const created = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/tasks`,
      headers: AUTH,
      payload: { title: 'x' },
    });
    const task = created.json();

    const archived = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/tasks/${task.id}/archive`,
      headers: AUTH,
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().status).toBe('cancelled');
  });

  it('imports a browser-only task idempotently on legacyLocalId', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await openCase(app);
    const payload = { legacyLocalId: 'local-task-xyz', title: 'Imported task', status: 'open' };

    const first = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/tasks/import`,
      headers: AUTH,
      payload,
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/tasks/import`,
      headers: AUTH,
      payload,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);

    const listed = await app.inject({
      method: 'GET',
      url: `/cases/${caseId}/tasks`,
      headers: AUTH,
    });
    expect(listed.json()).toHaveLength(1);
  });

  it('rejects an unauthenticated request', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await openCase(app);
    const response = await app.inject({ method: 'GET', url: `/cases/${caseId}/tasks` });
    expect(response.statusCode).toBe(401);
  });
});
