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

  // --- ADR-006 / WEB-11: the legacy client link -------------------------

  it('records the legacy client link, or null when none was given', async () => {
    const { authorization, openCase } = buildHarness();
    authorization.seedMembership({
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'owner',
      status: 'active',
    });

    const unlinked = await openCase.execute(OWNER, INPUT);
    expect(unlinked.legacyClientId).toBeNull();

    const linked = await openCase.execute(OWNER, {
      ...INPUT,
      legacyClientId: 'client-synthetic-a',
    });
    expect(linked.legacyClientId).toBe('client-synthetic-a');
  });

  it('returns the existing case instead of opening a second one for the same client', async () => {
    const { authorization, openCase, audit, timeline } = buildHarness();
    authorization.seedMembership({
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'owner',
      status: 'active',
    });
    const input = { ...INPUT, legacyClientId: 'client-synthetic-a' };

    const first = await openCase.execute(OWNER, input);
    const second = await openCase.execute(OWNER, input);

    expect(second.id).toBe(first.id);
    // Nothing happened the second time, so nothing is recorded as having
    // happened: a duplicate "case opened" entry in the audit trail or the
    // customer's timeline would be a lie about their own history.
    expect(audit.events).toHaveLength(1);
    expect(timeline.events).toHaveLength(1);
  });

  it('scopes the link per tenant, so two tenants may use the same client id', async () => {
    const { authorization, openCase } = buildHarness();
    for (const [userId, tenantId] of [
      ['user-1', 'tenant-1'],
      ['user-2', 'tenant-2'],
    ]) {
      authorization.seedMembership({
        userId: userId!,
        tenantId: tenantId!,
        role: 'owner',
        status: 'active',
      });
    }
    const input = { ...INPUT, legacyClientId: 'client-synthetic-a' };

    const first = await openCase.execute(OWNER, input);
    const second = await openCase.execute(
      { userId: 'user-2', tenantId: 'tenant-2', correlationId: 'corr-2' },
      input,
    );

    // The unique index in 0042 is (tenant_id, legacy_client_id). A browser
    // client id is generated locally and carries no tenant, so two tenants
    // colliding on one must not make the second tenant adopt the first
    // tenant's case.
    expect(second.id).not.toBe(first.id);
    expect(second.tenantId).toBe('tenant-2');
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
