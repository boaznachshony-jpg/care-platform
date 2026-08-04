import { describe, expect, it } from 'vitest';
import {
  AuthorizationError,
  CreateCaseTask,
  ListCaseTasks,
  authorizeOrThrow,
  type Actor,
  type AuditEventInput,
  type AuditService,
} from '@caredesk/application';
import { FixedClock } from './clock.js';
import { SequentialIdGenerator } from './id-generator.js';
import { InMemoryAuditService } from './in-memory-audit-service.js';
import { InMemoryTaskRepository } from './in-memory-task-repository.js';
import { InMemoryTimelineService } from './in-memory-timeline-service.js';
import { MembershipAuthorizationService } from './membership-authorization-service.js';

const ROLE_PERMISSIONS = {
  owner: ['task:create', 'task:read'],
  family_member: ['task:read'],
} as const;

const CLOCK = new FixedClock(new Date('2026-03-01T09:00:00.000Z'));
const OWNER: Actor = { userId: 'user-1', tenantId: 'tenant-1', correlationId: 'corr-1' };
const VIEWER: Actor = { userId: 'user-2', tenantId: 'tenant-1', correlationId: 'corr-2' };
const STRANGER: Actor = { userId: 'user-3', tenantId: 'tenant-1', correlationId: 'corr-3' };

function buildDeps() {
  const authorization = new MembershipAuthorizationService(ROLE_PERMISSIONS);
  authorization.seedMembership({ ...OWNER, role: 'owner', status: 'active' });
  authorization.seedMembership({ ...VIEWER, role: 'family_member', status: 'active' });
  // STRANGER is deliberately not seeded — no membership at all.
  const audit = new InMemoryAuditService();
  return { authorization, audit, clock: CLOCK };
}

describe('authorizeOrThrow', () => {
  it('records nothing when the caller is allowed', async () => {
    const deps = buildDeps();
    await authorizeOrThrow(deps, OWNER, { resourceType: 'task', action: 'create' });
    expect(deps.audit.events).toHaveLength(0);
  });

  it('records a denial with the reason before throwing', async () => {
    const deps = buildDeps();

    await expect(
      authorizeOrThrow(deps, VIEWER, { resourceType: 'task', action: 'create', caseId: 'case-1' }),
    ).rejects.toThrow(AuthorizationError);

    expect(deps.audit.events).toHaveLength(1);
    const event = deps.audit.events[0];
    expect(event?.action).toBe('task.create.denied');
    expect(event?.permissionDecision).toBe('denied');
    expect(event?.reason).toContain('family_member');
    expect(event?.correlationId).toBe('corr-2');
    expect(event?.occurredAt).toBe('2026-03-01T09:00:00.000Z');
  });

  it('records a denial for a caller with no membership at all', async () => {
    const deps = buildDeps();
    await expect(
      authorizeOrThrow(deps, STRANGER, { resourceType: 'task', action: 'read' }),
    ).rejects.toThrow(AuthorizationError);
    expect(deps.audit.events[0]?.reason).toContain('membership');
  });

  it('denies a permitted role when its membership requires an AAL2 session', async () => {
    const authorization = new MembershipAuthorizationService(ROLE_PERMISSIONS);
    authorization.seedMembership({
      ...OWNER,
      role: 'owner',
      status: 'active',
      mfaRequired: true,
    });
    const audit = new InMemoryAuditService();

    await expect(
      authorizeOrThrow(
        { authorization, audit, clock: CLOCK },
        { ...OWNER, mfaSatisfied: false },
        { resourceType: 'task', action: 'create' },
      ),
    ).rejects.toThrow(AuthorizationError);
    expect(audit.events[0]?.reason).toContain('Multi-factor');

    await expect(
      authorizeOrThrow(
        { authorization, audit, clock: CLOCK },
        { ...OWNER, mfaSatisfied: true },
        { resourceType: 'task', action: 'create' },
      ),
    ).resolves.toBeUndefined();
  });

  it('names the specific resource when one is known, else falls back to the case', async () => {
    const deps = buildDeps();

    await expect(
      authorizeOrThrow(deps, VIEWER, {
        resourceType: 'task',
        action: 'create',
        caseId: 'case-1',
        resourceId: 'task-9',
      }),
    ).rejects.toThrow(AuthorizationError);
    expect(deps.audit.events[0]?.resourceId).toBe('task-9');

    await expect(
      authorizeOrThrow(deps, VIEWER, { resourceType: 'task', action: 'create', caseId: 'case-1' }),
    ).rejects.toThrow(AuthorizationError);
    expect(deps.audit.events[1]?.resourceId).toBe('case-1');
  });

  it('still refuses when the audit write itself fails', async () => {
    // Losing the record is a monitoring problem; letting the request through
    // because we could not write a log line would be a security one.
    const failingAudit: AuditService = {
      record: (_event: AuditEventInput) => Promise.reject(new Error('audit store unavailable')),
    };
    const deps = { ...buildDeps(), audit: failingAudit };

    await expect(
      authorizeOrThrow(deps, VIEWER, { resourceType: 'task', action: 'create' }),
    ).rejects.toThrow(AuthorizationError);
  });
});

describe('denial auditing through a real use case', () => {
  function buildTaskHarness() {
    const base = buildDeps();
    const deps = {
      ...base,
      tasks: new InMemoryTaskRepository(),
      timeline: new InMemoryTimelineService(),
      ids: new SequentialIdGenerator(),
    };
    return {
      audit: base.audit,
      createTask: new CreateCaseTask(deps),
      listTasks: new ListCaseTasks(deps),
    };
  }

  it('audits a denied write', async () => {
    const h = buildTaskHarness();
    await expect(h.createTask.execute(VIEWER, 'case-1', { title: 'Renew visa' })).rejects.toThrow(
      AuthorizationError,
    );
    expect(h.audit.events.map((e) => e.action)).toEqual(['task.create.denied']);
  });

  it('audits a denied read — reads are attempts too', async () => {
    const h = buildTaskHarness();
    await expect(h.listTasks.execute(STRANGER, 'case-1')).rejects.toThrow(AuthorizationError);
    expect(h.audit.events.map((e) => e.action)).toEqual(['task.read.denied']);
  });

  it('does not audit a permitted read', async () => {
    const h = buildTaskHarness();
    await h.listTasks.execute(VIEWER, 'case-1');
    expect(h.audit.events).toHaveLength(0);
  });
});
