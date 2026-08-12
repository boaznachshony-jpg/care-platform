import { z } from 'zod';
import { RACI_ROLES } from '@caredesk/domain';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date (YYYY-MM-DD) required');
export const visaRenewalAssignmentSchema = z.object({
  stepKey: z.string().trim().min(1).max(80),
  raciRole: z.enum(RACI_ROLES),
  assigneeType: z.enum(['user', 'contact']),
  assigneeId: z.string().uuid(),
});
export const startVisaRenewalRequestSchema = z.object({
  templateVersionId: z.string().uuid(),
  currentAuthorizationId: z.string().uuid(),
  asOf: isoDate,
  assignments: z.array(visaRenewalAssignmentSchema).min(2),
});
export type StartVisaRenewalRequest = z.infer<typeof startVisaRenewalRequestSchema>;
export const visaRenewalContactActivityRequestSchema = z.object({
  channel: z.enum(['phone', 'email', 'whatsapp', 'office', 'portal']),
  occurredAt: z.string().datetime(),
  purpose: z.string().trim().min(1).max(240),
  outcome: z.string().trim().min(1).max(1000),
  followUpAt: z.string().datetime().nullable().optional(),
  confirmationStatus: z.enum(['not_requested', 'pending', 'confirmed']).default('not_requested'),
  sensitivity: z
    .enum(['general', 'employment_sensitive', 'identity_sensitive'])
    .default('employment_sensitive'),
  visibility: z.enum(['tenant', 'case']).default('case'),
});
export const linkRenewedAuthorizationRequestSchema = z.object({
  documentVersionId: z.string().uuid(),
  authorizationType: z.string().trim().min(1).max(80),
  issuer: z.string().trim().min(1).max(160),
  validFrom: isoDate,
  validTo: isoDate,
});
