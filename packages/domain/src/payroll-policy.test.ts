import { describe, expect, it } from 'vitest';
import { calculateMonthlyPayroll, type PayrollComponents } from './payroll.js';
import {
  assertPayrollMoneyPrecision,
  deriveApprovedPayrollComponents,
  derivePayrollSettlement,
  PayrollPolicyError,
  type PayrollCalculationContext,
  type PayrollRuleConfiguration,
  type VerifiedPayrollRule,
} from './payroll-policy.js';

// All policy amounts are synthetic test conventions, never statutory defaults.
const blank = (): PayrollComponents => ({
  baseSalary: 6000,
  paidRestDays: 0,
  restDayRate: 0,
  holidayPay: 0,
  vacationPay: 0,
  sickPay: 0,
  employerContributions: 0,
  additionalPayments: [],
  pocketMoney: 0,
  deductions: 0,
  advances: 0,
  agreedDeductions: 0,
});
const rule = (id: string, config: PayrollRuleConfiguration): VerifiedPayrollRule => ({
  id,
  code: `synthetic.${id}`,
  version: 1,
  status: 'active',
  effectiveFrom: '2026-01-01',
  effectiveTo: '2026-12-31',
  sourceReference: 'synthetic acceptance source',
  sourceVerifiedAt: '2026-01-01T00:00:00Z',
  reviewedBy: 'synthetic reviewer',
  approvedAt: '2026-01-02T00:00:00Z',
  config,
});
const dayRule = (
  id: string,
  purpose: Extract<PayrollRuleConfiguration, { kind: 'day' }>['purpose'],
  treatment: Extract<PayrollRuleConfiguration, { kind: 'day' }>['treatment'] = 'addition',
  priority = 10,
) => rule(id, { kind: 'day', purpose, treatment, dailyRate: 440, overlap: 'exclusive', priority });
const period = rule('partial', {
  kind: 'proration',
  convention: 'exclude_rest_days_from_both_terms',
});
const derive = (
  context: PayrollCalculationContext,
  rules: VerifiedPayrollRule[],
  input = blank(),
  month = '2026-07',
) => deriveApprovedPayrollComponents(input, context, month, rules);

