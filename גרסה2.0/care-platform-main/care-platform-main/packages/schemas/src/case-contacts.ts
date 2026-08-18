import { z } from 'zod';
import { CONTACT_CHANNEL_TYPES, ORGANIZATION_TYPES } from '@caredesk/domain';

export const addContactRequestSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  title: z.string().trim().max(80).optional(),
  preferredChannel: z.enum(CONTACT_CHANNEL_TYPES).optional(),
  /** Attach to an existing organization, or create one inline by name+type. */
  organizationId: z.string().uuid().optional(),
  organization: z
    .object({
      name: z.string().trim().min(2).max(120),
      organizationType: z.enum(ORGANIZATION_TYPES),
      phone: z.string().trim().max(40).optional(),
      email: z.string().trim().email().max(160).optional(),
    })
    .optional(),
  /** Role on the case. A contact without a role is not attached to any case. */
  roleType: z.string().trim().min(2).max(60),
  isPrimary: z.boolean().optional(),
  isEmergency: z.boolean().optional(),
});

export type AddContactRequest = z.infer<typeof addContactRequestSchema>;

export const caseContactResponseSchema = z.object({
  roleId: z.string(),
  contactId: z.string(),
  fullName: z.string(),
  title: z.string().nullable(),
  roleType: z.string(),
  isPrimary: z.boolean(),
  isEmergency: z.boolean(),
  organizationName: z.string().nullable(),
  organizationType: z.string().nullable(),
});

export type CaseContactResponse = z.infer<typeof caseContactResponseSchema>;
