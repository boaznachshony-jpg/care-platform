import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from '@caredesk/db';

/**
 * Unified evidence export (capability #10 — Audit / Evidence Trail).
 *
 * An evidence export is a chronological, metadata-only manifest of the
 * `audit_event` and `timeline_event` records that describe one case, together
 * with a deterministic sha256 fingerprint of its canonical serialization.
 *
 * PRIVACY CONTRACT: the manifest carries evidence *about* activity, never the
 * activity's content. No document bytes, storage keys, message bodies,
 * extracted field values or AI prompt/completion text appear here — only the
 * short, length-capped summary/action metadata the audit tables themselves are
 * allowed to hold (Constitution §16/§19).
 *
 * DETERMINISM: the same case state always yields the same hash. That is why
 * `evidence.*` audit actions and `evidence.*` timeline keys are excluded from
 * the manifest — the export writes its own `evidence.exported` audit event
 * (exports are themselves evidenced), and including that receipt in the next
 * manifest would make every export change the very trail it fingerprints.
 * The `evidence.exported` audit row doubles as the durable export receipt:
 * `audit_event` is append-only, tenant-scoped and queryable, so no additional
 * receipt table (and no migration) is needed.
 */

type Actor = { tenantId: string; userId: string; correlationId: string };

/** Only the employer (owner) or a manager may export or verify evidence. */
const EXPORTER_ROLES = new Set(['owner', 'manager']);

export interface EvidenceAuditRecord {
  /** Null in the in-memory development fallback, which stores no row ids. */
  id: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  actorId: string | null;
  occurredAt: string;
  correlationId: string;
  permissionDecision: string;
  sensitivity: string;
  changeSummary: string | null;
}

export interface EvidenceTimelineRecord {
  id: string | null;
  eventTypeKey: string;
  summaryKey: string;
  occurredAt: string;
  sourceType: string | null;
  sourceId: string | null;
  sensitivity: string;
}

export interface EvidenceExportManifest {
  version: 1;
  tenantId: string;
  caseId: string;
  auditEvents: EvidenceAuditRecord[];
  timelineEvents: EvidenceTimelineRecord[];
}

export interface EvidenceExportResult {
  manifest: EvidenceExportManifest;
  contentHash: string;
  hashAlgorithm: 'sha256';
  generatedAt: string;
  counts: { auditEvents: number; timelineEvents: number };
}

export interface EvidenceVerificationResult {
  providedHash: string;
  computedHash: string;
  matches: boolean;
  /** Whether an `evidence.exported` receipt for this hash exists in the trail. */
  previouslyIssued: boolean;
  verifiedAt: string;
}

function compareAudit(a: EvidenceAuditRecord, b: EvidenceAuditRecord): number {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? -1 : 1;
  const aId = a.id ?? '';
  const bId = b.id ?? '';
  if (aId !== bId) return aId < bId ? -1 : 1;
  if (a.action !== b.action) return a.action < b.action ? -1 : 1;
  return a.resourceId < b.resourceId ? -1 : a.resourceId > b.resourceId ? 1 : 0;
}

function compareTimeline(a: EvidenceTimelineRecord, b: EvidenceTimelineRecord): number {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? -1 : 1;
  const aId = a.id ?? '';
  const bId = b.id ?? '';
  if (aId !== bId) return aId < bId ? -1 : 1;
  return a.eventTypeKey < b.eventTypeKey ? -1 : a.eventTypeKey > b.eventTypeKey ? 1 : 0;
}

/**
 * Canonical form: fixed key order by construction, events chronologically
 * sorted with stable tie-breaks — equal inputs always serialize identically.
 */
export function canonicalEvidenceManifest(manifest: EvidenceExportManifest): unknown {
  return {
    v: manifest.version,
    tenantId: manifest.tenantId,
    caseId: manifest.caseId,
    auditEvents: [...manifest.auditEvents].sort(compareAudit).map((event) => ({
      id: event.id,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      actorId: event.actorId,
      occurredAt: event.occurredAt,
      correlationId: event.correlationId,
      permissionDecision: event.permissionDecision,
      sensitivity: event.sensitivity,
      changeSummary: event.changeSummary,
    })),
    timelineEvents: [...manifest.timelineEvents].sort(compareTimeline).map((event) => ({
      id: event.id,
      eventTypeKey: event.eventTypeKey,
      summaryKey: event.summaryKey,
      occurredAt: event.occurredAt,
      sourceType: event.sourceType,
      sourceId: event.sourceId,
      sensitivity: event.sensitivity,
    })),
  };
}

/** Deterministic sha256 over the canonical serialization. Pure. */
export function computeEvidenceExportHash(manifest: EvidenceExportManifest): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalEvidenceManifest(manifest)))
    .digest('hex');
}

