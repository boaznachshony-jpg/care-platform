import type { SensitivityClass } from '@caredesk/domain';

/**
 * User-facing case history (database-blueprint.md §4.10) — distinct from
 * AuditService, which is the security record. Event type and summary are
 * translation keys, not display strings (Constitution §8).
 */
export interface TimelineEventInput {
  tenantId: string;
  employmentCaseId: string;
  eventTypeKey: string;
  occurredAt: string;
  summaryKey: string;
  sensitivity: SensitivityClass;
}

export interface TimelineService {
  record(event: TimelineEventInput): Promise<void>;
}
