import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  CanonicalIntelligenceService,
  type CloseMonthInput,
} from './canonical-intelligence-service.js';

const actor = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000002',
  correlationId: 'synthetic-close-integrity',
};
const caseId = '00000000-0000-4000-8000-000000000003';
const entryId = '00000000-0000-4000-8000-000000000004';
const input: CloseMonthInput = {
  payrollReference: entryId,
  payrollVersion: 2,
  month: '2026-08',
  paymentDate: '2026-09-01',
  paymentMethod: 'bank_transfer',
  baseSalary: 6000,
  additions: 0,
  deductions: 0,
  total: 6000,
};
const now = new Date('2026-09-01T10:00:00Z');

function fixture(
  options: {
    status?: string;
    version?: number;
    manager?: boolean;
    failAfterAudit?: boolean;
    openingBalance?: number;
    contextualHoliday?: number;
  } = {},
) {
  const queries: { text: string; values?: unknown[] }[] = [];
  const receipts = new Map<string, { request_hash: string; response: unknown }>();
  let closes: Record<string, unknown>[] = [];
  let timeline = 0,
    audit = 0;
  let before:
    | {
        closes: Record<string, unknown>[];
        timeline: number;
        audit: number;
        receipts: typeof receipts;
      }
    | undefined;
  const row = {
    id: entryId,
    payroll_month: '2026-08-01',
    base_salary: '6000',
    work_days: '26',
    paid_rest_days: '0',
    rest_day_rate: '0',
    paid_holidays: options.contextualHoliday === undefined ? '0' : '1',
    holiday_pay: String(options.contextualHoliday ?? 0),
    vacation_days: '0',
    vacation_pay: '0',
    sick_days: '0',
    sick_pay: '0',
    other_absence_days: '0',
    employer_contributions: '1000',
    additional_payments: [],
    pocket_money: '0',
    deductions: '0',
    advances: '0',
    agreed_deductions: '0',
    total: String(7000 + (options.contextualHoliday ?? 0)),
    status: options.status ?? 'final',
    version: options.version ?? 2,
    created_at: now,
    updated_at: now,
    calculation_context:
      options.contextualHoliday !== undefined
        ? {
            schemaVersion: 1,
            dayFacts: [
              {
                id: 'synthetic-holiday-event',
                date: '2026-08-12',
                kind: 'holiday_worked',
                quantity: 1,
                ruleId: 'synthetic-holiday',
              },
            ],
          }
        : options.openingBalance === undefined
          ? null
          : {
              schemaVersion: 1,
              openingBalance: {
                sourceMonth: '2026-07',
                amount: options.openingBalance,
                reference: '00000000-0000-4000-8000-000000000005',
                sourceVersion: 1,
                ruleId: 'synthetic-carry',
              },
            },
    calculation_policy_snapshot:
      options.openingBalance === undefined && options.contextualHoliday === undefined
        ? []
        : [
            {
              id: options.contextualHoliday === undefined ? 'synthetic-carry' : 'synthetic-holiday',
              code: 'synthetic-saved-policy',
              version: 1,
              status: 'active',
              effectiveFrom: '2026-01-01',
              effectiveTo: null,
              sourceReference: 'https://example.invalid/synthetic-approved-rule',
              sourceVerifiedAt: '2026-01-01T00:00:00Z',
              reviewedBy: actor.userId,
              approvedAt: '2026-01-02T00:00:00Z',
              config:
                options.contextualHoliday === undefined
                  ? { kind: 'carry', allowSignedCarry: true }
                  : {
                      kind: 'day',
                      purpose: 'holiday_worked',
                      treatment: 'addition',
                      dailyRate: 440,
                      overlap: 'exclusive',
                      priority: 1,
                    },
            },
          ],
  };
  const client = {
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (text === 'begin') {
        before = { closes: [...closes], timeline, audit, receipts: new Map(receipts) };
        return { rows: [], rowCount: 0 };
      }
      if (text === 'rollback') {
        if (before) {
          closes = before.closes;
          timeline = before.timeline;
          audit = before.audit;
          receipts.clear();
          for (const [key, value] of before.receipts) receipts.set(key, value);
        }
        return { rows: [], rowCount: 0 };
      }
      if (
        text === 'commit' ||
        text.includes('set local role') ||
        text.includes('set_config') ||
        text.includes('pg_advisory_xact_lock')
      )
        return { rows: [], rowCount: 0 };
      if (text.includes('from tenant_membership'))
        return { rows: [], rowCount: options.manager === false ? 0 : 1 };
      if (text.includes('select 1 from employment_case')) return { rows: [], rowCount: 1 };
      if (text.includes('select request_hash,response')) {
        const found = receipts.get(String(values?.[0]));
        return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
      }
      if (text.startsWith('select') && text.includes('from payroll_month_close'))
        return { rows: closes, rowCount: closes.length };
      if (text.startsWith('select') && text.includes('from payroll_entry'))
        return {
          rows: values?.[2] === entryId ? [row] : [],
          rowCount: values?.[2] === entryId ? 1 : 0,
        };
      if (text.includes('insert into timeline_event')) {
        timeline++;
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('insert into audit_event')) {
        audit++;
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('insert into payroll_month_close')) {
        if (options.failAfterAudit) throw Error('synthetic-post-audit-failure');
        const v = values!;
        const close = {
          id: v[0],
          payroll_reference: v[3],
          payroll_month: `${v[4]}-01`,
          payment_date: v[5],
          payment_method: v[6],
          closed_by: v[9],
          total_amount: String(v[11]),
          base_salary_amount: String(v[12]),
          additions_amount: String(v[13]),
          deductions_amount: String(v[14]),
          settlement_basis: 'worker',
          payroll_entry_id: v[15],
          payroll_version: v[16],
          calculation_total: String(v[17]),
          employer_contributions_amount: String(v[18]),
          opening_balance_amount: String(v[19]),
          closed_at: now,
        };
        closes.push(close);
        return { rows: [close], rowCount: 1 };
      }
      if (text.includes('list_caredesk_family_members'))
        return { rows: [{ user_id: actor.userId, display_name: 'Synthetic closer' }], rowCount: 1 };
      if (text.includes('insert into idempotency_record')) {
        receipts.set(String(values?.[1]), {
          request_hash: String(values?.[2]),
          response: JSON.parse(String(values?.[3])),
        });
        return { rows: [], rowCount: 1 };
      }
      throw Error(`Unexpected query: ${text}`);
    },
    release() {},
  };
  return {
    service: new CanonicalIntelligenceService({ connect: async () => client } as unknown as Pool),
    queries,
    counts: () => ({ closes: closes.length, timeline, audit, receipts: receipts.size }),
  };
}

