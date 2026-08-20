import { describe, expect, it } from 'vitest';
import {
  projectCaseHealth,
  projectComplianceTimeline,
  projectFutureCost,
  projectPayrollAnalytics,
  type AttentionFact,
} from './product-intelligence.js';

const fact = (
  id: string,
  dueDate: string,
  overrides: Partial<AttentionFact> = {},
): AttentionFact => ({
  id,
  tenantId: 'tenant-a',
  caseId: 'case-a',
  sourceType: 'task',
  title: id,
  dueDate,
  status: 'open',
  reason: 'Persisted task due date',
  provenance: { sourceId: id },
  ...overrides,
});

describe('product intelligence projections', () => {
  it('orders, groups, deduplicates and tenant/case scopes timeline facts at UTC boundaries', () => {
    const result = projectComplianceTimeline({
      tenantId: 'tenant-a',
      caseId: 'case-a',
      today: '2026-08-15',
      facts: [
        fact('later', '2026-09-01'),
        fact('today', '2026-08-15'),
        fact('overdue', '2026-08-14'),
        fact('today', '2026-08-15'),
        fact('other-tenant', '2026-08-13', { tenantId: 'tenant-b' }),
        fact('other-case', '2026-08-13', { caseId: 'case-b' }),
        fact('done', '2026-08-13', { status: 'completed' }),
      ],
    });
    expect(result.map(({ id, group }) => [id, group])).toEqual([
      ['overdue', 'overdue'],
      ['today', 'today'],
      ['later', 'upcoming'],
    ]);
    expect(result[0]?.provenance.sourceId).toBe('overdue');
  });

  it('scores deterministically within bounds and improves when an issue resolves', () => {
    const factors = [
      {
        id: 'visa',
        title: 'Visa',
        status: 'attention' as const,
        points: 0,
        weight: 20,
        explanation: 'Missing',
        provenance: { sourceType: 'document' as const, sourceIds: [] },
      },
    ];
    expect(projectCaseHealth(factors)).toMatchObject({ score: 0, actionsRemaining: 1 });
    expect(projectCaseHealth([{ ...factors[0]!, status: 'good', points: 20 }]).score).toBe(100);
    expect(projectCaseHealth([{ ...factors[0]!, points: 999 }]).score).toBe(100);
    expect(projectCaseHealth([{ ...factors[0]!, status: 'not_applicable' }]).score).toBe(100);
  });

  it('calculates zero, one and multiple month analytics and cumulative totals', () => {
    expect(projectPayrollAnalytics([], '2026')).toMatchObject({
      total: 0,
      average: 0,
      highest: null,
    });
    const result = projectPayrollAnalytics(
      [
        {
          month: '2026-02',
          baseSalary: 90,
          additions: 20,
          deductions: 10,
          total: 100,
          closed: false,
        },
        { month: '2026-01', baseSalary: 70, additions: 10, deductions: 0, total: 80, closed: true },
      ],
      '2026',
    );
    expect(result.trend.map((x) => x.cumulative)).toEqual([80, 180]);
    expect(result).toMatchObject({
      total: 180,
      average: 90,
      previousMonthChange: 20,
      hasOpenMonth: true,
    });
  });

  it('forecasts exactly 12 calendar months with inspectable known/projected portions', () => {
    const result = projectFutureCost({
      startMonth: '2027-12',
      baseSalary: 100,
      expenses: [
        { id: 'insurance', label: 'Insurance', amount: 10, frequency: 'monthly' },
        {
          id: 'known',
          label: 'Known fee',
          amount: 25,
          frequency: 'one_time',
          dueDate: '2028-02-29',
        },
      ],
    });
    expect(result.months).toHaveLength(12);
    expect(result.months[2]).toMatchObject({
      month: '2028-02',
      known: 25,
      projected: 110,
      total: 135,
    });
    expect(Number.isFinite(result.total)).toBe(true);
    expect(result.assumptions).toHaveLength(2);
  });

  it('uses closed payroll as actual and keeps scenarios planning-only', () => {
    const result = projectFutureCost({
      startMonth: '2028-01',
      baseSalary: 100,
      expenses: [],
      actuals: [{ month: '2028-01', amount: 91.235, sourceId: 'payroll-1' }],
      scenario: {
        salaryChange: { effectiveMonth: '2028-03', amount: 120 },
        oneTimeExpense: { month: '2028-04', amount: 30, label: 'Planned equipment' },
      },
    });
    expect(result.months[0]).toMatchObject({ status: 'ACTUAL', total: 91.24, projected: 0 });
    expect(result.months[2]).toMatchObject({ status: 'FORECAST', projected: 120, total: 120 });
    expect(result.months[3]).toMatchObject({ known: 30, total: 150 });
    expect(result.guidance).toBe('planning_guidance_not_financial_advice');
  });

  it('prefers a closed snapshot, then canonical entered payroll, then forecast', () => {
    const result = projectFutureCost({
      startMonth: '2028-01',
      baseSalary: 100,
      expenses: [],
      enteredPayroll: [
        { month: '2028-01', amount: 110, sourceId: 'open-overridden' },
        { month: '2028-02', amount: 120, sourceId: 'open-payroll' },
      ],
      actuals: [{ month: '2028-01', amount: 90, sourceId: 'closed-payroll' }],
    });
    expect(result.months[0]).toMatchObject({ total: 90, status: 'ACTUAL', projected: 0 });
    expect(result.months[0]?.components[0]?.source).toBe('closed_payroll');
    expect(result.months[1]).toMatchObject({ total: 120, status: 'ACTUAL', projected: 0 });
    expect(result.months[1]?.components[0]?.source).toBe('payroll_entry');
    expect(result.months[2]).toMatchObject({ total: 100, status: 'FORECAST' });
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects unsafe amount %s', (amount) => {
    expect(() =>
      projectFutureCost({ startMonth: '2028-01', baseSalary: amount, expenses: [] }),
    ).toThrow('finite and non-negative');
  });

  it('applies a canonical recurring scenario expense only inside its month window', () => {
    const result = projectFutureCost({
      startMonth: '2028-01',
      baseSalary: 100,
      expenses: [
        {
          id: 'scenario-1',
          label: 'Insurance scenario',
          amount: 50,
          frequency: 'monthly',
          startMonth: '2028-03',
          endMonth: '2028-04',
          source: 'planning_scenario',
        },
      ],
    });
    expect(result.months.map((m) => m.total)).toEqual([
      100, 100, 150, 150, 100, 100, 100, 100, 100, 100, 100, 100,
    ]);
    const inWindow = result.months[2]!.components.find((c) => c.id === 'scenario-1');
    expect(inWindow).toMatchObject({
      source: 'planning_scenario',
      status: 'FORECAST',
      explanation: 'Planning-only value; canonical records are unchanged',
    });
    expect(result.months[0]!.components.some((c) => c.id === 'scenario-1')).toBe(false);
  });

  it('applies a canonical one-time scenario expense on its dated month only', () => {
    const result = projectFutureCost({
      startMonth: '2028-01',
      baseSalary: 100,
      expenses: [
        {
          id: 'scenario-2',
          label: 'Planned equipment',
          amount: 30,
          frequency: 'one_time',
          dueDate: '2028-05-01',
          source: 'planning_scenario',
        },
      ],
    });
    expect(result.months[4]).toMatchObject({ month: '2028-05', known: 30, total: 130 });
    expect(result.months.filter((m) => m.known > 0)).toHaveLength(1);
  });

  it('lets canonical actuals replace forecast plus scenario layers for their month', () => {
    const result = projectFutureCost({
      startMonth: '2028-01',
      baseSalary: 100,
      expenses: [
        {
          id: 'scenario-3',
          label: 'Recurring scenario',
          amount: 40,
          frequency: 'monthly',
          source: 'planning_scenario',
        },
      ],
      actuals: [{ month: '2028-01', amount: 95, sourceId: 'closed-1' }],
      enteredPayroll: [{ month: '2028-02', amount: 105, sourceId: 'entry-1' }],
    });
    // Closed month: only the canonical closed record counts.
    expect(result.months[0]).toMatchObject({ total: 95, status: 'ACTUAL' });
    expect(result.months[0]!.components).toHaveLength(1);
    // Open entered month: only the canonical payroll entry counts.
    expect(result.months[1]).toMatchObject({ total: 105, status: 'ACTUAL' });
    expect(result.months[1]!.components[0]?.source).toBe('payroll_entry');
    // Pure forecast month: salary forecast base plus the scenario layer.
    expect(result.months[2]).toMatchObject({ total: 140, status: 'FORECAST' });
  });
});
