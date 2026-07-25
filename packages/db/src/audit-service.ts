import type { AuditEventInput, AuditService } from '@caredesk/application';
import type { Pool } from 'pg';
import { withTenant } from './pool.js';

/**
 * Durable audit trail (Constitution §19, blueprint §4.10).
 *
 * Append-only by construction and by grant: this adapter exposes `record` and
 * nothing else, and `caredesk_app` holds only `select, insert` on
 * `audit_event` (see database/migrations/0009_audit_event.sql). There is no
 * update or delete path from the application, deliberately — an audit trail
 * the application can rewrite is not an audit trail.
 *
 * PRIVACY (Constitution §16/§19): never pass secrets, credentials, full
 * sensitive values, file contents, or AI prompt/completion text into an audit
 * event. `changeSummary` is a short sentence naming what changed, not the
 * before/after values of sensitive fields; the database caps its length so a
 * record cannot be dumped into it.
 *
 * Every write runs inside `withTenant()` so it happens as the least-privilege
 * `caredesk_app` role with `app.tenant_id` set and RLS enforced.
 *
 * The table also carries `purpose`, `source_channel`, `permission_decision`,
 * `reason`, `rule_version` and `ai_involved` per blueprint §4.10. The
 * `AuditEventInput` port does not expose them yet, so they take their column
 * defaults; they are reachable without a further migration once the port and
 * the call sites that need them (permission denials, AI-assisted decisions,
 * rule-version changes) arrive.
 */
export class PgAuditService implements AuditService {
  constructor(private readonly pool: Pool) {}

  async record(event: AuditEventInput): Promise<void> {
    await withTenant(this.pool, event.tenantId, async (client) => {
      await client.query(
        `insert into audit_event
           (tenant_id, actor_id, action, resource_type, resource_id,
            occurred_at, correlation_id, change_summary, sensitivity)
         values ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9, 'general'))`,
        [
          event.tenantId,
          event.actorId,
          event.action,
          event.resourceType,
          event.resourceId,
          event.occurredAt,
          event.correlationId,
          event.changeSummary ?? null,
          event.sensitivity ?? null,
        ],
      );
    });
  }
}
