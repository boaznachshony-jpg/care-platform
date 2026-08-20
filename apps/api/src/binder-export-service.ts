import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

/**
 * Emergency Binder export receipts (capability #15).
 *
 * A receipt is durable, append-only evidence that a specific, explicitly
 * selected manifest was exported for a case: which sections, which document
 * ids, by whom, when, and a deterministic sha256 fingerprint of the manifest
 * plus the document metadata it covered. The service exposes create + list
 * only — receipts have no update or delete surface, matching the append-only
 * grants of migration 0029.
 *
 * Deliberately absent: any sharing/link capability. Public Binder sharing
 * stays disabled (fail-closed); the browser print remains a local act and a
 * receipt is never a way to reach the exported content.
 */

/** Must stay in sync with the sections EmergencyBinderPage offers. */
export const BINDER_SECTIONS = [
  'case',
  'caregiver',
  'documents',
  'payroll',
  'tasks',
  'contacts',
] as const;
export type BinderSection = (typeof BINDER_SECTIONS)[number];

export interface BinderExportManifest {
  sections: BinderSection[];
  documentIds: string[];
}

/** Metadata only — never file bytes, storage keys, or sensitive values. */
export interface BinderDocumentMeta {
  id: string;
  documentType: string;
  status: string;
}

export interface BinderExportReceipt {
  id: string;
  caseId: string;
  manifest: BinderExportManifest;
  contentHash: string;
  hashAlgorithm: 'sha256';
  createdBy: string;
  createdAt: string;
}

export interface BinderExportResult {
  receipt: BinderExportReceipt;
  replayed: boolean;
}

type Actor = { tenantId: string; userId: string; correlationId: string };

/** Only the employer (owner) or a manager may record a Binder export. */
const EXPORTER_ROLES = new Set(['owner', 'manager']);

/**
 * Deterministic ordering: sections in canonical page order, document ids
 * sorted lexicographically, both de-duplicated — so the same explicit
 * selection always hashes identically regardless of client click order.
 */
export function normalizeBinderManifest(manifest: BinderExportManifest): BinderExportManifest {
  return {
    sections: BINDER_SECTIONS.filter((section) => manifest.sections.includes(section)),
    documentIds: [...new Set(manifest.documentIds)].sort(),
  };
}

/**
 * sha256 over a canonical JSON encoding of the manifest and the content
 * metadata it covered. Key order is fixed by construction, so equal inputs
 * always produce an equal hash.
 */
