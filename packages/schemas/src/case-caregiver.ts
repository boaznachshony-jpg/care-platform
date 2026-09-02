import { z } from 'zod';

/**
 * Fields a family may correct after intake. Deliberately excludes the
 * passport number carried in the browser-only profile
 * (`MvpProfile.caregiverPassportNumber`) — see
 * packages/application/src/ports/case-foundation-repository.ts for why: it
 * belongs on the existing document-upload path, not a plaintext profile field.
 */
export const updateCaregiverRequestSchema = z
  .object({
    legalName: z.string().trim().min(2).max(120).optional(),
    preferredName: z.string().trim().max(120).nullable().optional(),
    nationality: z.string().trim().min(2).max(60).optional(),
    primaryLanguage: z.string().trim().max(60).nullable().optional(),
  })
  .strict();

export type UpdateCaregiverRequest = z.infer<typeof updateCaregiverRequestSchema>;

export const caregiverResponseSchema = z.object({
  id: z.string(),
  legalName: z.string(),
  preferredName: z.string().nullable(),
  nationality: z.string(),
  primaryLanguage: z.string().nullable(),
});

export type CaregiverResponse = z.infer<typeof caregiverResponseSchema>;
