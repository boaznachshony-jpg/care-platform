import type {
  CreateMedicationRecord,
  MedicationRepository,
  UpdateMedicationRecord,
} from '@caredesk/application';
import { brandId, type Medication } from '@caredesk/domain';

/** Mirrors PgMedicationRepository's contract without a database — see in-memory-task-repository.ts. */
export class InMemoryMedicationRepository implements MedicationRepository {
  private readonly byTenant = new Map<string, Medication[]>();

  async createMedication(input: CreateMedicationRecord): Promise<Medication> {
    const medication: Medication = {
      id: brandId(input.id),
      tenantId: brandId(input.tenantId),
      employmentCaseId: brandId(input.employmentCaseId),
      name: input.name,
      dosage: input.dosage,
      timesOfDay: input.timesOfDay,
      daily: input.daily,
      daysOfWeek: input.daysOfWeek,
      prescribingDoctor: input.prescribingDoctor,
      notes: input.notes,
      status: 'active',
      sensitivity: 'care_sensitive',
      legacyLocalId: input.legacyLocalId ?? null,
    };
    const rows = this.byTenant.get(input.tenantId) ?? [];
    rows.push(medication);
    this.byTenant.set(input.tenantId, rows);
    return medication;
  }

  async listMedications(tenantId: string, employmentCaseId: string): Promise<Medication[]> {
    return (this.byTenant.get(tenantId) ?? []).filter(
      (medication) =>
        medication.employmentCaseId === employmentCaseId && medication.status === 'active',
    );
  }

  async findMedication(tenantId: string, medicationId: string): Promise<Medication | null> {
    return (this.byTenant.get(tenantId) ?? []).find((m) => m.id === medicationId) ?? null;
  }

  async findMedicationByLegacyLocalId(
    tenantId: string,
    employmentCaseId: string,
    legacyLocalId: string,
  ): Promise<Medication | null> {
    return (
      (this.byTenant.get(tenantId) ?? []).find(
        (m) => m.employmentCaseId === employmentCaseId && m.legacyLocalId === legacyLocalId,
      ) ?? null
    );
  }

  async updateMedication(
    tenantId: string,
    medicationId: string,
    changes: UpdateMedicationRecord,
    _updatedBy: string,
  ): Promise<Medication | null> {
    const rows = this.byTenant.get(tenantId) ?? [];
    const index = rows.findIndex((m) => m.id === medicationId && m.status !== 'archived');
    if (index === -1) return null;
    const existing = rows[index];
    if (!existing) return null;
    const updated: Medication = {
      ...existing,
      name: changes.name ?? existing.name,
      dosage: changes.dosage ?? existing.dosage,
      timesOfDay: changes.timesOfDay ?? existing.timesOfDay,
      daily: changes.daily ?? existing.daily,
      daysOfWeek: changes.daysOfWeek !== undefined ? changes.daysOfWeek : existing.daysOfWeek,
      prescribingDoctor: changes.prescribingDoctor ?? existing.prescribingDoctor,
      notes: changes.notes ?? existing.notes,
    };
    rows[index] = updated;
    return updated;
  }

  async archiveMedication(
    tenantId: string,
    medicationId: string,
    _updatedBy: string,
  ): Promise<Medication | null> {
    const rows = this.byTenant.get(tenantId) ?? [];
    const index = rows.findIndex((m) => m.id === medicationId && m.status !== 'archived');
    if (index === -1) return null;
    const existing = rows[index];
    if (!existing) return null;
    const updated: Medication = { ...existing, status: 'archived' };
    rows[index] = updated;
    return updated;
  }
}