/** Pure integrity check: does this manifest still produce the given hash? */
export function verifyEvidenceExportHash(manifest: EvidenceExportManifest, hash: string): boolean {
  return computeEvidenceExportHash(manifest) === hash.toLowerCase();
}

export interface EvidenceExportService {
  export(actor: Actor, caseId: string): Promise<EvidenceExportResult>;
  verify(actor: Actor, caseId: string, hash: string): Promise<EvidenceVerificationResult>;
}

function toResult(manifest: EvidenceExportManifest, generatedAt: string): EvidenceExportResult {
  return {
    manifest,
    contentHash: computeEvidenceExportHash(manifest),
    hashAlgorithm: 'sha256',
    generatedAt,
    counts: {
      auditEvents: manifest.auditEvents.length,
      timelineEvents: manifest.timelineEvents.length,
    },
  };
}

type AuditRow = {
  id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  actor_id: string | null;
  occurred_at: Date;
  correlation_id: string;
  permission_decision: string;
  sensitivity: string;
  change_summary: string | null;
};

type TimelineRow = {
  id: string;
  event_type_key: string;
  summary_key: string;
  occurred_at: Date;
  source_type: string | null;
  source_id: string | null;
  sensitivity: string;
};

export class PgEvidenceExportService implements EvidenceExportService {
  constructor(private readonly pool: Pool) {}

  /**
   * Root 6 (API-01) - delegates to the one path to the database.
   *
   * The private copy this replaces opened the transaction and set
   * `app.tenant_id`, but never `set local role caredesk_app`. The role is the
   * control that matters: an administrative role carries BYPASSRLS, and under
   * BYPASSRLS every tenant policy is skipped silently - the tenant setting is
   * then read by policies that never run. Eight services each had their own
   * copy of this helper and all eight omitted the role. See
   * scripts/check-tenant-db-path.mjs, which fails CI if a ninth appears.
   */
  private tx<T>(tenantId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    return withTenant(this.pool, tenantId, work);
  }

  /** RLS scopes the membership lookup to the actor's own tenant. */
  private async roleOf(client: PoolClient, actor: Actor): Promise<string | null> {
    const result = await client.query<{ role: string }>(
      `select role from tenant_membership where user_id=$1 and status='active' limit 1`,
      [actor.userId],
    );
    return result.rows[0]?.role ?? null;
  }

  /** The denial must survive the rolled-back transaction (Constitution §19). */
  private recordDenial(actor: Actor, caseId: string, reason: string): Promise<void> {
    return this.tx(actor.tenantId, async (client) => {
      await client.query(
        `insert into audit_event (id,tenant_id,actor_id,action,resource_type,resource_id,occurred_at,correlation_id,purpose,permission_decision,reason,sensitivity)
         values ($1,$2,$3,'evidence.export_denied','evidence_export',$4,now(),$5,'evidence_export','denied',$6,'employment_sensitive')`,
        [randomUUID(), actor.tenantId, actor.userId, caseId, actor.correlationId, reason],
      );
    });
  }

  /**
   * Case scope for audit rows: `audit_event` deliberately has no case column,
   * so the case's evidence is the union of audit rows naming the case itself,
   * its documents, its tasks, and any resource a case timeline event points at
   * (binder receipts, reviews, worker requests, payroll closes, plans, …).
   * All reads run under forced RLS, so another tenant's rows never appear.
   */
  private async collect(client: PoolClient, actor: Actor, caseId: string) {
    const audit = await client.query<AuditRow>(
      `select id, action, resource_type, resource_id, actor_id, occurred_at,
              correlation_id, permission_decision, sensitivity, change_summary
       from audit_event
       where action not like 'evidence.%'
         and (resource_id = $1
           or resource_id in (select id::text from document where employment_case_id = $1::uuid)
           or resource_id in (select id::text from task where employment_case_id = $1::uuid)
           or resource_id in (
             select source_id::text from timeline_event
             where employment_case_id = $1::uuid and source_id is not null))
       order by occurred_at asc, id asc`,
      [caseId],
    );
    const timeline = await client.query<TimelineRow>(
      `select id, event_type_key, summary_key, occurred_at, source_type, source_id, sensitivity
       from timeline_event
       where employment_case_id = $1::uuid and event_type_key not like 'evidence.%'
       order by occurred_at asc, id asc`,
      [caseId],
    );
    const manifest: EvidenceExportManifest = {
      version: 1,
      tenantId: actor.tenantId,
      caseId,
      auditEvents: audit.rows.map((row) => ({
        id: row.id,
        action: row.action,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        actorId: row.actor_id,
        occurredAt: row.occurred_at.toISOString(),
        correlationId: row.correlation_id,
        permissionDecision: row.permission_decision,
        sensitivity: row.sensitivity,
        changeSummary: row.change_summary,
      })),
      timelineEvents: timeline.rows.map((row) => ({
        id: row.id,
        eventTypeKey: row.event_type_key,
        summaryKey: row.summary_key,
        occurredAt: row.occurred_at.toISOString(),
        sourceType: row.source_type,
        sourceId: row.source_id,
        sensitivity: row.sensitivity,
      })),
    };
    return manifest;
  }