describe('governed payroll derivation', () => {
  it('keeps no-context amounts and historical total semantics', () => {
    const input = { ...blank(), employerContributions: 1000, advances: 6500 };
    const result = deriveApprovedPayrollComponents(input, undefined, '2026-07', []);
    expect(result.components).toEqual(input);
    expect(calculateMonthlyPayroll(result.components).total).toBe(500);
    expect(result.settlement).toMatchObject({
      payableToWorker: -500,
      employmentCost: 7000,
      previouslyPaid: 6500,
    });
  });

  it.each([
    [5, 3200],
    [6, 3318.52],
    [0, 3318.52],
  ] as const)('uses selected rest day %s and both inclusive endpoints', (restDay, amount) => {
    const result = derive(
      {
        schemaVersion: 1,
        restDay,
        salaryPeriods: [
          { from: '2026-07-16', to: '2026-07-31', monthlySalary: 6400, ruleId: 'partial' },
        ],
      },
      [period],
    );
    expect(result.components.baseSalary).toBe(amount);
    expect(result.ruleIds).toEqual(['partial']);
  });

  it('handles an employment end date and effective salary changes without overlapping periods', () => {
    const result = derive(
      {
        schemaVersion: 1,
        restDay: 5,
        salaryPeriods: [
          { from: '2026-07-01', to: '2026-07-15', monthlySalary: 6400, ruleId: 'partial' },
          { from: '2026-07-16', to: '2026-07-23', monthlySalary: 7800, ruleId: 'partial' },
        ],
      },
      [period],
    );
    // 13/26 * 6400 + 7/26 * 7800 = 5300, under this synthetic convention.
    expect(result.components.baseSalary).toBe(5300);
  });

  it('clips employment dates to the payroll month and refuses facts after employment ends', () => {
    const result = derive(
      {
        schemaVersion: 1,
        restDay: 5,
        salaryPeriods: [
          { from: '2026-01-01', to: '2026-12-31', monthlySalary: 6400, ruleId: 'partial' },
        ],
      },
      [period],
    );
    expect(result.components.baseSalary).toBe(6400);
    expect(() =>
      derive(
        {
          schemaVersion: 1,
          restDay: 5,
          salaryPeriods: [
            { from: '2026-01-01', to: '2026-07-15', monthlySalary: 6400, ruleId: 'partial' },
          ],
          dayFacts: [
            {
              id: 'after-end',
              date: '2026-07-16',
              kind: 'vacation_paid',
              quantity: 1,
              ruleId: 'leave',
            },
          ],
        },
        [period, dayRule('leave', 'vacation_paid', 'included_in_base')],
      ),
    ).toThrow('outsideEmploymentPeriod');
  });

  it('rejects overlapping salary periods and missing selected rest day', () => {
    const salaryPeriods = [
      { from: '2026-07-01', to: '2026-07-16', monthlySalary: 6000, ruleId: 'partial' },
      { from: '2026-07-16', to: '2026-07-31', monthlySalary: 7000, ruleId: 'partial' },
    ];
    expect(() => derive({ schemaVersion: 1, restDay: 6, salaryPeriods }, [period])).toThrow(
      'overlapping_periods',
    );
    expect(() => derive({ schemaVersion: 1, salaryPeriods }, [period])).toThrow('invalid_context');
  });

  it('fails closed without an effective reviewed server policy', () => {
    const context: PayrollCalculationContext = {
      schemaVersion: 1,
      restDay: 6,
      salaryPeriods: [
        { from: '2026-07-01', to: '2026-07-31', monthlySalary: 6000, ruleId: 'partial' },
      ],
    };
    expect(() => derive(context, [])).toThrow('rule_unavailable');
    expect(() => derive(context, [{ ...period, sourceReference: '' }])).toThrow('rule_unavailable');
    expect(() => derive(context, [{ ...period, effectiveTo: '2026-07-15' }])).toThrow(
      'rule_unavailable',
    );
    expect(() => derive(context, [{ ...period, approvedAt: '2025-12-31T00:00:00Z' }])).toThrow(
      'rule_unavailable',
    );
  });

  it('deduplicates identical day facts and applies only the explicitly prioritized overlap', () => {
    const rest = {
      id: 'rest',
      date: '2026-07-18',
      kind: 'rest_worked' as const,
      quantity: 1,
      ruleId: 'rest-rule',
    };
    const holiday = {
      id: 'holiday',
      date: '2026-07-18',
      kind: 'holiday_worked' as const,
      quantity: 1,
      ruleId: 'holiday-rule',
    };
    const result = derive({ schemaVersion: 1, restDay: 6, dayFacts: [rest, rest, holiday] }, [
      dayRule('rest-rule', 'rest_worked'),
      dayRule('holiday-rule', 'holiday_worked', 'addition', 20),
    ]);
    expect(result.components.paidRestDays).toBe(0);
    expect(result.components.holidayPay).toBe(440);
    expect(result.settlement.payableToWorker).toBe(6440);
  });

  it('does not guess precedence when two exclusive facts have equal policy priority', () => {
    expect(() =>
      derive(
        {
          schemaVersion: 1,
          restDay: 6,
          dayFacts: [
            { id: 'a', date: '2026-07-18', kind: 'rest_worked', quantity: 1, ruleId: 'a' },
            { id: 'b', date: '2026-07-18', kind: 'holiday_worked', quantity: 1, ruleId: 'b' },
          ],
        },
        [dayRule('a', 'rest_worked'), dayRule('b', 'holiday_worked')],
      ),
    ).toThrow('ambiguous_overlap');
  });

  it('does not overpay repeated same-date facts with distinct event identities', () => {
    const fact = {
      id: 'first',
      date: '2026-07-18',
      kind: 'rest_worked' as const,
      quantity: 1,
      ruleId: 'rest',
    };
    const result = derive(
      { schemaVersion: 1, restDay: 6, dayFacts: [fact, { ...fact, id: 'second' }] },
      [dayRule('rest', 'rest_worked')],
    );
    expect(result.components.paidRestDays).toBe(1);
    expect(result.settlement.payableToWorker).toBe(6440);
  });

  it('does not treat an ordinary rest day as unpaid absence without an explicit classified fact and policy', () => {
    const result = derive(
      {
        schemaVersion: 1,
        restDay: 6,
        salaryPeriods: [
          { from: '2026-07-01', to: '2026-07-31', monthlySalary: 6000, ruleId: 'partial' },
        ],
        dayFacts: [],
      },
      [period],
    );
    expect(result.components.baseSalary).toBe(6000);
    expect(result.components.paidRestDays).toBe(0);
    expect(result.settlement.payableToWorker).toBe(6000);
  });

  it('permits stacking only when the reviewed configuration explicitly permits it', () => {
    const holiday = dayRule('holiday', 'holiday_worked');
    if (holiday.config.kind === 'day') holiday.config.overlap = 'stack';
    const result = derive(
      {
        schemaVersion: 1,
        restDay: 6,
        dayFacts: [
          { id: 'a', date: '2026-07-18', kind: 'rest_worked', quantity: 1, ruleId: 'rest' },
          { id: 'b', date: '2026-07-18', kind: 'holiday_worked', quantity: 1, ruleId: 'holiday' },
        ],
      },
      [dayRule('rest', 'rest_worked'), holiday],
    );
    expect(result.settlement.payableToWorker).toBe(6880);
  });

  it('keeps paid vacation inside the monthly base and redemption separately', () => {
    const result = derive(
      {
        schemaVersion: 1,
        dayFacts: [
          { id: 'leave', date: '2026-07-15', kind: 'vacation_paid', quantity: 1, ruleId: 'leave' },
          {
            id: 'redemption',
            date: '2026-07-16',
            kind: 'vacation_redemption',
            quantity: 0.5,
            ruleId: 'redemption',
          },
        ],
      },
      [
        dayRule('leave', 'vacation_paid', 'included_in_base'),
        dayRule('redemption', 'vacation_redemption'),
      ],
    );
    expect(result.components.vacationPay).toBe(220);
    expect(result.settlement.payableToWorker).toBe(6220);
  });

  it('calculates illness episode position across a month boundary from an explicit episode start', () => {
    const sick = dayRule('sick', 'sick');
    if (sick.config.kind === 'day')
      sick.config.episodeRates = [
        { throughDay: 1, multiplier: 0 },
        { throughDay: 3, multiplier: 0.5 },
        { throughDay: null, multiplier: 1 },
      ];
    const result = derive(
      {
        schemaVersion: 1,
        dayFacts: [
          {
            id: 'sick-day',
            date: '2026-07-01',
            kind: 'sick',
            quantity: 1,
            ruleId: 'sick',
            episodeId: 'episode',
            episodeStart: '2026-06-29',
          },
        ],
      },
      [sick],
    );
    expect(result.components.sickPay).toBe(220); // third day, synthetic 50% band
    expect(() =>
      derive(
        {
          schemaVersion: 1,
          dayFacts: [{ id: 'x', date: '2026-07-01', kind: 'sick', quantity: 1, ruleId: 'sick' }],
        },
        [sick],
      ),
    ).toThrow('invalid_context');
  });

  it('derives unpaid absence from an explicit salary source so re-saving is idempotent', () => {
    const context: PayrollCalculationContext = {
      schemaVersion: 1,
      restDay: 6,
      salaryPeriods: [
        { from: '2026-07-01', to: '2026-07-31', monthlySalary: 6000, ruleId: 'partial' },
      ],
      dayFacts: [
        {
          id: 'absence',
          date: '2026-07-15',
          kind: 'unpaid_absence',
          quantity: 1,
          ruleId: 'absence',
        },
      ],
    };
    const policies = [period, dayRule('absence', 'unpaid_absence', 'base_reduction')];
    const first = derive(context, policies);
    expect(first.components.baseSalary).toBe(5560);
    expect(derive(context, policies, first.components).components.baseSalary).toBe(5560);
    expect(() => derive({ schemaVersion: 1, dayFacts: context.dayFacts }, policies)).toThrow(
      'requiredForBaseReduction',
    );
  });

  it('retains separate deduction identities and rejects category cap splitting', () => {
    const medical = rule('medical', {
      kind: 'deduction',
      category: 'medical',
      maximum: 150,
      actualCostFraction: 0.5,
      consentRequired: false,
    });
    const housing = rule('housing', {
      kind: 'deduction',
      category: 'housing',
      maximum: 300,
      actualCostFraction: 1,
      consentRequired: true,
    });
    const context: PayrollCalculationContext = {
      schemaVersion: 1,
      deductionItems: [
        {
          id: 'invoice-m',
          category: 'medical',
          amount: 100,
          actualCost: 200,
          consent: false,
          ruleId: 'medical',
        },
        {
          id: 'invoice-h',
          category: 'housing',
          amount: 250,
          actualCost: 250,
          consent: true,
          ruleId: 'housing',
        },
      ],
    };
    const result = derive(context, [medical, housing]);
    expect(result.components.deductions).toBe(350);
    expect(result.settlement.payableToWorker).toBe(5650);
    expect(context.deductionItems?.map((item) => item.category)).toEqual(['medical', 'housing']);
    expect(() =>
      derive(
        {
          ...context,
          deductionItems: [
            ...context.deductionItems!,
            {
              id: 'split',
              category: 'medical',
              amount: 100,
              actualCost: 200,
              consent: false,
              ruleId: 'medical',
            },
          ],
        },
        [medical, housing],
      ),
    ).toThrow('deduction_not_permitted');
    expect(() =>
      derive(
        {
          ...context,
          deductionItems: context.deductionItems!.map((item) => ({ ...item, consent: false })),
        },
        [medical, housing],
      ),
    ).toThrow('deduction_not_permitted');
  });

  it('rejects duplicate payment identity even when repeated under another category', () => {
    const payment = {
      id: 'paid-once',
      date: '2026-06-30',
      appliesToMonth: '2026-07',
      kind: 'advance' as const,
      amount: 400,
    };
    expect(() =>
      derive(
        { schemaVersion: 1, paymentEvents: [payment, { ...payment, kind: 'pocket_money' }] },
        [],
      ),
    ).toThrow('duplicate_event');
    const result = derive(
      {
        schemaVersion: 1,
        paymentEvents: [payment, { ...payment, id: 'other', kind: 'pocket_money' }],
      },
      [],
    );
    expect(result.settlement.previouslyPaid).toBe(800);
    expect(result.settlement.payableToWorker).toBe(5200);
    expect(() =>
      derive({ schemaVersion: 1, paymentEvents: [{ ...payment, appliesToMonth: '2026-08' }] }, []),
    ).toThrow('invalid_context');
  });

  it('preserves a signed carry without changing earned wage or historic total', () => {
    const result = derive(
      {
        schemaVersion: 1,
        openingBalance: {
          sourceMonth: '2026-06',
          amount: -1000,
          reference: 'synthetic prior final row',
          sourceVersion: 2,
          ruleId: 'carry',
        },
      },
      [rule('carry', { kind: 'carry', allowSignedCarry: true })],
    );
    expect(calculateMonthlyPayroll(result.components).total).toBe(6000);
    expect(result.settlement).toMatchObject({
      payableToWorker: 6000,
      openingBalance: -1000,
      closingWorkerBalance: 5000,
      employmentCost: 6000,
    });
  });

  it('rounds derived half-day pay once while refusing raw half-agora inputs', () => {
    const rest = dayRule('rest', 'rest_worked');
    if (rest.config.kind === 'day') rest.config.dailyRate = 372.15;
    const result = derive(
      {
        schemaVersion: 1,
        restDay: 6,
        dayFacts: [
          {
            id: 'half-rest',
            date: '2026-07-18',
            kind: 'rest_worked',
            quantity: 0.5,
            ruleId: 'rest',
          },
        ],
      },
      [rest],
    );
    expect(result.settlement.payableToWorker).toBe(6186.08);
    expect(() =>
      assertPayrollMoneyPrecision({ ...blank(), additionalPayments: [{ amount: 0.005 }] }),
    ).toThrow(PayrollPolicyError);
    expect(() => assertPayrollMoneyPrecision({ ...blank(), baseSalary: 6000.01 })).not.toThrow();
    expect(() => assertPayrollMoneyPrecision({ ...blank(), advances: Number.NaN })).toThrow(
      PayrollPolicyError,
    );
  });

  it('retains already paid money in employment cost and keeps deductions separate', () => {
    expect(
      derivePayrollSettlement({ ...blank(), employerContributions: 1000, advances: 1000 }),
    ).toEqual({
      payableToWorker: 5000,
      openingBalance: 0,
      closingWorkerBalance: 5000,
      wageBeforePriorPayments: 6000,
      previouslyPaid: 1000,
      employerContributions: 1000,
      employmentCost: 7000,
    });
  });

  it('rejects count precision that the database cannot preserve and sums day hundredths exactly', () => {
    const fact = {
      id: 'first',
      date: '2026-07-04',
      kind: 'rest_worked' as const,
      quantity: 0.333,
      ruleId: 'rest',
    };
    expect(() =>
      derive({ schemaVersion: 1, restDay: 6, dayFacts: [fact] }, [dayRule('rest', 'rest_worked')]),
    ).toThrow('invalid_context');
    const result = derive(
      {
        schemaVersion: 1,
        restDay: 6,
        dayFacts: [4, 11, 18, 25].map((day) => ({
          ...fact,
          id: `rest-${day}`,
          date: `2026-07-${String(day).padStart(2, '0')}`,
          quantity: 0.1,
        })),
      },
      [dayRule('rest', 'rest_worked')],
    );
    expect(result.components.paidRestDays).toBe(0.4);
    expect(result.settlement.payableToWorker).toBe(6176);
  });

  it('maps aggregate overflow to controlled validation instead of an unhandled money error', () => {
    expect(() =>
      calculateMonthlyPayroll({ ...blank(), baseSalary: 10_000_000, employerContributions: 1 }),
    ).toThrow('payroll component total is out_of_range');
    expect(() =>
      derive(
        {
          schemaVersion: 1,
          paymentEvents: [
            {
              id: 'a',
              date: '2026-07-01',
              appliesToMonth: '2026-07',
              kind: 'advance',
              amount: 6_000_000,
            },
            {
              id: 'b',
              date: '2026-07-02',
              appliesToMonth: '2026-07',
              kind: 'advance',
              amount: 6_000_000,
            },
          ],
        },
        [],
      ),
    ).toThrow('invalid_context: calculationContext.money_range');
  });

  it('derives recorded day counters without counting redemption or an unworked holiday as worked time', () => {
    const sick = dayRule('sick', 'sick');
    if (sick.config.kind === 'day')
      sick.config.episodeRates = [{ throughDay: null, multiplier: 0 }];
    const input = {
      ...blank(),
      paidHolidays: 0,
      vacationDays: 0,
      sickDays: 0,
      otherAbsenceDays: 0,
    };
    const context: PayrollCalculationContext = {
      schemaVersion: 1,
      restDay: 6,
      salaryPeriods: [
        { from: '2026-07-01', to: '2026-07-31', monthlySalary: 6000, ruleId: 'partial' },
      ],
      dayFacts: [
        { id: 'worked', date: '2026-07-01', kind: 'holiday_worked', quantity: 1, ruleId: 'worked' },
        {
          id: 'unworked',
          date: '2026-07-02',
          kind: 'holiday_unworked',
          quantity: 1,
          ruleId: 'unworked',
        },
        { id: 'leave', date: '2026-07-03', kind: 'vacation_paid', quantity: 1, ruleId: 'leave' },
        {
          id: 'redemption',
          date: '2026-07-04',
          kind: 'vacation_redemption',
          quantity: 0.5,
          ruleId: 'redemption',
        },
        {
          id: 'sick',
          date: '2026-07-05',
          kind: 'sick',
          quantity: 1,
          ruleId: 'sick',
          episodeId: 'sick-episode',
          episodeStart: '2026-07-05',
        },
        {
          id: 'absence',
          date: '2026-07-06',
          kind: 'unpaid_absence',
          quantity: 0.5,
          ruleId: 'absence',
        },
      ],
    };
    const result = deriveApprovedPayrollComponents(input, context, '2026-07', [
      period,
      sick,
      dayRule('worked', 'holiday_worked'),
      dayRule('unworked', 'holiday_unworked', 'included_in_base'),
      dayRule('leave', 'vacation_paid', 'included_in_base'),
      dayRule('redemption', 'vacation_redemption'),
      dayRule('absence', 'unpaid_absence', 'base_reduction'),
    ]);
    expect(result.components).toMatchObject({
      paidHolidays: 1,
      vacationDays: 1,
      sickDays: 1,
      otherAbsenceDays: 0.5,
      holidayPay: 440,
      vacationPay: 220,
      sickPay: 0,
      baseSalary: 5780,
    });
    expect(deriveApprovedPayrollComponents(input, undefined, '2026-07', []).components).toEqual(
      input,
    );
  });
});
