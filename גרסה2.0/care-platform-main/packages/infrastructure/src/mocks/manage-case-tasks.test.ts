import { describe, expect, it } from 'vitest';
import {
  AddContactToCase,
  AuthorizationError,
  CompleteCaseTask,
  CreateCaseTask,
  ListCaseContacts,
  ListCaseTasks,
  ListCaseTimeline,
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
