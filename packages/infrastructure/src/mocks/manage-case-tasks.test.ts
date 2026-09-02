import { describe, expect, it } from 'vitest';
import {
  AddContactToCase,
  ArchiveCaseTask,
  AuthorizationError,
  CompleteCaseTask,
  CreateCaseTask,
  ImportCaseTask,
  ListCaseContacts,
  ListCaseTasks,
  ListCaseTimeline,
  UpdateCaseTask,
  type Actor,
} from '@caredesk/application';
import { FixedClock } from './clock.js';
import { SequentialIdGenerator } from './id-generator.js';
import { InMemoryAuditService } from './in-memory-audit-service.js';
import { InMemoryCaseContactRepository } from './in-memory-case-contact-repository.js';
import { InMemoryTaskRepository, InMemoryTimelineRepository } from './in-memory-task-repository.js';
import { InMemoryTimelineService } from './in-memory-timeline-service.js';
import { MembershipAuthorizationService } from './membership-authorization-service.js';

const ROLE_PERMISSIONS = {
  owner: [
    'task:create',
    'task:read',
    'task:update',
    'case_contact:create',
    'case_contact:read',
    'timeline:read',
  ],
  family_member: ['task:read', 'case_contact:read', 'timeline:read'],
} as const;

const OWNER: Actor = { userId: 'user-1', tenantId: 'tenant-1', correlationId: 'corr-1' };
const VIEWER: Actor = { userId: 'user-2', tenantId: 'tenant-1', correlationId: 'corr-2' };
const CASE_ID = 'case-1';

function buildHarness() {
  const authorization = new MembershipAuthorizationService(ROLE_PERMISSIONS);
  authorization.seedMembership({ ...OWNER, role: 'owner', status: 'active' });
  authorization.seedMembership({ ...VIEWER, role: 'family_member', status: 'active' });

  const tasks = new InMemoryTaskRepository();
  const contacts = new InMemoryCaseContactRepository();
  const audit = new InMemoryAuditService();
  const timelineService = new InMemoryTimelineService();
  const deps = {
    authorization,
    tasks,
    audit,
    timeline: timelineService,
    clock: new FixedClock(new Date('2026-03-01T09:00:00.000Z')),
    ids: new SequentialIdGenerator(),
  };

  return {
    audit,
    timelineService,
    createTask: new CreateCaseTask(deps),
    completeTask: new CompleteCaseTask(deps),
    updateTask: new UpdateCaseTask(deps),
    archiveTask: new ArchiveCaseTask(deps),
    importTask: new ImportCaseTask(deps),
    listTasks: new ListCaseTasks(deps),
    listTimeline: new ListCaseTimeline({
      ...deps,
      timeline: new InMemoryTimelineRepository(timelineService),
    }),
    addContact: new AddContactToCase({ ...deps, repository: contacts }),
    listContacts: new ListCaseContacts({ ...deps, repository: contacts }),
  };
}

