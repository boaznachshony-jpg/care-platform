import { describe, expect, it } from 'vitest';
import {
  ArchiveMedication,
  AuthorizationError,
  CreateMedication,
  ImportMedication,
  ListMedications,
  UpdateMedication,
  type Actor,
  type MedicationFields,
} from '@caredesk/application';
import { FixedClock } from './clock.js';
import { SequentialIdGenerator } from './id-generator.js';
import { InMemoryAuditService } from './in-memory-audit-service.js';
import { InMemoryMedicationRepository } from './in-memory-medication-repository.js';
import { InMemoryTimelineService } from './in-memory-timeline-service.js';
import { MembershipAuthorizationService } from './membership-authorization-service.js';

const ROLE_PERMISSIONS = {
  owner: ['medication:create', 'medication:read', 'medication:update'],
  family_member: ['medication:read'],
} as const;

const OWNER: Actor = { userId: 'user-1', tenantId: 'tenant-1', correlationId: 'corr-1' };
const VIEWER: Actor = { userId: 'user-2', tenantId: 'tenant-1', correlationId: 'corr-2' };
const CASE_ID = 'case-1';

function buildHarness() {
  const authorization = new MembershipAuthorizationService(ROLE_PERMISSIONS);
  authorization.seedMembership({ ...OWNER, role: 'owner', status: 'active' });
  authorization.seedMembership({ ...VIEWER, role: 'family_member', status: 'active' });

  const medications = new InMemoryMedicationRepository();
  const audit = new InMemoryAuditService();
  const timeline = new InMemoryTimelineService();
  const deps = {
    authorization,
    medications,
    audit,
    timeline,
    clock: new FixedClock(new Date('2026-03-01T09:00:00.000Z')),
    ids: new SequentialIdGenerator(),
  };

  return {
    audit,
    timeline,
    create: new CreateMedication(deps),
    list: new ListMedications(deps),
    update: new UpdateMedication(deps),
    archive: new ArchiveMedication(deps),
    import: new ImportMedication(deps),
  };
}

const FIELDS: MedicationFields = {
  name: 'Synthetic Med A',
  dosage: '1 tablet',
  timesOfDay: ['morning'],
  daily: true,
  daysOfWeek: null,
  prescribingDoctor: 'Dr. Synthetic',
  notes: '',
};

describe('creating a medication', () => {
  it('creates it with care_sensitive audit/timeline entries that never carry the name', async () => {
    const h = buildHarness();
    const medication = await h.create.execute(OWNER, CASE_ID, { ...FIELDS });

    expect(medication.status).toBe('active');
    expect(medication.sensitivity).toBe('care_sensitive');

    const event = h.audit.events.find((e) => e.action === 'medication.created');
    expect(event?.sensitivity).toBe('care_sensitive');
    expect(JSON.stringify(event)).not.toContain('Synthetic Med A');

    expect(h.timeline.events.map((e) => e.eventTypeKey)).toContain('timeline.medication.created');
  });

  it('denies creation to a read-only role', async () => {
    const h = buildHarness();
    await expect(h.create.execute(VIEWER, CASE_ID, { ...FIELDS })).rejects.toThrow(
      AuthorizationError,
    );
  });
});

describe('listing medications', () => {
  it('lists only active medications', async () => {
    const h = buildHarness();
    const a = await h.create.execute(OWNER, CASE_ID, { ...FIELDS });
    await h.create.execute(OWNER, CASE_ID, { ...FIELDS, name: 'Synthetic Med B' });
    await h.archive.execute(OWNER, CASE_ID, a.id);

    const active = await h.list.execute(VIEWER, CASE_ID);
    expect(active).toHaveLength(1);
    expect(active[0]?.name).toBe('Synthetic Med B');
  });
});

describe('updating and archiving a medication', () => {
  it('updates a field and audits only the field names', async () => {
    const h = buildHarness();
    const medication = await h.create.execute(OWNER, CASE_ID, { ...FIELDS });
    const updated = await h.update.execute(OWNER, CASE_ID, medication.id, { dosage: '2 tablets' });
    expect(updated?.dosage).toBe('2 tablets');
    const event = h.audit.events.find((e) => e.action === 'medication.updated');
    expect(event?.changeSummary).toContain('dosage');
    expect(event?.changeSummary).not.toContain('2 tablets');
  });

  it('archiving twice is idempotent — the second attempt returns null', async () => {
    const h = buildHarness();
    const medication = await h.create.execute(OWNER, CASE_ID, { ...FIELDS });
    await h.archive.execute(OWNER, CASE_ID, medication.id);
    expect(await h.archive.execute(OWNER, CASE_ID, medication.id)).toBeNull();
  });
});

describe('importing a browser-only medication (UI cutover)', () => {
  it('is idempotent on legacyLocalId', async () => {
    const h = buildHarness();
    const first = await h.import.execute(OWNER, CASE_ID, {
      ...FIELDS,
      legacyLocalId: 'local-med-1',
    });
    const second = await h.import.execute(OWNER, CASE_ID, {
      ...FIELDS,
      legacyLocalId: 'local-med-1',
    });
    expect(second.id).toBe(first.id);
    expect(h.audit.events.filter((e) => e.action === 'medication.imported')).toHaveLength(1);
  });
});
