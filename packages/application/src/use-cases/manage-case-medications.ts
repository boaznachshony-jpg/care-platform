import type { Medication } from '@caredesk/domain';
import type { AuditService } from '../ports/audit-service.js';
import type { AuthorizationService } from '../ports/authorization-service.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { MedicationRepository } from '../ports/medication-repository.js';
import type { TimelineService } from '../ports/timeline-service.js';
import type { Actor } from './actor.js';
import { authorizeOrThrow } from './authorize.js';

export interface MedicationFields {
  name: string;
  dosage: string;
  timesOfDay: Medication['timesOfDay'];
  daily: boolean;
  daysOfWeek: Medication['daysOfWeek'];
  prescribingDoctor: string;
  notes: string;
}

export interface CaseMedicationDeps {
  authorization: AuthorizationService;
  medications: MedicationRepository;
  audit: AuditService;
  timeline: TimelineService;
  clock: Clock;
  ids: IdGenerator;
}

/**
 * Every operation below uses the `medication:*` resource type and the
 * `care_sensitive` class, never `identity_sensitive` or
 * `financial_sensitive` — a medication regimen is a health fact about the
 * care recipient, the same category `care_recipient` itself carries
 * (migration 0003's `sensitivity` default).
 */
const MEDICATION_SENSITIVITY = 'care_sensitive' as const;

/**
 * Audit and timeline entries for medications never carry the name, dosage, or
 * notes — only the action and the record id — mirroring the minimization rule
 * `UploadCaseDocument` already applies to document type (never file name or
 * content). A medication name is itself the sensitive fact.
 */
export class CreateMedication {
  constructor(private readonly deps: CaseMedicationDeps) {}

  async execute(actor: Actor, caseId: string, input: MedicationFields): Promise<Medication> {
    await authorizeOrThrow(this.deps, actor, {
      resourceType: 'medication',
      action: 'create',
      caseId,
      sensitivity: MEDICATION_SENSITIVITY,
    });

    const now = this.deps.clock.now().toISOString();
    const medication = await this.deps.medications.createMedication({
      id: this.deps.ids.next(),
      tenantId: actor.tenantId,
      employmentCaseId: caseId,
      name: input.name,
      dosage: input.dosage,
      timesOfDay: input.timesOfDay,
      daily: input.daily,
      daysOfWeek: input.daysOfWeek,
      prescribingDoctor: input.prescribingDoctor,
      notes: input.notes,
      createdBy: actor.userId,
    });

    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'medication.created',
      resourceType: 'medication',
      resourceId: medication.id,
      correlationId: actor.correlationId,
      occurredAt: now,
      sensitivity: MEDICATION_SENSITIVITY,
    });

    await this.deps.timeline.record({
      tenantId: actor.tenantId,
      employmentCaseId: caseId,
      eventTypeKey: 'timeline.medication.created',
      occurredAt: now,
      summaryKey: 'timeline.medication.created.summary',
      sensitivity: 'general',
    });

    return medication;
  }
}

export class ListMedications {
  constructor(
    private readonly deps: Pick<
      CaseMedicationDeps,
      'authorization' | 'medications' | 'audit' | 'clock'
    >,
  ) {}

  async execute(actor: Actor, caseId: string): Promise<Medication[]> {
    await authorizeOrThrow(this.deps, actor, {
      resourceType: 'medication',
      action: 'read',
      caseId,
      sensitivity: MEDICATION_SENSITIVITY,
    });
    return this.deps.medications.listMedications(actor.tenantId, caseId);
  }
}

export class UpdateMedication {
  constructor(private readonly deps: CaseMedicationDeps) {}