describe('approved canonical close integrity', () => {
  it('refuses contextual stored money that contradicts its authentic approved policy snapshot', async () => {
    const f = fixture({ contextualHoliday: 1000 });
    await expect(
      f.service.close(actor, caseId, 'synthetic-policy-tamper', {
        ...input,
        total: 7000,
        additions: 1000,
      }),
    ).rejects.toThrow('payroll_close_amount_mismatch');
    expect(f.counts()).toEqual({ closes: 0, timeline: 0, audit: 0, receipts: 0 });
  });

  it('closes contextual money from its historical snapshot without querying current policy availability', async () => {
    const f = fixture({ contextualHoliday: 440 });
    const result = await f.service.close(actor, caseId, 'synthetic-policy-history', {
      ...input,
      total: 6440,
      additions: 440,
    });
    expect(result.close.total).toBe(6440);
    expect(f.queries.some((q) => q.text.includes('from payroll_policy_rule'))).toBe(false);
  });

  it('does not authorize positive carry from a receipt certifying a completed payment', async () => {
    const f = fixture({ openingBalance: 1000 });
    await expect(
      f.service.close(actor, caseId, 'synthetic-positive-carry', {
        ...input,
        total: 7000,
        additions: 1000,
      }),
    ).rejects.toThrow('payroll_carry_source_mismatch');
    expect(f.counts().closes).toBe(0);
  });
  it('derives worker settlement from the final stored row, preserving calculation cost', async () => {
    const f = fixture();
    const result = await f.service.close(actor, caseId, 'synthetic-key-01', input);
    expect(result.close).toMatchObject({
      total: 6000,
      calculationTotal: 7000,
      employerContributions: 1000,
      openingBalance: 0,
      payrollVersion: 2,
      settlementBasis: 'worker',
    });
    expect(f.counts()).toEqual({ closes: 1, timeline: 1, audit: 1, receipts: 1 });
    const locks = f.queries.filter((q) => q.text.includes('pg_advisory_xact_lock'));
    expect(locks[0]?.values).toEqual([`payroll-month:${actor.tenantId}:${caseId}:2026-08`]);
    expect(f.queries.indexOf(locks[0]!)).toBeLessThan(
      f.queries.findIndex((q) => q.text.includes('from payroll_entry')),
    );
  });
  it('rejects 5,000 against a stored 6,000 settlement without any evidence writes', async () => {
    const f = fixture();
    await expect(
      f.service.close(actor, caseId, 'synthetic-key-02', {
        ...input,
        total: 5000,
        deductions: 1000,
      }),
    ).rejects.toThrow('payroll_close_amount_mismatch');
    expect(f.counts()).toEqual({ closes: 0, timeline: 0, audit: 0, receipts: 0 });
    expect(f.queries.at(-1)?.text).toBe('rollback');
  });
  it('rejects different components even if their total is the same', async () => {
    const f = fixture();
    await expect(
      f.service.close(actor, caseId, 'synthetic-key-03', {
        ...input,
        baseSalary: 5000,
        additions: 1000,
      }),
    ).rejects.toThrow('payroll_close_amount_mismatch');
    expect(f.counts().closes).toBe(0);
  });
  it('requires final state, correct reference and exact version', async () => {
    await expect(
      fixture({ status: 'draft' }).service.close(actor, caseId, 'synthetic-key-04', input),
    ).rejects.toThrow('payroll_final_required');
    await expect(
      fixture({ version: 3 }).service.close(actor, caseId, 'synthetic-key-05', input),
    ).rejects.toThrow('version_conflict');
    await expect(
      fixture().service.close(actor, caseId, 'synthetic-key-06', {
        ...input,
        payrollReference: '00000000-0000-4000-8000-000000000099',
      }),
    ).rejects.toThrow('payroll_reference_not_found');
    await expect(
      fixture().service.close(actor, caseId, 'synthetic-key-07', {
        ...input,
        payrollVersion: undefined,
      } as unknown as CloseMonthInput),
    ).rejects.toThrow('version_required');
  });
  it('replays equivalent closes with the same or a new key and writes evidence once', async () => {
    const f = fixture();
    const first = await f.service.close(actor, caseId, 'synthetic-key-08', input);
    const replay = await f.service.close(actor, caseId, 'synthetic-key-08', input);
    const newKey = await f.service.close(actor, caseId, 'synthetic-key-09', input);
    expect(replay).toEqual({ close: first.close, replayed: true });
    expect(newKey).toEqual({ close: first.close, replayed: true });
    expect(f.counts()).toEqual({ closes: 1, timeline: 1, audit: 1, receipts: 2 });
  });
  it('rejects changed content both for a reused key and a new key', async () => {
    const f = fixture();
    await f.service.close(actor, caseId, 'synthetic-key-10', input);
    await expect(
      f.service.close(actor, caseId, 'synthetic-key-10', { ...input, paymentMethod: 'cash' }),
    ).rejects.toThrow('idempotency_conflict');
    await expect(
      f.service.close(actor, caseId, 'synthetic-key-11', {
        ...input,
        baseSalary: 5000,
        additions: 1000,
      }),
    ).rejects.toThrow('payroll_close_conflict');
    expect(f.counts()).toEqual({ closes: 1, timeline: 1, audit: 1, receipts: 1 });
  });
  it('checks authorization before replaying an immutable receipt', async () => {
    const f = fixture({ manager: false });
    await expect(f.service.close(actor, caseId, 'synthetic-key-12', input)).rejects.toThrow(
      'manager_required',
    );
    expect(f.queries.some((q) => q.text.includes('select request_hash,response'))).toBe(false);
  });
  it('rolls back Timeline and Audit if insertion fails after both were written', async () => {
    const f = fixture({ failAfterAudit: true });
    await expect(f.service.close(actor, caseId, 'synthetic-key-13', input)).rejects.toThrow(
      'synthetic-post-audit-failure',
    );
    expect(f.queries.some((q) => q.text.includes('insert into audit_event'))).toBe(true);
    expect(f.counts()).toEqual({ closes: 0, timeline: 0, audit: 0, receipts: 0 });
    expect(f.queries.at(-1)?.text).toBe('rollback');
  });
  it('keeps explicit signed carry separate from monthly wage and employer contributions', async () => {
    const f = fixture({ openingBalance: -1000 });
    const result = await f.service.close(actor, caseId, 'synthetic-key-14', {
      ...input,
      total: 5000,
      deductions: 1000,
    });
    expect(result.close).toMatchObject({
      total: 5000,
      calculationTotal: 7000,
      employerContributions: 1000,
      openingBalance: -1000,
      baseSalary: 6000,
      additions: 0,
      deductions: 1000,
    });
  });
});
