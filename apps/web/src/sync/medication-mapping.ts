import type { MedicationResponse } from '@caredesk/schemas';
import type { MvpMedication, MvpMedicationDay, MvpMedicationTime } from '../storage/mvp-storage.js';

/**
 * Unlike tasks and documents, medications need no value-mapping table: the
 * server vocabulary (`MEDICATION_TIMES_OF_DAY`/`MEDICATION_DAYS_OF_WEEK` in
 * @caredesk/domain) was deliberately kept identical to the browser-only one
 * (`MEDICATION_TIMES`/`MEDICATION_DAYS` in mvp-storage.ts) — see the code
 * comment on those constants. The only shape change is field naming
 * (`daysOfWeek: string[] | null` server-side vs. `string[] | undefined`
 * locally), which this function normalises.
 */
export function medicationResponseToLocal(response: MedicationResponse): MvpMedication {
  return {
    id: response.legacyLocalId ?? response.id,
    name: response.name,
    dosage: response.dosage,
    timesOfDay: response.timesOfDay as MvpMedicationTime[],
    daily: response.daily,
    daysOfWeek:
      response.daysOfWeek === null ? undefined : (response.daysOfWeek as MvpMedicationDay[]),
    prescribingDoctor: response.prescribingDoctor,
    notes: response.notes,
    updatedAt: '',
  };
}
