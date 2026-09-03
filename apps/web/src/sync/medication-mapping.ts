import type { MedicationResponse, UpdateMedicationRequest } from '@caredesk/schemas';
import type { MvpMedication, MvpMedicationDay, MvpMedicationTime } from '../storage/mvp-storage.js';

/**
 * Order-insensitive comparison. `timesOfDay`/`daysOfWeek` are toggled by
 * clicking checkboxes (see MedicationsPage's `toggleTime`/`toggleDay`) and
 * are not guaranteed to come back in the same order the server returns them
 * in, so a plain array `===`/index comparison would report a divergence that
 * is really just a reordering and trigger a pointless PATCH on every sync.
 */
function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((item) => setA.has(item));
}

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

/**
 * Defect 1 fix, half two: detects whether a local medication that already
 * has a server counterpart has since been edited on this device, so the
 * sync effect knows whether an update is owed. `daysOfWeek` compares the
 * three-state field (see `medicationFieldsSchema.daysOfWeek`'s own comment)
 * as-is: `undefined` (never asked) and `[]` (asked, chose none) are kept
 * distinct here exactly as they are everywhere else in this cutover.
 */
export function localMedicationDivergesFromResponse(
  local: MvpMedication,
  response: MedicationResponse,
): boolean {
  if (local.name !== response.name) return true;
  if (local.dosage !== response.dosage) return true;
  if (!sameMembers(local.timesOfDay, response.timesOfDay)) return true;
  if (local.daily !== response.daily) return true;
  const localDays = local.daysOfWeek ?? null;
  const responseDays = response.daysOfWeek;
  if ((localDays === null) !== (responseDays === null)) return true;
  if (localDays && responseDays && !sameMembers(localDays, responseDays)) return true;
  if (local.prescribingDoctor !== response.prescribingDoctor) return true;
  if (local.notes !== response.notes) return true;
  return false;
}

/** Builds the PATCH body for pushing a local medication edit to the canonical record. */
export function updateRequestForLocalMedication(local: MvpMedication): UpdateMedicationRequest {
  return {
    name: local.name,
    dosage: local.dosage,
    timesOfDay: local.timesOfDay,
    daily: local.daily,
    daysOfWeek: local.daysOfWeek ?? undefined,
    prescribingDoctor: local.prescribingDoctor,
    notes: local.notes,
  };
}
