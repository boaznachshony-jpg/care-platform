import { describe, expect, it } from 'vitest';
import type { PayrollCalculationContext, VerifiedPayrollRule } from '@caredesk/domain';
import { PayrollCalculationContextSchema, VerifiedPayrollRuleSchema } from './payroll-policy.js';

describe('payroll policy shared boundary', () => {
  it('permits dated fact context but never client numeric rule configuration', () => {
    const context: PayrollCalculationContext = PayrollCalculationContextSchema.parse({
      schemaVersion: 1,
      restDay: 5,
      paymentEvents: [
        {
          id: 'synthetic payment',
          date: '2026-07-01',
          appliesToMonth: '2026-07',
          kind: 'advance',
          amount: 500.01,
        },
      ],
    });
    expect(context.paymentEvents?.[0]?.amount).toBe(500.01);
    expect(
      PayrollCalculationContextSchema.safeParse({ ...context, verifiedRules: [] }).success,
    ).toBe(false);
    expect(
      PayrollCalculationContextSchema.safeParse({
        schemaVersion: 1,
        salaryPeriods: [
          { from: '2026-07-01', to: '2026-07-31', monthlySalary: 0.005, ruleId: 'synthetic' },
        ],
      }).success,
    ).toBe(false);
  });

  it('requires source, review, effective range and active status for server-owned policies', () => {
    const policy: VerifiedPayrollRule = VerifiedPayrollRuleSchema.parse({
      id: 'synthetic',
      code: 'synthetic.rule',
      version: 1,
      status: 'active',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      sourceReference: 'synthetic policy for tests only',
      sourceVerifiedAt: '2026-01-01T00:00:00Z',
      reviewedBy: 'synthetic reviewer',
      approvedAt: '2026-01-02T00:00:00Z',
      config: { kind: 'carry', allowSignedCarry: true },
    });
    expect(policy.id).toBe('synthetic');
    expect(VerifiedPayrollRuleSchema.safeParse({ ...policy, sourceReference: '' }).success).toBe(
      false,
    );
    expect(VerifiedPayrollRuleSchema.safeParse({ ...policy, status: 'draft' }).success).toBe(false);
    expect(
      VerifiedPayrollRuleSchema.safeParse({ ...policy, effectiveTo: '2025-12-31' }).success,
    ).toBe(false);
  });

  it('requires carry source version and rejects sub-agora opening balances', () => {
    const openingBalance = {
      sourceMonth: '2026-06',
      amount: -500,
      reference: 'prior-row',
      sourceVersion: 2,
      ruleId: 'carry',
    };
    expect(
      PayrollCalculationContextSchema.safeParse({ schemaVersion: 1, openingBalance }).success,
    ).toBe(true);
    expect(
      PayrollCalculationContextSchema.safeParse({
        schemaVersion: 1,
        openingBalance: { ...openingBalance, sourceVersion: undefined },
      }).success,
    ).toBe(false);
    expect(
      PayrollCalculationContextSchema.safeParse({
        schemaVersion: 1,
        openingBalance: { ...openingBalance, amount: -0.005 },
      }).success,
    ).toBe(false);
  });

  it('rejects a day quantity that numeric(5,2) would silently round', () => {
    const fact = {
      id: 'synthetic',
      date: '2026-07-18',
      kind: 'rest_worked',
      quantity: 0.333,
      ruleId: 'synthetic-rest',
    };
    expect(
      PayrollCalculationContextSchema.safeParse({ schemaVersion: 1, dayFacts: [fact] }).success,
    ).toBe(false);
    expect(
      PayrollCalculationContextSchema.safeParse({
        schemaVersion: 1,
        dayFacts: [{ ...fact, quantity: 0.25 }],
      }).success,
    ).toBe(true);
  });
});