export function computeBinderContentHash(input: {
  tenantId: string;
  caseId: string;
  manifest: BinderExportManifest;
  documents: BinderDocumentMeta[];
}): string {
  const manifest = normalizeBinderManifest(input.manifest);
  const canonical = {
    v: 1,
    tenantId: input.tenantId,
    caseId: input.caseId,
    sections: manifest.sections,
    documentIds: manifest.documentIds,
    documents: [...input.documents]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((document) => ({
        id: document.id,
        documentType: document.documentType,
        status: document.status,
      })),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function requestHashOf(caseId: string, manifest: BinderExportManifest): string {
  return createHash('sha256')
    .update(JSON.stringify({ caseId, manifest: normalizeBinderManifest(manifest) }))
    .digest('hex');
}

function sensitivityOf(manifest: BinderExportManifest): string {
  return manifest.sections.includes('payroll') ? 'financial_sensitive' : 'employment_sensitive';
}

export interface BinderExportService {
  create(
    actor: Actor,
    caseId: string,
    manifest: BinderExportManifest,
    idempotencyKey: string,
  ): Promise<BinderExportResult>;
  list(actor: Actor, caseId: string): Promise<BinderExportReceipt[]>;
}

type ReceiptRow = {
  id: string;
  employment_case_id: string;
  manifest: BinderExportManifest;
  content_hash: string;
  hash_algorithm: 'sha256';
  created_by: string;
  created_at: Date;
};

const receiptColumns =
  'id, employment_case_id, manifest, content_hash, hash_algorithm, created_by, created_at';

function rowToReceipt(row: ReceiptRow): BinderExportReceipt {
  return {
    id: row.id,
    caseId: row.employment_case_id,
    manifest: row.manifest,
    contentHash: row.content_hash,
    hashAlgorithm: row.hash_algorithm,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  };
}

export class PgBinderExportService implements BinderExportService {
  constructor(private readonly pool: Pool) {}

  private async tx<T>(tenantId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.tenant_id',$1,true)", [tenantId]);
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  /** RLS scopes the membership lookup to the actor's own tenant. */
  private async roleOf(client: PoolClient, actor: Actor): Promise<string | null> {
    const result = await client.query<{ role: string }>(
      `select role from tenant_membership where user_id=$1 and status='active' limit 1`,
      [actor.userId],
    );
    return result.rows[0]?.role ?? null;
  }

  /**
   * The denial must survive the rolled-back export transaction — a refused
   * export is exactly the audit event worth keeping (Constitution §19).
   */
  private recordDenial(actor: Actor, caseId: string, reason: string): Promise<void> {
    return this.tx(actor.tenantId, async (client) => {
      await client.query(
        `insert into audit_event (id,tenant_id,actor_id,action,resource_type,resource_id,occurred_at,correlation_id,purpose,permission_decision,reason,sensitivity)
         values ($1,$2,$3,'binder.export_denied','binder_export_receipt',$4,now(),$5,'binder_export','denied',$6,'employment_sensitive')`,
        [randomUUID(), actor.tenantId, actor.userId, caseId, actor.correlationId, reason],
      );
    });
  }

  async create(
    actor: Actor,
    caseId: string,
    manifestInput: BinderExportManifest,
    idempotencyKey: string,
  ): Promise<BinderExportResult> {
    const manifest = normalizeBinderManifest(manifestInput);
    try {
      return await this.tx(actor.tenantId, async (client) => {
        const role = await this.roleOf(client, actor);
        if (!role || !EXPORTER_ROLES.has(role)) throw new Error('forbidden_role');

        // RLS makes another tenant's case indistinguishable from a missing one.
        const exists = await client.query('select 1 from employment_case where id=$1', [caseId]);
        if (!exists.rowCount) throw new Error('case_not_found');

        const requestHash = requestHashOf(caseId, manifest);
        const replay = await client.query<{ request_hash: string; response: BinderExportReceipt }>(
          `select request_hash, response from idempotency_record where operation='binder_export.create' and idempotency_key=$1 for update`,
          [idempotencyKey],
        );
        if (replay.rows[0]) {
          if (replay.rows[0].request_hash !== requestHash) throw new Error('idempotency_conflict');
          return { receipt: replay.rows[0].response, replayed: true };
        }

        // Every explicitly selected document must belong to this case.
        let documents: BinderDocumentMeta[] = [];
        if (manifest.documentIds.length) {
          const rows = await client.query<{ id: string; document_type: string; status: string }>(
            `select id, document_type, status from document where employment_case_id=$1 and id = any($2::uuid[])`,
            [caseId, manifest.documentIds],
          );
          if (rows.rowCount !== manifest.documentIds.length)
            throw new Error('document_not_in_case');
          documents = rows.rows.map((row) => ({
            id: row.id,
            documentType: row.document_type,
            status: row.status,
          }));
        }

        const contentHash = computeBinderContentHash({
          tenantId: actor.tenantId,
          caseId,
          manifest,
          documents,
        });
        const sensitivity = sensitivityOf(manifest);

        const inserted = await client.query<ReceiptRow>(
          `insert into binder_export_receipt (id,tenant_id,employment_case_id,manifest,content_hash,created_by)
           values ($1,$2,$3,$4,$5,$6) returning ${receiptColumns}`,
          [
            randomUUID(),
            actor.tenantId,
            caseId,
            JSON.stringify(manifest),
            contentHash,
            actor.userId,
          ],
        );
        const receipt = rowToReceipt(inserted.rows[0]!);

        await client.query(
          `insert into audit_event (id,tenant_id,actor_id,action,resource_type,resource_id,occurred_at,correlation_id,purpose,change_summary,sensitivity)
           values ($1,$2,$3,'binder.export_recorded','binder_export_receipt',$4,now(),$5,'binder_export','Emergency binder export recorded.',$6)`,
          [
            randomUUID(),
            actor.tenantId,
            actor.userId,
            receipt.id,
            actor.correlationId,
            sensitivity,
          ],
        );
        await client.query(
          `insert into timeline_event (id,tenant_id,employment_case_id,event_type_key,summary_key,occurred_at,source_type,source_id,sensitivity)
           values ($1,$2,$3,'binder.export_recorded','Emergency binder export recorded.',now(),'binder_export_receipt',$4,$5)`,
          [randomUUID(), actor.tenantId, caseId, receipt.id, sensitivity],
        );
        await client.query(
          `insert into idempotency_record (tenant_id,operation,idempotency_key,request_hash,response) values ($1,'binder_export.create',$2,$3,$4)`,
          [actor.tenantId, idempotencyKey, requestHash, JSON.stringify(receipt)],
        );

        return { receipt, replayed: false };
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'forbidden_role') {
        await this.recordDenial(actor, caseId, 'binder export requires the owner or manager role');
      }
      throw error;
    }
  }

  async list(actor: Actor, caseId: string): Promise<BinderExportReceipt[]> {
    try {
      return await this.tx(actor.tenantId, async (client) => {
        const role = await this.roleOf(client, actor);
        if (!role || !EXPORTER_ROLES.has(role)) throw new Error('forbidden_role');
        const result = await client.query<ReceiptRow>(
          `select ${receiptColumns} from binder_export_receipt where employment_case_id=$1 order by created_at desc limit 100`,
          [caseId],
        );
        return result.rows.map(rowToReceipt);
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'forbidden_role') {
        await this.recordDenial(actor, caseId, 'binder export requires the owner or manager role');
      }
      throw error;
    }
  }
}

/**
 * Ports the in-memory container already exposes — enough to validate the
 * manifest against the same authenticated reads the page itself uses.
 */
export interface InMemoryBinderExportDeps {
  getCase: { execute(actor: Actor, caseId: string): Promise<unknown> };
  listDocuments: {
    execute(
      actor: Actor,
      caseId: string,
    ): Promise<Array<{ document: { id: string; documentType: string; status: string } }>>;
  };
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
 * Development fallback (no DATABASE_URL). Same contract and error codes as
 * the Postgres service so routes and tests behave identically; receipts are
 * immutable here too — the maps are append-only and never exposed.
 */
export class InMemoryBinderExportService implements BinderExportService {
  private readonly receipts: BinderExportReceipt[] = [];
  private readonly idempotency = new Map<
    string,
    { requestHash: string; result: BinderExportReceipt }
  >();

  constructor(private readonly deps: InMemoryBinderExportDeps) {}

  private async assertExporter(actor: Actor, caseId: string): Promise<void> {
    const role = await this.deps.resolveRole(actor);
    if (role && EXPORTER_ROLES.has(role)) return;
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'binder.export_denied',
      resourceType: 'binder_export_receipt',
      resourceId: caseId,
      correlationId: actor.correlationId,
      occurredAt: new Date().toISOString(),
      permissionDecision: 'denied',
      reason: 'binder export requires the owner or manager role',
    });
    throw new Error('forbidden_role');
  }

  async create(
    actor: Actor,
    caseId: string,
    manifestInput: BinderExportManifest,
    idempotencyKey: string,
  ): Promise<BinderExportResult> {
    await this.assertExporter(actor, caseId);
    const found = await this.deps.getCase.execute(actor, caseId).catch(() => null);
    if (!found) throw new Error('case_not_found');

    const manifest = normalizeBinderManifest(manifestInput);
    const requestHash = requestHashOf(caseId, manifest);
    const idempotencyId = `${actor.tenantId}:${idempotencyKey}`;
    const replay = this.idempotency.get(idempotencyId);
    if (replay) {
      if (replay.requestHash !== requestHash) throw new Error('idempotency_conflict');
      return { receipt: replay.result, replayed: true };
    }

    let documents: BinderDocumentMeta[] = [];
    if (manifest.documentIds.length) {
      const rows = await this.deps.listDocuments.execute(actor, caseId);
      const byId = new Map(rows.map((row) => [row.document.id, row.document]));
      documents = manifest.documentIds.map((id) => {
        const document = byId.get(id);
        if (!document) throw new Error('document_not_in_case');
        return { id: document.id, documentType: document.documentType, status: document.status };
      });
    }

    const receipt: BinderExportReceipt = {
      id: randomUUID(),
      caseId,
      manifest,
      contentHash: computeBinderContentHash({
        tenantId: actor.tenantId,
        caseId,
        manifest,
        documents,
      }),
      hashAlgorithm: 'sha256',
      createdBy: actor.userId,
      createdAt: new Date().toISOString(),
    };
    this.receipts.push({ ...receipt, manifest: { ...manifest } });
    this.idempotency.set(idempotencyId, { requestHash, result: receipt });

    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'binder.export_recorded',
      resourceType: 'binder_export_receipt',
      resourceId: receipt.id,
      correlationId: actor.correlationId,
      occurredAt: receipt.createdAt,
      changeSummary: 'Emergency binder export recorded.',
    });

    return { receipt, replayed: false };
  }

  async list(actor: Actor, caseId: string): Promise<BinderExportReceipt[]> {
    await this.assertExporter(actor, caseId);
    const found = await this.deps.getCase.execute(actor, caseId).catch(() => null);
    if (!found) throw new Error('case_not_found');
    return this.receipts
      .filter((receipt) => receipt.caseId === caseId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((receipt) => ({ ...receipt, manifest: { ...receipt.manifest } }));
  }
}
