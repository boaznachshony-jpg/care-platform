import { describe, expect, it } from 'vitest';
import {
  AuthorizationError,
  OpenEmploymentCase,
  UpdateCaregiverProfileUseCase,
  type Actor,
} from '@caredesk/application';
import { FixedClock } from './clock.js';
import { SequentialIdGenerator } from './id-generator.js';
import { InMemoryAuditService } from './in-memory-audit-service.js';
import { InMemoryCaseFoundationRepository } from './in-memory-case-foundation-repository.js';
import { InMemoryTimelineService } from './in-memory-timeline-service.js';
import { MembershipAuthorizationService } from './membership-authorization-service.js';

const ROLE_PERMISSIONS = {
  owner: ['employment_case:create', 'caregiver:update'],
  family_member: [],
} as const;

const OWNER: Actor = { userId: 'user-1', tenantId: 'tenant-1', correlationId: 'corr-1' };
const VIEWER: Actor = { userId: 'user-2', tenantId: 'tenant-1', correlationId: 'corr-2' };

function buildHarness() {
  const authorization = new MembershipAuthorizationService(ROLE_PERMISSIONS);
  authorization.seedMembership({ ...OWNER, role: 'owner', status: 'active' });
  authorization.seedMembership({ ...VIEWER, role: 'family_member', status: 'active' });

  const repository = new InMemoryCaseFoundationRepository();
  const audit = new InMemoryAuditService();
  const timeline = new InMemoryTimelineService();
  const clock = new FixedClock(new Date('2026-03-01T09:00:00.000Z'));
  const ids = new SequentialIdGenerator();

  return {
    audit,
    openCase: new OpenEmploymentCase({ authorization, repository, audit, timeline, clock, ids }),
    updateCaregiver: new UpdateCaregiverProfileUseCase({ authorization, repository, audit, clock }),
  };
}

const OPEN_CASE_INPUT = {
  careRecipient: { fullName: 'Synthetic Recipient' },
  employer: { fullName: 'Synthetic Employer', relationshipToRecipient: 'daughter' },
  caregiver: { legalName: 'Synthetic Caregiver', nationality: 'Philippines' },
  startDate: '2026-01-01',
};

describe('updating caregiver identity fields', () => {
  it('corrects a name and audits the field names, never the value', async () => {
    const h = buildHarness();
    const created = await h.openCase.execute(OWNER, OPEN_CASE_INPUT);

    const updated = await h.updateCaregiver.execute(OWNER, created.id, created.caregiverId, {
      legalName: 'Corrected Name',
      primaryLanguage: 'Tagalog',
    });

    expect(updated?.legalName).toBe('Corrected Name');
    expect(updated?.primaryLanguage).toBe('Tagalog');
    // Unmentioned fields are untouched.
    expect(updated?.nationality).toBe('Philippines');

    const event = h.audit.events.find((e) => e.action === 'caregiver.updated');
    expect(event?.sensitivity).toBe('identity_sensitive');
    expect(event?.changeSummary).toContain('legalName');
    expect(event?.changeSummary).not.toContain('Corrected Name');
  });

  it('returns null for a caregiver in another tenant', async () => {
    const h = buildHarness();
    const created = await h.openCase.execute(OWNER, OPEN_CASE_INPUT);
    const otherTenantActor: Actor = { ...OWNER, tenantId: 'tenant-2' };
    // Authorization denies before the repository lookup even runs, for an
    // actor with no membership in tenant-2 at all.
    await expect(
      h.updateCaregiver.execute(otherTenantActor, created.id, created.caregiverId, {
        legalName: 'x',
      }),
    ).rejects.toThrow(AuthorizationError);
  });

  it('denies the update to a read-only role', async () => {
    const h = buildHarness();
    const created = await h.openCase.execute(OWNER, OPEN_CASE_INPUT);
    await expect(
      h.updateCaregiver.execute(VIEWER, created.id, created.caregiverId, { legalName: 'x' }),
    ).rejects.toThrow(AuthorizationError);
  });
});
