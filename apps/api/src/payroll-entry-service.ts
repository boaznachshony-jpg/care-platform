import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export type PayrollEntryInput = {
  baseSalary: number;
  workDays: number;
  paidRestDays: number;
  restDayRate: number;
  paidHolidays: number;
  holidayPay: number;
  vacationDays: number;
  vacationPay: number;
  sickDays: number;
  sickPay: number;
  otherAbsenceDays: number;
  employerContributions: number;
  additionalPayments: Array<{ description: string; amount: number }>;
  pocketMoney: number;
  deductions: number;
  advances: number;
  agreedDeductions: number;
  total: number;
  status: 'draft' | 'final';
  version?: number;
};
type Actor = { tenantId: string; userId: string; correlationId: string };
type Row = Record<string, unknown> & {
  id: string;
  payroll_month: string;
  created_at: Date;
  updated_at: Date;
};
const number = (value: unknown) => Number(value);
const output = (r: Row) => ({
  id: r.id,
  month: r.payroll_month.slice(0, 7),
  baseSalary: number(r.base_salary),
  workDays: number(r.work_days),
  paidRestDays: number(r.paid_rest_days),
  restDayRate: number(r.rest_day_rate),
  paidHolidays: number(r.paid_holidays),
  holidayPay: number(r.holiday_pay),
  vacationDays: number(r.vacation_days),
  vacationPay: number(r.vacation_pay),
  sickDays: number(r.sick_days),
  sickPay: number(r.sick_pay),
  otherAbsenceDays: number(r.other_absence_days),
  employerContributions: number(r.employer_contributions),
  additionalPayments: r.additional_payments,
  pocketMoney: number(r.pocket_money),
  deductions: number(r.deductions),
  advances: number(r.advances),
  agreedDeductions: number(r.agreed_deductions),
  total: number(r.total),
  status: r.status,
  version: number(r.version),
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});
const columns = `id,payroll_month::text,base_salary::text,work_days::text,paid_rest_days::text,rest_day_rate::text,paid_holidays::text,holiday_pay::text,vacation_days::text,vacation_pay::text,sick_days::text,sick_pay::text,other_absence_days::text,employer_contributions::text,additional_payments,pocket_money::text,deductions::text,advances::text,agreed_deductions::text,total::text,status,version,created_at,updated_at`;
export class PayrollEntryService {
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
  list(actor: Actor, caseId: string) {
    return this.tx(actor.tenantId, async (c) =>
      (
        await c.query<Row>(
          `select ${columns} from payroll_entry where employment_case_id=$1 order by payroll_month desc`,
          [caseId],
        )
      ).rows.map(output),
    );
  }
  get(actor: Actor, caseId: string, month: string) {
    return this.tx(actor.tenantId, async (c) => {
      const r = await c.query<Row>(
        `select ${columns} from payroll_entry where employment_case_id=$1 and payroll_month=($2||'-01')::date`,
        [caseId, month],
      );
      return r.rows[0] ? output(r.rows[0]) : null;
    });
  }
  save(actor: Actor, caseId: string, month: string, key: string, input: PayrollEntryInput) {
    return this.tx(actor.tenantId, async (c) => {
      const exists = await c.query('select 1 from employment_case where id=$1', [caseId]);
      if (!exists.rowCount) throw new Error('case_not_found');
      const hash = createHash('sha256')
        .update(JSON.stringify({ caseId, month, input }))
        .digest('hex');
      const replay = await c.query<{ request_hash: string; response: ReturnType<typeof output> }>(
        `select request_hash,response from idempotency_record where operation='payroll_entry.save' and idempotency_key=$1 for update`,
        [key],
      );
      if (replay.rows[0]) {
        if (replay.rows[0].request_hash !== hash) throw new Error('idempotency_conflict');
        return { entry: replay.rows[0].response, replayed: true };
      }
      const previous = await c.query<{ id: string; version: number; status: string }>(
        `select id,version,status from payroll_entry where employment_case_id=$1 and payroll_month=($2||'-01')::date for update`,
        [caseId, month],
      );
      if (
        input.version !== undefined &&
        previous.rows[0] &&
        input.version !== previous.rows[0].version
      )
        throw new Error('version_conflict');
      const id = previous.rows[0]?.id ?? randomUUID();
      const action = previous.rows[0] ? 'payroll.entry_updated' : 'payroll.entry_created';
      const meaningful = !previous.rows[0] || previous.rows[0].status !== input.status;
      const values = [
        input.baseSalary,
        input.workDays,
        input.paidRestDays,
        input.restDayRate,
        input.paidHolidays,
        input.holidayPay,
        input.vacationDays,
        input.vacationPay,
        input.sickDays,
        input.sickPay,
        input.otherAbsenceDays,
        input.employerContributions,
        JSON.stringify(input.additionalPayments),
        input.pocketMoney,
        input.deductions,
        input.advances,
        input.agreedDeductions,
        input.total,
        input.status,
      ];
      const saved = await c.query<Row>(
        `insert into payroll_entry (id,tenant_id,employment_case_id,payroll_month,base_salary,work_days,paid_rest_days,rest_day_rate,paid_holidays,holiday_pay,vacation_days,vacation_pay,sick_days,sick_pay,other_absence_days,employer_contributions,additional_payments,pocket_money,deductions,advances,agreed_deductions,total,status,created_by,updated_by) values ($1,$2,$3,($4||'-01')::date,${values.map((_, i) => `$${i + 5}`).join(',')},$24,$24) on conflict (tenant_id,employment_case_id,payroll_month) do update set base_salary=$5,work_days=$6,paid_rest_days=$7,rest_day_rate=$8,paid_holidays=$9,holiday_pay=$10,vacation_days=$11,vacation_pay=$12,sick_days=$13,sick_pay=$14,other_absence_days=$15,employer_contributions=$16,additional_payments=$17,pocket_money=$18,deductions=$19,advances=$20,agreed_deductions=$21,total=$22,status=$23,version=payroll_entry.version+1,updated_by=$24,updated_at=now() returning ${columns}`,
        [id, actor.tenantId, caseId, month, ...values, actor.userId],
      );
      const entry = output(saved.rows[0]!);
      await c.query(
        `insert into audit_event (id,tenant_id,actor_id,action,resource_type,resource_id,occurred_at,correlation_id,purpose,change_summary,sensitivity) values ($1,$2,$3,$4,'payroll_entry',$5,now(),$6,'payroll_entry','Payroll entry recorded.','financial_sensitive')`,
        [randomUUID(), actor.tenantId, actor.userId, action, id, actor.correlationId],
      );
      if (meaningful)
        await c.query(
          `insert into timeline_event (id,tenant_id,employment_case_id,event_type_key,summary_key,occurred_at,source_type,source_id,sensitivity) values ($1,$2,$3,$4,'Payroll entry recorded.',now(),'payroll_entry',$5,'financial_sensitive')`,
          [
            randomUUID(),
            actor.tenantId,
            caseId,
            input.status === 'final' ? 'payroll.entry_finalized' : action,
            id,
          ],
        );
      await c.query(
        `insert into idempotency_record (tenant_id,operation,idempotency_key,request_hash,response) values ($1,'payroll_entry.save',$2,$3,$4)`,
        [actor.tenantId, key, hash, JSON.stringify(entry)],
      );
      return { entry, replayed: false };
    });
  }
}
