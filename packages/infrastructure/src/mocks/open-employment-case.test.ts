import { describe, expect, it } from 'vitest';
import {
  AuthorizationError,
  GetEmploymentCase,
  OpenEmploymentCase,
  type Actor,
} from '@caredesk/application';
import { FixedClock } from './clock.js';
import { SequentialIdGenerator } from './id-generator.js';
import { InMemoryAuditService } from './in-memory-audit-service.js';
import { InMemoryCaseFoundationRepository } from './in-memory-case-foundation-repository.js';
import { InMemoryTimelineService } from './in-memory-timeline-service.js';
import { MembershipAuthorizationService } from './membership-authorization-service.js';

const ROLE_PERMISSIONS = {
  owner: ['employment_case:create', 'employment_case:read'],
  family_member: ['employment_case:read'],
} as const;

const INPUT = {
  careRecipient: { fullName: 'Synthetic Care Recipient' },
  employer: { fullName: 'Synthetic Employer', relationshipToRecipient: 'child' },
  caregiver: { legalName: 'Synthetic Caregiver', nationality: 'Philippines' },
  startDate: '2026-02-01',
};

function buildHarness() {
  const authorization = new MembershipAuthorizationService(ROLE_PERMISSIONS);
  const repository = new InMemoryCaseFoundationRepository();
  const audit = new InMemoryAuditService();
  const timeline = new InMemoryTimelineService();
  const openCase = new OpenEmploymentCase({
    authorization,
    repository,
    audit,
    timeline,
    clock: new FixedClock(new Date('2026-01-20T10:00:00.000Z')),
    ids: new SequentialIdGenerator(),
  });
  const getCase = new GetEmploymentCase({
    authorization,
    repository,
    audit,
    clock: new FixedClock(new Date('2026-01-20T10:00:00.000Z')),
  });
  return { authorization, repository, audit, timeline, openCase, getCase };
}

const OWNER: Actor = { userId: 'user-1', tenantId: 'tenant-1', correlationId: 'corr-1' };

describe('OpenEmploymentCase', () => {
  it('denies a user with no membership (deny-by-default)', async () => {
    const { openCase } = buildHarness();
    await expect(openCase.execute(OWNER, INPUT)).rejects.toThrow(AuthorizationError);
  });

  it('denies a family_member role that lacks employment_case:create', async () => {
    const { authorization, openCase } = buildHarness();
    authorization.seedMembership({
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'family_member',
      status: 'active',
    });
    await expect(openCase.execute(OWNER, INPUT)).rejects.toThrow(AuthorizationError);
  });

  it('creates the full graph, audit event, and timeline event for an owner', async () => {
    const { authorization, openCase, getCase, audit, timeline } = buildHarness();
    authorization.seedMembership({
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'owner',
      status: 'active',
    });

    const created = await openCase.execute(OWNER, INPUT);
    expect(created.status).toBe('draft');
    expect(created.tenantId).toBe('tenant-1');

    const graph = await getCase.execute(OWNER, created.id);
    expect(graph?.careRecipient.fullName).toBe('Synthetic Care Recipient');
    expect(graph?.caregiver.nationality).toBe('Philippines');

    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]?.action).toBe('employment_case.opened');
    expect(audit.events[0]?.correlationId).toBe('corr-1');

    expect(timeline.events).toHaveLength(1);
    expect(timeline.events[0]?.eventTypeKey).toBe('timeline.case.opened');
  });

  it("never returns another tenant's case, even to an authorized user", async () => {
    const { authorization, openCase, getCase } = buildHarness();
    authorization.seedMembership({
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'owner',
      status: 'active',
    });
    authorization.seedMembership({
      userId: 'user-2',
      tenantId: 'tenant-2',
      role: 'owner',
      status: 'active',
    });

    const created = await openCase.execute(OWNER, INPUT);

    const otherTenantActor: Actor = {
      userId: 'user-2',
      tenantId: 'tenant-2',
      correlationId: 'corr-2',
    };
    const crossTenantRead = await getCase.execute(otherTenantActor, created.id);
    expect(crossTenantRead).toBeNull();
  });
});
