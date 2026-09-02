import type { Medication } from '@caredesk/domain';

export interface CreateMedicationRecord {
  id: string;
  tenantId: string;
  employmentCaseId: string;
  name: string;
  dosage: string;
  timesOfDay: Medication['timesOfDay'];
  daily: boolean;
  daysOfWeek: Medication['daysOfWeek'];
  prescribingDoctor: string;
  notes: string;
  createdBy: string;
  /** Set only by ImportMedication — see Medication.legacyLocalId. */
  legacyLocalId?: string | null;
}

export interface UpdateMedicationRecord {
  name?: string;
  dosage?: string;
  timesOfDay?: Medication['timesOfDay'];
  daily?: boolean;
  daysOfWeek?: Medication['daysOfWeek'];
  prescribingDoctor?: string;
  notes?: string;
}

export interface MedicationRepository {
  createMedication(input: CreateMedicationRecord): Promise<Medication>;
  /** Active medications only — an archived one is history, not today's regimen. */
  listMedications(tenantId: string, employmentCaseId: string): Promise<Medication[]>;
  findMedication(tenantId: string, medicationId: string): Promise<Medication | null>;
  /**
   * The medication previously imported from this local id, or null. Read
   * before any import write — see TaskRepository.findTaskByLegacyLocalId.
   */
  findMedicationByLegacyLocalId(
    tenantId: string,
    employmentCaseId: string,
    legacyLocalId: string,
  ): Promise<Medication | null>;
  /** Returns null when the medication does not exist or is already archived. */
  updateMedication(
    tenantId: string,
    medicationId: string,
    changes: UpdateMedicationRecord,
    updatedBy: string,
  ): Promise<Medication | null>;
  /** Soft-close, never a delete — see database/migrations/0046 for why. */
  archiveMedication(
    tenantId: string,
    medicationId: string,
    updatedBy: string,
  ): Promise<Medication | null>;
}