  private async guard(client: PoolClient, actor: Actor, caseId: string): Promise<void> {
    const role = await this.roleOf(client, actor);
    if (!role || !EXPORTER_ROLES.has(role)) throw new Error('forbidden_role');
    // RLS makes another tenant's case indistinguishable from a missing one.
    const exists = await client.query('select 1 from employment_case where id=$1', [caseId]);
    if (!exists.rowCount) throw new Error('case_not_found');
  }

  async export(actor: Actor, caseId: string): Promise<EvidenceExportResult> {
    try {
      return await this.tx(actor.tenantId, async (client) => {
        await this.guard(client, actor, caseId);
        const manifest = await this.collect(client, actor, caseId);
        const generatedAt = new Date().toISOString();
        const result = toResult(manifest, generatedAt);
        // The receipt: an append-only audit row keyed by the content hash.
        await client.query(
          `insert into audit_event (id,tenant_id,actor_id,action,resource_type,resource_id,occurred_at,correlation_id,purpose,change_summary,sensitivity)
           values ($1,$2,$3,'evidence.exported','evidence_export',$4,now(),$5,'evidence_export',$6,'employment_sensitive')`,
          [
            randomUUID(),
            actor.tenantId,
            actor.userId,
            result.contentHash,
            actor.correlationId,
            `Evidence export generated (${result.counts.auditEvents} audit, ${result.counts.timelineEvents} timeline records).`,
          ],
        );
        return result;
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'forbidden_role') {
        await this.recordDenial(
          actor,
          caseId,
          'evidence export requires the owner or manager role',
        );
      }
      throw error;
    }
  }

  async verify(actor: Actor, caseId: string, hash: string): Promise<EvidenceVerificationResult> {
    try {
      return await this.tx(actor.tenantId, async (client) => {
        await this.guard(client, actor, caseId);
        const manifest = await this.collect(client, actor, caseId);
        const computedHash = computeEvidenceExportHash(manifest);
        const providedHash = hash.toLowerCase();
        const matches = computedHash === providedHash;
        const issued = await client.query(
          `select 1 from audit_event where action='evidence.exported' and resource_type='evidence_export' and resource_id=$1 limit 1`,
          [providedHash],
        );
        await client.query(
          `insert into audit_event (id,tenant_id,actor_id,action,resource_type,resource_id,occurred_at,correlation_id,purpose,change_summary,sensitivity)
           values ($1,$2,$3,'evidence.export_verified','evidence_export',$4,now(),$5,'evidence_export',$6,'employment_sensitive')`,
          [
            randomUUID(),
            actor.tenantId,
            actor.userId,
            providedHash,
            actor.correlationId,
            matches
              ? 'Evidence export hash verified: manifest unchanged.'
              : 'Evidence export hash verification failed: manifest differs.',
          ],
        );
        return {
          providedHash,
          computedHash,
          matches,
          previouslyIssued: Boolean(issued.rowCount),
          verifiedAt: new Date().toISOString(),
        };
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'forbidden_role') {
        await this.recordDenial(
          actor,
          caseId,
          'evidence export requires the owner or manager role',
        );
      }
      throw error;
    }
  }
}

/** The stored shapes the in-memory audit/timeline mocks already hold. */
export interface StoredAuditEvent {
  tenantId: string;
  /** Null for system-initiated events (e.g. the recurring billing cron). */
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  correlationId: string;
  occurredAt: string;
  changeSummary?: string;
  sensitivity?: string;
  permissionDecision?: 'allowed' | 'denied';
  reason?: string;
}

export interface StoredTimelineEvent {
  tenantId: string;
  employmentCaseId: string;
  eventTypeKey: string;
  occurredAt: string;
  summaryKey: string;
  sensitivity: string;
}

/**
 * Ports the in-memory container already exposes — the same authenticated reads
 * the pages use, plus read access to the in-memory audit/timeline stores.
 */
export interface InMemoryEvidenceExportDeps {
  getCase: { execute(actor: Actor, caseId: string): Promise<unknown> };
  listDocuments: {
    execute(actor: Actor, caseId: string): Promise<Array<{ document: { id: string } }>>;
  };
  listTasks: { execute(actor: Actor, caseId: string): Promise<Array<{ id: string }>> };
  readAuditEvents: () => readonly StoredAuditEvent[];
  readTimelineEvents: () => readonly StoredTimelineEvent[];
  audit: {
    record(event: {
      tenantId: string;
      actorId: string;
      action: string;
      resourceType: string;
      resourceId: string;
      correlationId: string;
      occurredAt: string;
      changeSummary?: string;
      permissionDecision?: 'allowed' | 'denied';
      reason?: string;
    }): Promise<void>;
  };
  resolveRole: (actor: Actor) => Promise<string | null>;
}

/**
 * Development fallback (no DATABASE_URL). Same contract and error codes as the
 * Postgres service so routes and tests behave identically.
 */
export class InMemoryEvidenceExportService implements EvidenceExportService {
  constructor(private readonly deps: InMemoryEvidenceExportDeps) {}

  private async assertExporter(actor: Actor, caseId: string): Promise<void> {
    const role = await this.deps.resolveRole(actor);
    if (role && EXPORTER_ROLES.has(role)) return;
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'evidence.export_denied',
      resourceType: 'evidence_export',
      resourceId: caseId,
      correlationId: actor.correlationId,
      occurredAt: new Date().toISOString(),
      permissionDecision: 'denied',
      reason: 'evidence export requires the owner or manager role',
    });
    throw new Error('forbidden_role');
  }

