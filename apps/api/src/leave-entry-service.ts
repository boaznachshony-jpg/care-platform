import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

/**
 * Governed leave ledger (migration 0033). Records manager-entered caregiver
 * leave facts — annual / sick / holiday over an explicit date range — inside a
 * tenant-scoped transaction with durable idempotency, audit and timeline
 * evidence. Rows are never hard-deleted: corrections bump the version and a
 * mistaken row is cancelled, so the ledger stays replayable evidence.
 */
export type LeaveEntryInput = {
  entryType: 'annual' | 'sick' | 'holiday';
  startDate: string;
  endDate: string;
  days: number;
  note?: string;
};
export type LeaveEntryUpdate = LeaveEntryInput & {
  status: 'recorded' | 'cancelled';
  version: number;
};
type Actor = { tenantId: string; userId: string; correlationId: string };
type Row = Record<string, unknown> & {
  id: string;
  start_date: string;
  end_date: string;
  created_at: Date;
  updated_at: Date;
};
const output = (r: Row) => ({
  id: r.id,
  caregiverId: r.caregiver_id as string,
  entryType: r.entry_type as LeaveEntryInput['entryType'],
  startDate: r.start_date,
  endDate: r.end_date,
  days: Number(r.days),
  status: r.status as 'recorded' | 'cancelled',
  note: (r.note as string | null) ?? null,
  version: Number(r.version),
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});
export type LeaveEntryResponse = ReturnType<typeof output>;
const columns = `id,caregiver_id,entry_type,start_date::text,end_date::text,days::text,status,note,version,created_at,updated_at`;
export class LeaveEntryService {
  constructor(private pool: Pool) {}
  private async tx<T>(tenant: string, work: (c: PoolClient) => Promise<T>) {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      await c.query("select set_config('app.tenant_id',$1,true)", [tenant]);
      const r = await work(c);
      await c.query('commit');
      return r;
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }
  private async replay(c: PoolClient, operation: string, key: string, hash: string) {
    const existing = await c.query<{ request_hash: string; response: LeaveEntryResponse }>(
      `select request_hash,response from idempotency_record where operation=$1 and idempotency_key=$2 for update`,
      [operation, key],
    );
    if (!existing.rows[0]) return null;
    if (existing.rows[0].request_hash !== hash) throw new Error('idempotency_conflict');
    return existing.rows[0].response;
  }
  private async evidence(
    c: PoolClient,
    actor: Actor,
    caseId: string,
    entryId: string,
    action: string,
    withTimeline: boolean,
  ) {
    await c.query(
      `insert into audit_event (id,tenant_id,actor_id,action,resource_type,resource_id,occurred_at,correlation_id,purpose,change_summary,sensitivity) values ($1,$2,$3,$4,'leave_entry',$5,now(),$6,'leave_ledger','Leave ledger entry recorded.','employment_sensitive')`,
      [randomUUID(), actor.tenantId, actor.userId, action, entryId, actor.correlationId],
    );
    if (withTimeline)
      await c.query(
        `insert into timeline_event (id,tenant_id,employment_case_id,event_type_key,summary_key,occurred_at,source_type,source_id,sensitivity) values ($1,$2,$3,$4,'Leave ledger entry recorded.',now(),'leave_entry',$5,'employment_sensitive')`,
        [randomUUID(), actor.tenantId, caseId, action, entryId],
      );
  }
  private async receipt(
    c: PoolClient,
    actor: Actor,
    operation: string,
    key: string,
    hash: string,
    entry: LeaveEntryResponse,
  ) {
    await c.query(
      `insert into idempotency_record (tenant_id,operation,idempotency_key,request_hash,response) values ($1,$2,$3,$4,$5)`,
      [actor.tenantId, operation, key, hash, JSON.stringify(entry)],
    );
  }
  list(actor: Actor, caseId: string) {
    return this.tx(actor.tenantId, async (c) =>
      (
        await c.query<Row>(
          `select ${columns} from leave_entry where employment_case_id=$1 order by start_date desc`,
          [caseId],
        )
      ).rows.map(output),
    );
  }
  create(actor: Actor, caseId: string, key: string, input: LeaveEntryInput) {
    return this.tx(actor.tenantId, async (c) => {
      // The caregiver is resolved from the case under forced RLS, never taken
      // from the client, so a ledger row can only scope to its own tenant.
      const scope = await c.query<{ caregiver_id: string }>(
        `select caregiver_id from employment_case where id=$1`,
        [caseId],
      );
      if (!scope.rowCount) throw new Error('case_not_found');
      const hash = createHash('sha256').update(JSON.stringify({ caseId, input })).digest('hex');
      const replayed = await this.replay(c, 'leave_entry.create', key, hash);
      if (replayed) return { entry: replayed, replayed: true };
      const saved = await c.query<Row>(
        `insert into leave_entry (id,tenant_id,employment_case_id,caregiver_id,entry_type,start_date,end_date,days,note,created_by,updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) returning ${columns}`,
        [
          randomUUID(),
          actor.tenantId,
          caseId,
          scope.rows[0]!.caregiver_id,
          input.entryType,
          input.startDate,
          input.endDate,
          input.days,
          input.note ?? null,
          actor.userId,
        ],
      );
      const entry = output(saved.rows[0]!);
      await this.evidence(c, actor, caseId, entry.id, 'leave.entry_recorded', true);
      await this.receipt(c, actor, 'leave_entry.create', key, hash, entry);
      return { entry, replayed: false };
    });
  }
  update(actor: Actor, caseId: string, entryId: string, key: string, input: LeaveEntryUpdate) {
    return this.tx(actor.tenantId, async (c) => {
      const hash = createHash('sha256')
        .update(JSON.stringify({ caseId, entryId, input }))
        .digest('hex');
      const replayed = await this.replay(c, 'leave_entry.update', key, hash);
      if (replayed) return { entry: replayed, replayed: true };
      const previous = await c.query<{ version: number; status: string }>(
        `select version,status from leave_entry where id=$1 and employment_case_id=$2 for update`,
        [entryId, caseId],
      );
      if (!previous.rowCount) throw new Error('entry_not_found');
      if (input.version !== previous.rows[0]!.version) throw new Error('version_conflict');
      const saved = await c.query<Row>(
        `update leave_entry set entry_type=$3,start_date=$4,end_date=$5,days=$6,note=$7,status=$8,version=leave_entry.version+1,updated_by=$9,updated_at=now() where id=$1 and employment_case_id=$2 returning ${columns}`,
        [
          entryId,
          caseId,
          input.entryType,
          input.startDate,
          input.endDate,
          input.days,
          input.note ?? null,
          input.status,
          actor.userId,
        ],
      );
      const entry = output(saved.rows[0]!);
      const cancelled = input.status === 'cancelled' && previous.rows[0]!.status !== 'cancelled';
      // A cancellation is case history; a same-status correction stays out of
      // the human timeline but is still fully audited.
      await this.evidence(
        c,
        actor,
        caseId,
        entry.id,
        cancelled ? 'leave.entry_cancelled' : 'leave.entry_updated',
        cancelled,
      );
      await this.receipt(c, actor, 'leave_entry.update', key, hash, entry);
      return { entry, replayed: false };
    });
  }
}
