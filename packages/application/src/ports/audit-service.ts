import type { SensitivityClass } from '@caredesk/domain';

/**
 * Append-only security/change record (Constitution §19). Never include
 * secrets, full sensitive values, files, or AI prompt contents — that's
 * what TimelineService's user-facing history is for, and even that only
 * gets translated summaries, not raw sensitive data.
 */
export interface AuditEventInput {
  tenantId: string;
  /**
   * Null only when no authenticated human actor exists — e.g. the recurring
   * billing cron. The audit table's `actor_id` column is nullable for exactly
   * this case; authenticated actions must always set it.
   */
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  correlationId: string;
  occurredAt: string;
  changeSummary?: string;
  sensitivity?: SensitivityClass;
  /**
   * Defaults to `allowed`. A refused attempt is the more interesting audit
   * event of the two — it is how an attempt to reach another tenant's data
   * becomes visible at all.
   */
  permissionDecision?: 'allowed' | 'denied';
  /**
   * Why the attempt was refused, or the justification given for a privileged
   * access. Required when `permissionDecision` is `denied` — the database
   * enforces this, because a denial nobody can explain is not evidence.
   */
  reason?: string;
}

export interface AuditService {
  record(event: AuditEventInput): Promise<void>;
}
