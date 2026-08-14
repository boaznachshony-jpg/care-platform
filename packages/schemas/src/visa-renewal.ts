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
export const visaRenewalContactActivityRequestSchema = z
  .object({
    workflowStepId: z.string().uuid().nullable().optional(),
    organizationId: z.string().uuid().nullable().optional(),
    contactId: z.string().uuid().nullable().optional(),
    channel: z.enum(['phone', 'email', 'whatsapp', 'meeting', 'letter', 'sms', 'portal']),
    occurredAt: z.string().datetime(),
    purpose: z.string().trim().min(1).max(240),
    outcome: z.string().trim().min(1).max(1000),
    followUpAt: z.string().datetime().nullable().optional(),
    confirmationStatus: z.enum(['not_requested', 'pending', 'confirmed']).default('not_requested'),
    sensitivity: z
      .enum(['general', 'employment_sensitive', 'identity_sensitive'])
      .default('employment_sensitive'),
    visibility: z.enum(['tenant', 'case']).default('case'),
  })
  .refine((value) => value.organizationId || value.contactId, {
    message: 'An organization or contact is required',
    path: ['organizationId'],
  });
export const linkRenewedAuthorizationRequestSchema = z
  .object({
    documentVersionId: z.string().uuid(),
    validFrom: isoDate,
    validTo: isoDate,
  })
  .refine((value) => value.validTo >= value.validFrom, {
    message: 'validTo must be on or after validFrom',
    path: ['validTo'],
  });
export const resolveAuthorizationOverlapRequestSchema = z.object({
  resolutionCode: z.string().trim().min(1).max(100),
});
export const completeVisaRenewalRequestSchema = z.object({ taskId: z.string().uuid() });
