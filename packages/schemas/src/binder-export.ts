import { z } from 'zod';

/**
 * Emergency Binder export contract (capability #15), shared by the route that
 * validates it and the page that sends it.
 *
 * It lived inside `apps/api/src/routes/binder-exports.ts` while the page kept
 * its own list of sections. The two lists drifted: the page added
 * `medications` and every default export was refused with 400, which the
 * page then showed as an "unrecorded local print". The page test asserted the
 * refused payload as correct, because it mocked the API client and never met
 * the server's schema. One list here makes that drift a type error.
 *
 * The order is the canonical order: the server hashes sections in this order,
 * and the page prints them in it. Append-only for existing sections - moving
 * one would change the hash of every receipt that names it.
 */
export const BINDER_SECTIONS = [
  'case',
  'caregiver',
  'medications',
  'documents',
  'payroll',
  'tasks',
  'contacts',
] as const;
export type BinderSection = (typeof BINDER_SECTIONS)[number];

/**
 * The selections the page offers. Each must be accepted by
 * `createBinderExportRequestSchema`; the API route test sends every one of
 * them and expects 201.
 */
export const BINDER_EXPORT_PRESETS = {
  full: BINDER_SECTIONS,
  review: ['case', 'caregiver', 'documents', 'payroll'],
  // A handover is the case this binder exists for, so the standing
  // medications belong in it before anything administrative does.
  handoff: ['case', 'caregiver', 'medications', 'tasks', 'contacts'],
  documents: ['documents'],
} as const satisfies Record<string, readonly BinderSection[]>;
export type BinderExportPreset = keyof typeof BINDER_EXPORT_PRESETS;

/**
 * The explicit selection manifest. Nothing is implied: a section or document
 * that was not named here was not exported, and every document id must belong
 * to the case (verified server-side) before a receipt exists.
 */
export const createBinderExportRequestSchema = z
  .object({
    sections: z.array(z.enum(BINDER_SECTIONS)).min(1).max(BINDER_SECTIONS.length),
    documentIds: z.array(z.string().uuid()).max(200).default([]),
  })
  .strict()
  .refine((value) => value.documentIds.length === 0 || value.sections.includes('documents'), {
    path: ['documentIds'],
    message: 'documentIds requires the documents section',
  });
export type CreateBinderExportRequest = z.infer<typeof createBinderExportRequestSchema>;