  private async buildManifest(actor: Actor, caseId: string): Promise<EvidenceExportManifest> {
    const [documents, tasks] = await Promise.all([
      this.deps.listDocuments.execute(actor, caseId),
      this.deps.listTasks.execute(actor, caseId),
    ]);
    const ids = new Set<string>([
      caseId,
      ...documents.map((row) => row.document.id),
      ...tasks.map((task) => task.id),
    ]);
    const auditEvents: EvidenceAuditRecord[] = this.deps
      .readAuditEvents()
      .filter(
        (event) =>
          event.tenantId === actor.tenantId &&
          !event.action.startsWith('evidence.') &&
          ids.has(event.resourceId),
      )
      .map((event) => ({
        id: null,
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        actorId: event.actorId ?? null,
        occurredAt: event.occurredAt,
        correlationId: event.correlationId,
        permissionDecision: event.permissionDecision ?? 'allowed',
        sensitivity: event.sensitivity ?? 'general',
        changeSummary: event.changeSummary ?? null,
      }));
    const timelineEvents: EvidenceTimelineRecord[] = this.deps
      .readTimelineEvents()
      .filter(
        (event) =>
          event.tenantId === actor.tenantId &&
          event.employmentCaseId === caseId &&
          !event.eventTypeKey.startsWith('evidence.'),
      )
      .map((event) => ({
        id: null,
        eventTypeKey: event.eventTypeKey,
        summaryKey: event.summaryKey,
        occurredAt: event.occurredAt,
        sourceType: null,
        sourceId: null,
        sensitivity: event.sensitivity,
      }));
    return { version: 1, tenantId: actor.tenantId, caseId, auditEvents, timelineEvents };
  }

  async export(actor: Actor, caseId: string): Promise<EvidenceExportResult> {
    await this.assertExporter(actor, caseId);
    const found = await this.deps.getCase.execute(actor, caseId).catch(() => null);
    if (!found) throw new Error('case_not_found');
    const manifest = await this.buildManifest(actor, caseId);
    const generatedAt = new Date().toISOString();
    const result = toResult(manifest, generatedAt);
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'evidence.exported',
      resourceType: 'evidence_export',
      resourceId: result.contentHash,
      correlationId: actor.correlationId,
      occurredAt: generatedAt,
      changeSummary: `Evidence export generated (${result.counts.auditEvents} audit, ${result.counts.timelineEvents} timeline records).`,
    });
    return result;
  }

  async verify(actor: Actor, caseId: string, hash: string): Promise<EvidenceVerificationResult> {
    await this.assertExporter(actor, caseId);
    const found = await this.deps.getCase.execute(actor, caseId).catch(() => null);
    if (!found) throw new Error('case_not_found');
    const manifest = await this.buildManifest(actor, caseId);
    const computedHash = computeEvidenceExportHash(manifest);
    const providedHash = hash.toLowerCase();
    const matches = computedHash === providedHash;
    const previouslyIssued = this.deps
      .readAuditEvents()
      .some(
        (event) =>
          event.tenantId === actor.tenantId &&
          event.action === 'evidence.exported' &&
          event.resourceId === providedHash,
      );
    const verifiedAt = new Date().toISOString();
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'evidence.export_verified',
      resourceType: 'evidence_export',
      resourceId: providedHash,
      correlationId: actor.correlationId,
      occurredAt: verifiedAt,
      changeSummary: matches
        ? 'Evidence export hash verified: manifest unchanged.'
        : 'Evidence export hash verification failed: manifest differs.',
    });
    return { providedHash, computedHash, matches, previouslyIssued, verifiedAt };
  }
}
