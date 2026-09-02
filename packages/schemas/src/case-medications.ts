import { z } from 'zod';
import { MEDICATION_DAYS_OF_WEEK, MEDICATION_TIMES_OF_DAY } from '@caredesk/domain';

const medicationFieldsSchema = {
  name: z.string().trim().min(1).max(160),
  dosage: z.string().trim().max(200).default(''),
  timesOfDay: z.array(z.enum(MEDICATION_TIMES_OF_DAY)).max(4).default([]),
  daily: z.boolean().default(true),
  /**
   * Three states, deliberately preserved end to end (see Medication.daysOfWeek
   * in packages/domain/src/entities.ts): omit the field for "not asked",
   * send `[]` for "asked, chose none", send a list for specific days.
   */
  daysOfWeek: z.array(z.enum(MEDICATION_DAYS_OF_WEEK)).max(7).nullable().optional(),
  prescribingDoctor: z.string().trim().max(160).default(''),
  notes: z.string().trim().max(1000).default(''),
} as const;

export const createMedicationRequestSchema = z.object(medicationFieldsSchema);
export type CreateMedicationRequest = z.infer<typeof createMedicationRequestSchema>;

export const updateMedicationRequestSchema = z
  .object({
    name: medicationFieldsSchema.name.optional(),
    dosage: medicationFieldsSchema.dosage.optional(),
    timesOfDay: medicationFieldsSchema.timesOfDay.optional(),
    daily: medicationFieldsSchema.daily.optional(),
    daysOfWeek: medicationFieldsSchema.daysOfWeek,
    prescribingDoctor: medicationFieldsSchema.prescribingDoctor.optional(),
    notes: medicationFieldsSchema.notes.optional(),
  })
  .strict();
export type UpdateMedicationRequest = z.infer<typeof updateMedicationRequestSchema>;

/**
 * Upload of one browser-only medication (`MvpMedication` in mvp-storage.ts).
 * `legacyLocalId` is what the server keys idempotency on (migration 0046).
 */
export const importMedicationRequestSchema = z.object({
  legacyLocalId: z.string().trim().min(1).max(200),
  ...medicationFieldsSchema,
});
export type ImportMedicationRequest = z.infer<typeof importMedicationRequestSchema>;

export const medicationResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  dosage: z.string(),
  timesOfDay: z.array(z.string()),
  daily: z.boolean(),
  daysOfWeek: z.array(z.string()).nullable(),
  prescribingDoctor: z.string(),
  notes: z.string(),
  status: z.string(),
  legacyLocalId: z.string().nullable(),
});
export type MedicationResponse = z.infer<typeof medicationResponseSchema>;
