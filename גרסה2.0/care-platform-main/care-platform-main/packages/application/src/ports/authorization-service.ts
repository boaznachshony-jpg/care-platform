import type { SensitivityClass } from '@caredesk/domain';

/**
 * Deny-by-default per Constitution §18: user → tenant membership → case
 * membership → role → permission → resource → sensitivity → time validity.
 * The UI may hide unavailable actions, but this is the only enforcement
 * that counts — it must be called from apps/api, never trusted from a client.
 */
export interface AuthorizationContext {
  userId: string;
  tenantId: string;
  caseId?: string;
  resourceType: string;
  action: string;
  sensitivity?: SensitivityClass;
}

export interface AuthorizationDecision {
  allowed: boolean;
  reason: string;
}

export interface AuthorizationService {
  check(context: AuthorizationContext): Promise<AuthorizationDecision>;
}