describe('case tasks', () => {
  it('creates a task with an audit and timeline event', async () => {
    const h = buildHarness();
    const task = await h.createTask.execute(OWNER, CASE_ID, { title: 'לחדש ויזה' });

    expect(task.status).toBe('open');
    expect(task.title).toBe('לחדש ויזה');
    expect(h.audit.events.map((e) => e.action)).toContain('task.created');
    expect(h.timelineService.events.map((e) => e.eventTypeKey)).toContain('timeline.task.created');
  });

  it('stores a due date at day start so it cannot drift to the previous day', async () => {
    const h = buildHarness();
    const task = await h.createTask.execute(OWNER, CASE_ID, {
      title: 'Renew visa',
      dueDate: '2026-09-01',
    });
    expect(task.dueAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('denies task creation to a role without task:create', async () => {
    const h = buildHarness();
    await expect(h.createTask.execute(VIEWER, CASE_ID, { title: 'x' })).rejects.toThrow(
      AuthorizationError,
    );
  });

  it('completing a task twice is idempotent — the second attempt returns null', async () => {
    const h = buildHarness();
    const task = await h.createTask.execute(OWNER, CASE_ID, { title: 'Renew visa' });

    const first = await h.completeTask.execute(OWNER, CASE_ID, task.id);
    expect(first?.status).toBe('completed');
    expect(first?.completedAt).toBe('2026-03-01T09:00:00.000Z');

    const second = await h.completeTask.execute(OWNER, CASE_ID, task.id);
    expect(second).toBeNull();
    // Only one completion event, not two.
    expect(h.audit.events.filter((e) => e.action === 'task.completed')).toHaveLength(1);
  });

  it('lists tasks for the case', async () => {
    const h = buildHarness();
    await h.createTask.execute(OWNER, CASE_ID, { title: 'A' });
    await h.createTask.execute(OWNER, CASE_ID, { title: 'B' });
    expect(await h.listTasks.execute(VIEWER, CASE_ID)).toHaveLength(2);
  });

  it('updates a task field and audits the field names, never the values', async () => {
    const h = buildHarness();
    const task = await h.createTask.execute(OWNER, CASE_ID, { title: 'Original title' });
    const updated = await h.updateTask.execute(OWNER, CASE_ID, task.id, { title: 'New title' });
    expect(updated?.title).toBe('New title');
    const event = h.audit.events.find((e) => e.action === 'task.updated');
    expect(event?.changeSummary).toContain('title');
    expect(event?.changeSummary).not.toContain('New title');
  });

  it('clears a due date with dueDate: null', async () => {
    const h = buildHarness();
    const task = await h.createTask.execute(OWNER, CASE_ID, {
      title: 'Renew visa',
      dueDate: '2026-09-01',
    });
    const updated = await h.updateTask.execute(OWNER, CASE_ID, task.id, { dueDate: null });
    expect(updated?.dueAt).toBeNull();
  });

  it('returns null when updating an already-completed task', async () => {
    const h = buildHarness();
    const task = await h.createTask.execute(OWNER, CASE_ID, { title: 'x' });
    await h.completeTask.execute(OWNER, CASE_ID, task.id);
    expect(await h.updateTask.execute(OWNER, CASE_ID, task.id, { title: 'y' })).toBeNull();
  });

  it('archives (soft-closes) a task — status becomes cancelled, never deleted', async () => {
    const h = buildHarness();
    const task = await h.createTask.execute(OWNER, CASE_ID, { title: 'x' });
    const archived = await h.archiveTask.execute(OWNER, CASE_ID, task.id);
    expect(archived?.status).toBe('cancelled');
    // Still listed — archiving is not deletion.
    expect((await h.listTasks.execute(OWNER, CASE_ID)).map((t) => t.id)).toContain(task.id);
  });

  it('archiving twice is idempotent — the second attempt returns null', async () => {
    const h = buildHarness();
    const task = await h.createTask.execute(OWNER, CASE_ID, { title: 'x' });
    await h.archiveTask.execute(OWNER, CASE_ID, task.id);
    expect(await h.archiveTask.execute(OWNER, CASE_ID, task.id)).toBeNull();
  });

  it('imports a browser-only task, idempotent on legacyLocalId', async () => {
    const h = buildHarness();
    const first = await h.importTask.execute(OWNER, CASE_ID, {
      legacyLocalId: 'local-task-1',
      title: 'חידוש ויזה',
      status: 'open',
    });
    expect(first.legacyLocalId).toBe('local-task-1');

    const second = await h.importTask.execute(OWNER, CASE_ID, {
      legacyLocalId: 'local-task-1',
      title: 'חידוש ויזה',
      status: 'open',
    });
    expect(second.id).toBe(first.id);
    expect(h.audit.events.filter((e) => e.action === 'task.imported')).toHaveLength(1);
  });

  it('an imported task already completed on the device is created already completed', async () => {
    const h = buildHarness();
    const imported = await h.importTask.execute(OWNER, CASE_ID, {
      legacyLocalId: 'local-task-2',
      title: 'Done already',
      status: 'completed',
      completedAt: '2026-02-01T00:00:00.000Z',
    });
    expect(imported.status).toBe('completed');
    expect(imported.completedAt).toBe('2026-02-01T00:00:00.000Z');
  });
});

describe('case contacts', () => {
  it('adds a contact with an inline organization and lists it back', async () => {
    const h = buildHarness();
    await h.addContact.execute(OWNER, CASE_ID, {
      fullName: 'עובדת סוציאלית סינתטית',
      roleType: 'social_worker',
      isPrimary: true,
      organization: { name: 'לשכת רווחה סינתטית', organizationType: 'public_authority' },
    });

    const contacts = await h.listContacts.execute(VIEWER, CASE_ID);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.organizationName).toBe('לשכת רווחה סינתטית');
    expect(contacts[0]?.isPrimary).toBe(true);
    expect(h.audit.events.map((e) => e.action)).toContain('case_contact.added');
  });

  it('does not record the contact name in the audit summary', async () => {
    const h = buildHarness();
    await h.addContact.execute(OWNER, CASE_ID, {
      fullName: 'Private Person Name',
      roleType: 'social_worker',
    });
    const event = h.audit.events.find((e) => e.action === 'case_contact.added');
    expect(event?.changeSummary).not.toContain('Private Person Name');
  });

  it('denies adding a contact to a read-only role', async () => {
    const h = buildHarness();
    await expect(
      h.addContact.execute(VIEWER, CASE_ID, { fullName: 'X', roleType: 'social_worker' }),
    ).rejects.toThrow(AuthorizationError);
  });
});

describe('case timeline', () => {
  it('returns newest first', async () => {
    const h = buildHarness();
    await h.createTask.execute(OWNER, CASE_ID, { title: 'A' });
    await h.addContact.execute(OWNER, CASE_ID, { fullName: 'B', roleType: 'social_worker' });

    const timeline = await h.listTimeline.execute(VIEWER, CASE_ID);
    expect(timeline).toHaveLength(2);
    expect(timeline[0]?.eventTypeKey).toBe('timeline.contact.added');
  });
});
