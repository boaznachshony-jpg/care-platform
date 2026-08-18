import type { WorkflowInstanceStatus } from '@caredesk/domain';

/**
 * Shell only (Milestone 0) — Workflow states and transitions must be
 * explicit and server-validated (Constitution §21). Real templates (Visa
 * Renewal, Medical Insurance Renewal, Employment Closure) are defined from
 * Milestone 2 onward, per database-blueprint.md §4.6.
 */
const ALLOWED_TRANSITIONS: Readonly<
  Record<WorkflowInstanceStatus, readonly WorkflowInstanceStatus[]>
> = {
  not_started: ['active', 'cancelled'],
  active: ['blocked', 'completed', 'cancelled'],
  blocked: ['active', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function isAllowedTransition(
  from: WorkflowInstanceStatus,
  to: WorkflowInstanceStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
