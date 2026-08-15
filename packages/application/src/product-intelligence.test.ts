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
});
