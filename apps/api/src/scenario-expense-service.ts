import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from '@caredesk/db';

/**
 * Planning-only Future Cost scenario expenses (migration 0034). Rows feed the
 * deterministic 12-month projection as a FORECAST layer and never assert that
 * a payment happened; canonical payroll records stay untouched.
 */
export type ScenarioExpenseInput = {
  label: string;
  amount: number;
  kind: 'recurring' | 'one_time';
  /** YYYY-MM month the expense starts to apply. */
  startMonth: string;
  /** Optional YYYY-MM window end; recurring expenses only. */
  endMonth?: string | null;
  version?: number;
};
type Actor = { tenantId: string; userId: string; correlationId: string };
type Row = Record<string, unknown> & {
  id: string;
  start_month: string;
  end_month: string | null;
  created_at: Date;
  updated_at: Date;
};
const output = (r: Row) => ({
  id: r.id,
  label: r.label as string,
  amount: Number(r.amount),
  kind: r.kind as 'recurring' | 'one_time',
  startMonth: r.start_month.slice(0, 7),
  endMonth: r.end_month ? r.end_month.slice(0, 7) : null,
  status: r.status as 'active' | 'deleted',
  version: Number(r.version),
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});
export type ScenarioExpense = ReturnType<typeof output>;
const columns = `id,label,amount::text,kind,start_month::text,end_month::text,status,version,created_at,updated_at`;
export class ScenarioExpenseService {
  constructor(private pool: Pool) {}
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
  private tx<T>(tenant: string, work: (client: PoolClient) => Promise<T>) {
    return withTenant(this.pool, tenant, work);
  }
  private async replay(c: PoolClient, operation: string, key: string, hash: string) {
    const existing = await c.query<{ request_hash: string; response: ScenarioExpense }>(
      `select request_hash,response from idempotency_record where operation='${operation}' and idempotency_key=$1 for update`,
      [key],
    );
    if (!existing.rows[0]) return null;
    if (existing.rows[0].request_hash !== hash) throw new Error('idempotency_conflict');
    return existing.rows[0].response;
  }
  private async evidence(
    c: PoolClient,
    actor: Actor,
    caseId: string,
    expenseId: string,
    action: string,
    withTimeline: boolean,
  ) {
    await c.query(
      `insert into audit_event (id,tenant_id,actor_id,action,resource_type,resource_id,occurred_at,correlation_id,purpose,change_summary,sensitivity) values ($1,$2,$3,$4,'scenario_expense',$5,now(),$6,'scenario_expense','Scenario expense recorded.','financial_sensitive')`,
      [randomUUID(), actor.tenantId, actor.userId, action, expenseId, actor.correlationId],
    );
    if (withTimeline)
      await c.query(
        `insert into timeline_event (id,tenant_id,employment_case_id,event_type_key,summary_key,occurred_at,source_type,source_id,sensitivity) values ($1,$2,$3,$4,'Scenario expense recorded.',now(),'scenario_expense',$5,'financial_sensitive')`,
        [randomUUID(), actor.tenantId, caseId, action, expenseId],
      );
  }
  private async receipt(
    c: PoolClient,
    actor: Actor,
    operation: string,
    key: string,
    hash: string,
    response: ScenarioExpense,
  ) {
    await c.query(
      `insert into idempotency_record (tenant_id,operation,idempotency_key,request_hash,response) values ($1,'${operation}',$2,$3,$4)`,
      [actor.tenantId, key, hash, JSON.stringify(response)],
    );
  }
  list(actor: Actor, caseId: string) {
    return this.tx(actor.tenantId, async (c) =>
      (
        await c.query<Row>(
          `select ${columns} from scenario_expense where employment_case_id=$1 and status='active' order by start_month desc, created_at desc`,
          [caseId],
        )
      ).rows.map(output),
    );
  }
  /** Creates when expenseId is absent, updates (optimistic-lock) when present. */
  save(actor: Actor, caseId: string, key: string, input: ScenarioExpenseInput, expenseId?: string) {
    return this.tx(actor.tenantId, async (c) => {
      const exists = await c.query('select 1 from employment_case where id=$1', [caseId]);
      if (!exists.rowCount) throw new Error('case_not_found');
      const hash = createHash('sha256')
        .update(JSON.stringify({ caseId, expenseId: expenseId ?? null, input }))
        .digest('hex');
      const replayed = await this.replay(c, 'scenario_expense.save', key, hash);
      if (replayed) return { expense: replayed, replayed: true };
      let id = expenseId;
      let action = 'payroll.scenario_expense_created';
      if (expenseId) {
        const previous = await c.query<{ version: number }>(
          `select version from scenario_expense where id=$1 and employment_case_id=$2 and status='active' for update`,
          [expenseId, caseId],
        );
        if (!previous.rows[0]) throw new Error('expense_not_found');
        if (input.version !== undefined && input.version !== previous.rows[0].version)
          throw new Error('version_conflict');
        action = 'payroll.scenario_expense_updated';
      } else {
        id = randomUUID();
      }
      const values = [
        input.label,
        input.amount,
        input.kind,
        input.startMonth,
        input.endMonth ?? null,
      ];
      const saved = expenseId
        ? await c.query<Row>(
            `update scenario_expense set label=$3,amount=$4,kind=$5,start_month=($6||'-01')::date,end_month=case when $7::text is null then null else ($7||'-01')::date end,version=version+1,updated_by=$8,updated_at=now() where id=$1 and employment_case_id=$2 returning ${columns}`,
            [expenseId, caseId, ...values, actor.userId],
          )
        : await c.query<Row>(
            `insert into scenario_expense (id,tenant_id,employment_case_id,label,amount,kind,start_month,end_month,created_by,updated_by) values ($1,$2,$3,$4,$5,$6,($7||'-01')::date,case when $8::text is null then null else ($8||'-01')::date end,$9,$9) returning ${columns}`,
            [id, actor.tenantId, caseId, ...values, actor.userId],
          );
      const expense = output(saved.rows[0]!);
      // Creates are Timeline-worthy; corrections stay audit-only (payroll pattern).
      await this.evidence(c, actor, caseId, expense.id, action, !expenseId);
      await this.receipt(c, actor, 'scenario_expense.save', key, hash, expense);
      return { expense, replayed: false };
    });
  }
  /** Soft delete: planning history is never physically removed (no delete grant). */
  remove(actor: Actor, caseId: string, expenseId: string, key: string, version?: number) {
    return this.tx(actor.tenantId, async (c) => {
      const exists = await c.query('select 1 from employment_case where id=$1', [caseId]);
      if (!exists.rowCount) throw new Error('case_not_found');
      const hash = createHash('sha256')
        .update(JSON.stringify({ caseId, expenseId, version: version ?? null }))
        .digest('hex');
      const replayed = await this.replay(c, 'scenario_expense.delete', key, hash);
      if (replayed) return { expense: replayed, replayed: true };
      const previous = await c.query<{ version: number }>(
        `select version from scenario_expense where id=$1 and employment_case_id=$2 and status='active' for update`,
        [expenseId, caseId],
      );
      if (!previous.rows[0]) throw new Error('expense_not_found');
      if (version !== undefined && version !== previous.rows[0].version)
        throw new Error('version_conflict');
      const removed = await c.query<Row>(
        `update scenario_expense set status='deleted',version=version+1,updated_by=$3,updated_at=now() where id=$1 and employment_case_id=$2 returning ${columns}`,
        [expenseId, caseId, actor.userId],
      );
      const expense = output(removed.rows[0]!);
      await this.evidence(c, actor, caseId, expense.id, 'payroll.scenario_expense_deleted', true);
      await this.receipt(c, actor, 'scenario_expense.delete', key, hash, expense);
      return { expense, replayed: false };
    });
  }
}