  /** Returns null when the medication does not exist, is in another tenant, or is archived. */
  async execute(
    actor: Actor,
    caseId: string,
    medicationId: string,
    changes: Partial<MedicationFields>,
  ): Promise<Medication | null> {
    await authorizeOrThrow(this.deps, actor, {
      resourceType: 'medication',
      action: 'update',
      caseId,
      resourceId: medicationId,
      sensitivity: MEDICATION_SENSITIVITY,
    });

    const now = this.deps.clock.now().toISOString();
    const medication = await this.deps.medications.updateMedication(
      actor.tenantId,
      medicationId,
      changes,
      actor.userId,
    );
    if (!medication) return null;

    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'medication.updated',
      resourceType: 'medication',
      resourceId: medication.id,
      correlationId: actor.correlationId,
      occurredAt: now,
      changeSummary: `Medication fields updated: ${Object.keys(changes).join(', ') || 'none'}.`,
      sensitivity: MEDICATION_SENSITIVITY,
    });

    return medication;
  }
}

export class ArchiveMedication {
  constructor(private readonly deps: CaseMedicationDeps) {}

  /** Returns null when the medication does not exist, is in another tenant, or is already archived. */
  async execute(actor: Actor, caseId: string, medicationId: string): Promise<Medication | null> {
    await authorizeOrThrow(this.deps, actor, {
      resourceType: 'medication',
      action: 'update',
      caseId,
      resourceId: medicationId,
      sensitivity: MEDICATION_SENSITIVITY,
    });

    const now = this.deps.clock.now().toISOString();
    const medication = await this.deps.medications.archiveMedication(
      actor.tenantId,
      medicationId,
      actor.userId,
    );
    if (!medication) return null;

    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'medication.archived',
      resourceType: 'medication',
      resourceId: medication.id,
      correlationId: actor.correlationId,
      occurredAt: now,
      changeSummary: 'Medication status changed to archived.',
      sensitivity: MEDICATION_SENSITIVITY,
    });

    await this.deps.timeline.record({
      tenantId: actor.tenantId,
      employmentCaseId: caseId,
      eventTypeKey: 'timeline.medication.archived',
      occurredAt: now,
      summaryKey: 'timeline.medication.archived.summary',
      sensitivity: 'general',
    });

    return medication;
  }
}

export interface ImportMedicationInput extends MedicationFields {
  legacyLocalId: string;
}

/** Idempotent create for the UI cutover — mirrors ImportCaseTask/ImportCaseDocument. */
export class ImportMedication {
  constructor(private readonly deps: CaseMedicationDeps) {}

  async execute(actor: Actor, caseId: string, input: ImportMedicationInput): Promise<Medication> {
    await authorizeOrThrow(this.deps, actor, {
      resourceType: 'medication',
      action: 'create',
      caseId,
      sensitivity: MEDICATION_SENSITIVITY,
    });

    const existing = await this.deps.medications.findMedicationByLegacyLocalId(
      actor.tenantId,
      caseId,
      input.legacyLocalId,
    );
    if (existing) return existing;

    const now = this.deps.clock.now().toISOString();
    const medication = await this.deps.medications.createMedication({
      id: this.deps.ids.next(),
      tenantId: actor.tenantId,
      employmentCaseId: caseId,
      name: input.name,
      dosage: input.dosage,
      timesOfDay: input.timesOfDay,
      daily: input.daily,
      daysOfWeek: input.daysOfWeek,
      prescribingDoctor: input.prescribingDoctor,
      notes: input.notes,
      createdBy: actor.userId,
      legacyLocalId: input.legacyLocalId,
    });

    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'medication.imported',
      resourceType: 'medication',
      resourceId: medication.id,
      correlationId: actor.correlationId,
      occurredAt: now,
      changeSummary: 'Medication imported from local device record.',
      sensitivity: MEDICATION_SENSITIVITY,
    });

    await this.deps.timeline.record({
      tenantId: actor.tenantId,
      employmentCaseId: caseId,
      eventTypeKey: 'timeline.medication.imported',
      occurredAt: now,
      summaryKey: 'timeline.medication.imported.summary',
      sensitivity: 'general',
    });

    return medication;
  }
}
