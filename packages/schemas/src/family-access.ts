import { z } from 'zod';
import type { FamilyAccessRole } from '@caredesk/domain';

export const familyAccessRoleSchema = z.enum(['owner', 'manager', 'viewer']);
export type { FamilyAccessRole };

export const inviteFamilyMemberRequestSchema = z.object({
  displayName: z.string().trim().min(2).max(100),
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  role: z.enum(['manager', 'viewer']),
});

export const updateFamilyMemberRoleRequestSchema = z.object({
  role: z.enum(['manager', 'viewer']),
});

export type InviteFamilyMemberRequest = z.infer<typeof inviteFamilyMemberRequestSchema>;
export type UpdateFamilyMemberRoleRequest = z.infer<typeof updateFamilyMemberRoleRequestSchema>;

export interface FamilyMemberResponse {
  membershipId: string;
  displayName: string;
  email: string;
  role: FamilyAccessRole;
  status: 'invited' | 'active';
  invitedAt: string;
  lastAuthenticatedAt: string | null;
  isCurrentUser: boolean;
}

export interface FamilyAccessResponse {
  members: FamilyMemberResponse[];
  canManage: boolean;
}
