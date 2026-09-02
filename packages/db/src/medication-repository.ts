import type {
  CreateMedicationRecord,
  MedicationRepository,
  UpdateMedicationRecord,
} from '@caredesk/application';
import { brandId, type Medication } from '@caredesk/domain';
import type { Pool } from 'pg';
import { withTenant } from './pool.js';

interface MedicationRow {
  id: string;
  tenant_id: string;
  employment_case_id: string;
  name: string;
  dosage: string;
  times_of_day: string[];
  daily: boolean;
  days_of_week: string[] | null;
  prescribing_doctor: string;
  notes: string;
  status: string;
  sensitivity: string;
  legacy_local_id: string | null;
}

function toMedication(row: MedicationRow): Medication {
  return {
    id: brandId(row.id),
    tenantId: brandId(row.tenant_id),
    employmentCaseId: brandId(row.employment_case_id),
    name: row.name,
    dosage: row.dosage,
    timesOfDay: row.times_of_day as Medication['timesOfDay'],
    daily: row.daily,
    daysOfWeek: row.days_of_week as Medication['daysOfWeek'],
    prescribingDoctor: row.prescribing_doctor,
    notes: row.notes,
    status: row.status as Medication['status'],
    sensitivity: row.sensitivity as Medication['sensitivity'],
    legacyLocalId: row.legacy_local_id,
  };
}

const MEDICATION_COLUMNS = `id, tenant_id, employment_case_id, name, dosage, times_of_day,
  daily, days_of_week, prescribing_doctor, notes, status, sensitivity, legacy_local_id`;

export class PgMedicationRepository implements MedicationRepository {
  constructor(private readonly pool: Pool) {}

  async createMedication(input: CreateMedicationRecord): Promise<Medication> {
    return withTenant(this.pool, input.tenantId, async (client) => {
      const result = await client.query<MedicationRow>(
        `insert into medication
           (id, tenant_id, employment_case_id, name, dosage, times_of_day, daily, days_of_week,
            prescribing_doctor, notes, created_by, updated_by, legacy_local_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12)
         returning ${MEDICATION_COLUMNS}`,
        [
          input.id,
          input.tenantId,
          input.employmentCaseId,
          input.name,
          input.dosage,
          input.timesOfDay,
          input.daily,
          input.daysOfWeek,
          input.prescribingDoctor,
          input.notes,
          input.createdBy,
          input.legacyLocalId ?? null,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error('Medication insert returned no row.');
      }
      return toMedication(row);
    });
  }

  async listMedications(tenantId: string, employmentCaseId: string): Promise<Medication[]> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<MedicationRow>(
        `select ${MEDICATION_COLUMNS} from medication
         where employment_case_id = $1 and status = 'active'
         order by created_at asc`,
        [employmentCaseId],
      );
      return result.rows.map(toMedication);
    });
  }

  async findMedication(tenantId: string, medicationId: string): Promise<Medication | null> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<MedicationRow>(
        `select ${MEDICATION_COLUMNS} from medication where id = $1`,
        [medicationId],
      );
      const row = result.rows[0];
      return row ? toMedication(row) : null;
    });
  }

  async findMedicationByLegacyLocalId(
    tenantId: string,
    employmentCaseId: string,
    legacyLocalId: string,
  ): Promise<Medication | null> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<MedicationRow>(
        `select ${MEDICATION_COLUMNS} from medication
         where employment_case_id = $1 and legacy_local_id = $2`,
        [employmentCaseId, legacyLocalId],
      );
      const row = result.rows[0];
      return row ? toMedication(row) : null;
    });
  }

  async updateMedication(
    tenantId: string,
    medicationId: string,
    changes: UpdateMedicationRecord,
    updatedBy: string,
  ): Promise<Medication | null> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<MedicationRow>(
        `update medication
            set name = coalesce($2, name),
                dosage = coalesce($3, dosage),
                times_of_day = coalesce($4, times_of_day),
                daily = coalesce($5, daily),
                days_of_week = case when $6::boolean then $7 else days_of_week end,
                prescribing_doctor = coalesce($8, prescribing_doctor),
                notes = coalesce($9, notes),
                updated_at = now(), updated_by = $10, version = version + 1
          where id = $1 and status <> 'archived'
         returning ${MEDICATION_COLUMNS}`,
        [
          medicationId,
          changes.name ?? null,
          changes.dosage ?? null,
          changes.timesOfDay ?? null,
          changes.daily ?? null,
          changes.daysOfWeek !== undefined,
          changes.daysOfWeek ?? null,
          changes.prescribingDoctor ?? null,
          changes.notes ?? null,
          updatedBy,
        ],
      );
      const row = result.rows[0];
      return row ? toMedication(row) : null;
    });
  }

  async archiveMedication(
    tenantId: string,
    medicationId: string,
    updatedBy: string,
  ): Promise<Medication | null> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<MedicationRow>(
        `update medication
            set status = 'archived', updated_at = now(), updated_by = $2, version = version + 1
          where id = $1 and status <> 'archived'
         returning ${MEDICATION_COLUMNS}`,
        [medicationId, updatedBy],
      );
      const row = result.rows[0];
      return row ? toMedication(row) : null;
    });
  }
}
