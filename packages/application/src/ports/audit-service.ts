import type { SensitivityClass } from '@caredesk/domain';

/**
 * Append-only security/change record (Constitution §19). Never include
 * secrets, full sensitive values, files, or AI prompt contents — that's
 * what TimelineService's user-facing history is for, and even that only
 * gets translated summaries, not raw sensitive data.
 */
export interface AuditEventInput {
  tenantId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  correlationId: string;
  occurredAt: string;
  changeSummary?: string;
  sensitivity?: SensitivityClass;
}

export interface AuditService {
  record(event: AuditEventInput): Promise<void>;
}
