import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

type Actor = { tenantId: string; userId: string; correlationId: string };
export interface CloseMonthInput {
  payrollReference: string;
  month: string;
  paymentDate: string;
  paymentMethod: 'bank_transfer' | 'cash' | 'check' | 'other';
  total: number;
  baseSalary: number;
  additions: number;
  deductions: number;
}

export interface CanonicalClose {
  id: string;
  payrollReference: string;
  month: string;
  paymentDate: string;
  paymentMethod: CloseMonthInput['paymentMethod'];
  total: number | null;
  baseSalary: number | null;
  additions: number | null;
  deductions: number | null;
  closedAt: string;
}

interface CloseRow {
  id: string;
  payroll_reference: string;
  payroll_month: string;
  payment_date: string;
  payment_method: CloseMonthInput['paymentMethod'];
  total_amount: string | null;
  base_salary_amount: string | null;
  additions_amount: string | null;
  deductions_amount: string | null;
  closed_at: Date;
}

const response = (row: CloseRow): CanonicalClose => ({
  id: row.id,
  payrollReference: row.payroll_reference,
  month: row.payroll_month.slice(0, 7),
  paymentDate: row.payment_date.slice(0, 10),
  paymentMethod: row.payment_method,
  total: row.total_amount === null ? null : Number(row.total_amount),
  baseSalary: row.base_salary_amount === null ? null : Number(row.base_salary_amount),
  additions: row.additions_amount === null ? null : Number(row.additions_amount),
  deductions: row.deductions_amount === null ? null : Number(row.deductions_amount),
  closedAt: row.closed_at.toISOString(),
});

/** One transaction owns the close receipt, human Timeline, Audit and replay. */
export class CanonicalIntelligenceService {
  constructor(private readonly pool: Pool) {}

  private async tenantTx<T>(tenantId: string, work: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
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

  async list(actor: Actor, caseId: string): Promise<CanonicalClose[]> {
    return this.tenantTx(actor.tenantId, async (client) => {
      const rows = await client.query<CloseRow>(
        `select id,payroll_reference,payroll_month::text,payment_date::text,payment_method,
          total_amount::text,base_salary_amount::text,additions_amount::text,
          deductions_amount::text,closed_at from payroll_month_close
          where employment_case_id=$1 order by payroll_month desc`,
        [caseId],
      );
      return rows.rows.map(response);
    });
  }

  async close(actor: Actor, caseId: string, key: string, input: CloseMonthInput) {
    return this.tenantTx(actor.tenantId, async (client) => {
      const manager = await client.query(
        `select 1 from tenant_membership where tenant_id=$1 and user_id=$2
         and status='active' and role in ('owner','manager')`,
        [actor.tenantId, actor.userId],
      );
      if (!manager.rowCount) throw new Error('manager_required');
      const exists = await client.query(`select 1 from employment_case where id=$1`, [caseId]);
      if (!exists.rowCount) throw new Error('case_not_found');

      const requestHash = createHash('sha256')
        .update(JSON.stringify({ caseId, input }))
        .digest('hex');
      const replay = await client.query<{ request_hash: string; response: CanonicalClose }>(
        `select request_hash,response from idempotency_record
         where operation='product_intelligence.month_close' and idempotency_key=$1 for update`,
        [key],
      );
      if (replay.rows[0]) {
        if (replay.rows[0].request_hash !== requestHash) throw new Error('idempotency_conflict');
        return { close: replay.rows[0].response, replayed: true };
      }

      const timelineId = randomUUID();
      const auditId = randomUUID();
      const closeId = randomUUID();
      await client.query(
        `insert into timeline_event (id,tenant_id,employment_case_id,event_type_key,summary_key,
          occurred_at,source_type,source_id,sensitivity)
         values ($1,$2,$3,'payroll.month_closed','Payroll month closed.',now(),
          'payroll_month_close',$4,'financial_sensitive')`,
        [timelineId, actor.tenantId, caseId, closeId],
      );
      await client.query(
        `insert into audit_event (id,tenant_id,actor_id,action,resource_type,resource_id,
          occurred_at,correlation_id,purpose,change_summary,sensitivity)
         values ($1,$2,$3,'payroll.month_closed','payroll_month_close',$4,now(),$5,
          'payroll_close','Payroll month close recorded.','financial_sensitive')`,
        [auditId, actor.tenantId, actor.userId, closeId, actor.correlationId],
      );
      const inserted = await client.query<CloseRow>(
        `insert into payroll_month_close (id,tenant_id,employment_case_id,payroll_reference,
          payroll_month,payment_date,payment_method,timeline_event_id,audit_event_id,closed_by,
          closed_at,correlation_id,total_amount,base_salary_amount,additions_amount,deductions_amount)
         values ($1,$2,$3,$4,($5||'-01')::date,$6,$7,$8,$9,$10,now(),$11,$12,$13,$14,$15)
         returning id,payroll_reference,payroll_month::text,payment_date::text,payment_method,
          total_amount::text,base_salary_amount::text,additions_amount::text,
          deductions_amount::text,closed_at`,
        [
          closeId,
          actor.tenantId,
          caseId,
          input.payrollReference,
          input.month,
          input.paymentDate,
          input.paymentMethod,
          timelineId,
          auditId,
          actor.userId,
          actor.correlationId,
          input.total,
          input.baseSalary,
          input.additions,
          input.deductions,
        ],
      );
      const close = response(inserted.rows[0]!);
      await client.query(
        `insert into idempotency_record (tenant_id,operation,idempotency_key,request_hash,response)
         values ($1,'product_intelligence.month_close',$2,$3,$4)`,
        [actor.tenantId, key, requestHash, JSON.stringify(close)],
      );
      return { close, replayed: false };
    });
  }
}
