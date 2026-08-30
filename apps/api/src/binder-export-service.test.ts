import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  computeBinderContentHash,
  normalizeBinderManifest,
  PgBinderExportService,
} from './binder-export-service.js';

const ACTOR = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000002',
  correlationId: 'corr-binder-1',
} as const;
const CASE_ID = '00000000-0000-4000-8000-000000000003';
const DOC_ID = '00000000-0000-4000-8000-000000000004';

interface RecordedQuery {
  text: string;
  values?: unknown[];
}

/**
 * A pg-shaped stub, as in audit-persistence.test.ts: the interesting parts are
 * the SQL and the transaction envelope, which a live database would not show
 * any more clearly. Responses are scripted per SQL fragment; RLS behaviour is
 * emulated by what the scripted rows return.
 */
function stubPool(script: {
  role?: string | null;
  caseExists?: boolean;
  replayRow?: { request_hash: string; response: unknown };
  documents?: Array<{ id: string; document_type: string; status: string }>;
}): { pool: Pool; queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];
  const client = {
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      if (text.includes('from tenant_membership')) {
        return script.role
          ? { rows: [{ role: script.role }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (text.includes('from employment_case')) {
        return script.caseExists === false
          ? { rows: [], rowCount: 0 }
          : { rows: [{ '?column?': 1 }], rowCount: 1 };
      }
      if (text.includes('from idempotency_record')) {
        return script.replayRow
          ? { rows: [script.replayRow], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (text.includes('from document')) {
        const rows = script.documents ?? [];
        return { rows, rowCount: rows.length };
      }
      if (text.includes('insert into binder_export_receipt')) {
        return {
          rows: [
            {
              id: values?.[0],
              employment_case_id: values?.[2],
              manifest: JSON.parse(String(values?.[3])),
              content_hash: values?.[4],
              hash_algorithm: 'sha256',
              created_by: values?.[5],
              created_at: new Date('2026-08-19T10:00:00.000Z'),
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
    release: () => undefined,
  };
  const pool = { connect: async () => client } as unknown as Pool;
  return { pool, queries };
}

const MANIFEST = {
  sections: ['documents', 'case'] as ['documents', 'case'],
  documentIds: [DOC_ID],
};
const DOCUMENTS = [{ id: DOC_ID, document_type: 'passport', status: 'active' }];

describe('binder content hash', () => {
  it('is deterministic and independent of client-side ordering', () => {
    const base = {
      tenantId: ACTOR.tenantId,
      caseId: CASE_ID,
      manifest: {
        sections: ['case', 'documents'] as Array<'case' | 'documents'>,
        documentIds: [DOC_ID],
      },
      documents: [{ id: DOC_ID, documentType: 'passport', status: 'active' }],
    };
    const shuffled = {
      ...base,
      manifest: {
        sections: ['documents', 'case'] as Array<'case' | 'documents'>,
        documentIds: [DOC_ID, DOC_ID],
      },
    };
    expect(computeBinderContentHash(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeBinderContentHash(shuffled)).toBe(computeBinderContentHash(base));
  });

  it('changes when the covered content metadata changes', () => {
    const base = {
      tenantId: ACTOR.tenantId,
      caseId: CASE_ID,
      manifest: { sections: ['documents'] as Array<'documents'>, documentIds: [DOC_ID] },
      documents: [{ id: DOC_ID, documentType: 'passport', status: 'active' }],
    };
    const changed = {
      ...base,
      documents: [{ id: DOC_ID, documentType: 'passport', status: 'archived' }],
    };
    expect(computeBinderContentHash(changed)).not.toBe(computeBinderContentHash(base));
  });

  it('normalizes sections into canonical order and de-duplicates document ids', () => {
    expect(
      normalizeBinderManifest({
        sections: ['payroll', 'case', 'payroll'] as Array<'payroll' | 'case'>,
        documentIds: [DOC_ID, DOC_ID],
      }),
    ).toEqual({ sections: ['case', 'payroll'], documentIds: [DOC_ID] });
  });
});

describe('PgBinderExportService', () => {
  it('scopes every statement to the actor tenant inside one transaction', async () => {
    const { pool, queries } = stubPool({ role: 'owner', documents: DOCUMENTS });
    const service = new PgBinderExportService(pool);
    const result = await service.create(ACTOR, CASE_ID, MANIFEST, 'key-service-1');

    // Root 6 (API-01): the role assertion is the one that was missing. This
    // test previously checked `begin` then `set_config` and passed against a
    // private transaction helper that never switched off whatever role the
    // pooled connection carried - which under an administrative DATABASE_URL
    // means BYPASSRLS and no tenant policy at all. Asserting the exact prologue
    // pins the service to withTenant() rather than to a lookalike.
    expect(queries[0]?.text).toBe('begin');
    expect(queries[1]?.text).toBe('set local role caredesk_app');
    expect(queries[2]?.text).toContain('set_config');
    expect(queries[2]?.values).toEqual([ACTOR.tenantId]);
    expect(queries.at(-1)?.text).toBe('commit');

    const receiptInsert = queries.find((q) => q.text.includes('insert into binder_export_receipt'));
    expect(receiptInsert?.values?.[1]).toBe(ACTOR.tenantId);
    expect(receiptInsert?.values?.[5]).toBe(ACTOR.userId);

    expect(result.replayed).toBe(false);
    expect(result.receipt.contentHash).toBe(
      computeBinderContentHash({
        tenantId: ACTOR.tenantId,
        caseId: CASE_ID,
        manifest: MANIFEST,
        documents: [{ id: DOC_ID, documentType: 'passport', status: 'active' }],
      }),
    );

    // Evidence trail: one audit event and one timeline event, same tenant.
    const audit = queries.find((q) => q.text.includes('insert into audit_event'));
    expect(audit?.text).toContain("'binder.export_recorded'");
    expect(audit?.values?.[1]).toBe(ACTOR.tenantId);
    const timeline = queries.find((q) => q.text.includes('insert into timeline_event'));
    expect(timeline?.text).toContain("'binder.export_recorded'");

    // Append-only: the service never updates or deletes a receipt.
    expect(
      queries.some((q) =>
        /update binder_export_receipt|delete from binder_export_receipt/.test(q.text),
      ),
    ).toBe(false);
  });

  it('treats a case filtered out by RLS as not found and writes nothing', async () => {
    const { pool, queries } = stubPool({ role: 'owner', caseExists: false });
    const service = new PgBinderExportService(pool);
    await expect(service.create(ACTOR, CASE_ID, MANIFEST, 'key-service-2')).rejects.toThrow(
      'case_not_found',
    );
    expect(queries.some((q) => q.text.startsWith('insert into'))).toBe(false);
    expect(queries.some((q) => q.text === 'rollback')).toBe(true);
  });

  it('denies a viewer and records the denial as a durable audit event', async () => {
    const { pool, queries } = stubPool({ role: 'viewer' });
    const service = new PgBinderExportService(pool);
    await expect(service.create(ACTOR, CASE_ID, MANIFEST, 'key-service-3')).rejects.toThrow(
      'forbidden_role',
    );
    const denial = queries.find((q) => q.text.includes("'binder.export_denied'"));
    expect(denial?.text).toContain("'denied'");
    expect(denial?.values?.[1]).toBe(ACTOR.tenantId);
    // The denial audit is committed in its own transaction after the rollback.
    const rollbackIndex = queries.findIndex((q) => q.text === 'rollback');
    const denialIndex = queries.findIndex((q) => q.text.includes("'binder.export_denied'"));
    expect(denialIndex).toBeGreaterThan(rollbackIndex);
    expect(queries.some((q) => q.text.includes('insert into binder_export_receipt'))).toBe(false);
  });

  it('replays an identical request and refuses a mismatched one', async () => {
    const storedReceipt = {
      id: '00000000-0000-4000-8000-000000000009',
      caseId: CASE_ID,
      manifest: normalizeBinderManifest(MANIFEST),
      contentHash: 'a'.repeat(64),
      hashAlgorithm: 'sha256',
      createdBy: ACTOR.userId,
      createdAt: '2026-08-19T10:00:00.000Z',
    };
    const matching = stubPool({
      role: 'owner',
      replayRow: {
        // Recreate the exact request hash the service computes.
        request_hash: createHash('sha256')
          .update(JSON.stringify({ caseId: CASE_ID, manifest: normalizeBinderManifest(MANIFEST) }))
          .digest('hex'),
        response: storedReceipt,
      },
    });
    const service = new PgBinderExportService(matching.pool);
    const replayed = await service.create(ACTOR, CASE_ID, MANIFEST, 'key-service-4');
    expect(replayed).toEqual({ receipt: storedReceipt, replayed: true });
    expect(matching.queries.some((q) => q.text.includes('insert into binder_export_receipt'))).toBe(
      false,
    );

    const mismatched = stubPool({
      role: 'owner',
      replayRow: { request_hash: 'f'.repeat(64), response: storedReceipt },
    });
    await expect(
      new PgBinderExportService(mismatched.pool).create(ACTOR, CASE_ID, MANIFEST, 'key-service-4'),
    ).rejects.toThrow('idempotency_conflict');
  });

  it('refuses a manifest document the case does not own', async () => {
    const { pool, queries } = stubPool({ role: 'owner', documents: [] });
    const service = new PgBinderExportService(pool);
    await expect(service.create(ACTOR, CASE_ID, MANIFEST, 'key-service-5')).rejects.toThrow(
      'document_not_in_case',
    );
    expect(queries.some((q) => q.text.includes('insert into binder_export_receipt'))).toBe(false);
  });

  it('exposes create and list only — no update, delete or purge surface', () => {
    const { pool } = stubPool({ role: 'owner' });
    const service = new PgBinderExportService(pool);
    const methods = new Set<string>();
    for (
      let proto: object | null = Object.getPrototypeOf(service) as object | null;
      proto !== null && proto !== Object.prototype;
      proto = Object.getPrototypeOf(proto) as object | null
    ) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name !== 'constructor') methods.add(name);
      }
    }
    for (const method of methods) {
      expect(method).not.toMatch(/update|delete|purge|remove/i);
    }
  });
});
