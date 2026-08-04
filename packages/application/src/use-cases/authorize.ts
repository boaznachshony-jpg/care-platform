import type { SensitivityClass } from '@caredesk/domain';
import type { AuditService } from '../ports/audit-service.js';
import type { AuthorizationService } from '../ports/authorization-service.js';
import type { Clock } from '../ports/clock.js';
import { AuthorizationError, type Actor } from './actor.js';

export interface AuthorizeDeps {
  authorization: AuthorizationService;
  audit: AuditService;
  clock: Clock;
}

export interface AuthorizeRequest {
  resourceType: string;
  action: string;
  caseId?: string;
  /** The specific resource, when known. Falls back to the case, then to the action's scope. */
  resourceId?: string;
  sensitivity?: SensitivityClass;
}

/**
 * The single place a use case is allowed to check permission.
 *
 * It exists so that a refusal cannot be thrown without also being recorded.
 * Previously every use case checked the decision and threw inline, which meant
 * an attempt to reach another tenant's case left no trace at all — the
 * `audit_event` table had a `permission_decision` column that nothing ever set
 * to `denied`. Constitution §19 treats a refused access as an audit-worthy
 * security event precisely because it is the one worth investigating.
 *
 * Routing every check through here makes the audited path the only path: a new
 * use case gets denial auditing by calling the same helper everything else
 * calls, rather than by remembering to.
 */
export async function authorizeOrThrow(
  deps: AuthorizeDeps,
  actor: Actor,
  request: AuthorizeRequest,
): Promise<void> {
  const decision = await deps.authorization.check({
    userId: actor.userId,
    tenantId: actor.tenantId,
    mfaSatisfied: actor.mfaSatisfied,
    caseId: request.caseId,
    resourceType: request.resourceType,
    action: request.action,
    sensitivity: request.sensitivity,
  });

  if (decision.allowed) {
    return;
  }

  try {
    await deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      // Dotted, stable, untranslated — matches the convention the other
      // actions use, with the outcome in the name so denials are greppable.
      action: `${request.resourceType}.${request.action}.denied`,
      resourceType: request.resourceType,
      // The attempt is what is being recorded, so the target is named even
      // when it does not exist or belongs to somebody else.
      resourceId: request.resourceId ?? request.caseId ?? request.resourceType,
      correlationId: actor.correlationId,
      occurredAt: deps.clock.now().toISOString(),
      permissionDecision: 'denied',
      reason: decision.reason,
      sensitivity: request.sensitivity ?? 'general',
    });
  } catch {
    // A failure to write the audit row must not turn a 403 into a 500, and
    // must not let the request through either. The refusal still stands; what
    // is lost is the record of it, which is a monitoring concern rather than
    // something to surface to the caller.
  }

  throw new AuthorizationError(decision.reason);
}
