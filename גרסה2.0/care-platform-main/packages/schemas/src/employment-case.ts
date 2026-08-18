import { z } from 'zod';

/**
 * Milestone 1 open-case contract. Deliberately excludes identity-sensitive
 * credentials (passport numbers, bank details) — those arrive with the
 * encrypted-field/document design, never as plain request fields
 * (database-blueprint.md §4.2, Constitution §16).
 */
export const openEmploymentCaseRequestSchema = z.object({
  careRecipient: z.object({
    fullName: z.string().trim().min(2).max(120),
    careLevel: z.string().trim().max(60).optional(),
    city: z.string().trim().max(80).optional(),
  }),
  employer: z.object({
    fullName: z.string().trim().min(2).max(120),
    relationshipToRecipient: z.string().trim().min(2).max(60),
    city: z.string().trim().max(80).optional(),
  }),
  caregiver: z.object({
    legalName: z.string().trim().min(2).max(120),
    preferredName: z.string().trim().max(120).optional(),
    nationality: z.string().trim().min(2).max(60),
    primaryLanguage: z.string().trim().max(60).optional(),
  }),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date (YYYY-MM-DD) required'),
});

export type OpenEmploymentCaseRequest = z.infer<typeof openEmploymentCaseRequestSchema>;

export const employmentCaseResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  careRecipient: z.object({
    id: z.string(),
    fullName: z.string(),
    careLevel: z.string().nullable(),
    city: z.string().nullable(),
  }),
  employer: z.object({
    id: z.string(),
    fullName: z.string(),
    relationshipToRecipient: z.string(),
    city: z.string().nullable(),
  }),
  caregiver: z.object({
    id: z.string(),
    legalName: z.string(),
    preferredName: z.string().nullable(),
    nationality: z.string(),
    primaryLanguage: z.string().nullable(),
  }),
});

export type EmploymentCaseResponse = z.infer<typeof employmentCaseResponseSchema>;
