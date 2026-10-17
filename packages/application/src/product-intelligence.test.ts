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

  it('DOM-21: reports no comparison when the calendar month before the latest one has no record', () => {
    // The customer recorded June and August but never recorded July. Before
    // this fix, `previousMonthChange` took `months.at(-2)` — August's
    // "previous" record was silently June, two months back — while the label
    // this feeds ("שינוי מהחודש הקודם" / "change from the previous month")
    // still claimed a single adjacent month. An honest "no comparable month"
    // (rendered as `null`, which the screen already shows as "אין השוואה")
    // beats a confident number that answers a different question than its
    // own label.
    const result = projectPayrollAnalytics(
      [
        { month: '2026-06', baseSalary: 0, additions: 0, deductions: 0, total: 100, closed: true },
        { month: '2026-08', baseSalary: 0, additions: 0, deductions: 0, total: 500, closed: true },
      ],
      '2026',
    );
    expect(result.previousMonthChange).toBeNull();
  });

  it('DOM-21: compares across the year boundary instead of losing the comparison in January', () => {
    // The old implementation filtered `records` down to the selected `year`
    // BEFORE picking the "previous" one, so a January record's true previous
    // month — December of the prior year — was thrown away by the filter and
    // the metric vanished. The lookup now searches the full record set.
    const result = projectPayrollAnalytics(
      [
        {
          month: '2025-12',
          baseSalary: 0,
          additions: 0,
          deductions: 0,
          total: 7_000,
          closed: true,
        },
        {
          month: '2026-01',
          baseSalary: 0,
          additions: 0,
          deductions: 0,
          total: 7_300,
          closed: true,
        },
      ],
      '2026',
    );
    expect(result.previousMonthChange).toBe(300);
  });

  it('DOM-21: still reports a change for two genuinely consecutive months in the same year', () => {
    const result = projectPayrollAnalytics(
      [
        {
          month: '2026-03',
          baseSalary: 0,
          additions: 0,
          deductions: 0,
          total: 6_000,
          closed: true,
        },
        {
          month: '2026-04',
          baseSalary: 0,
          additions: 0,
          deductions: 0,
          total: 6_150,
          closed: true,
        },
      ],
      '2026',
    );
    expect(result.previousMonthChange).toBe(150);
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
    // DOM-05/DOM-06 changed what the two portions MEAN, so that they can be
    // added without overlapping: `projected` is the salary forecast alone and
    // `known` is every non-salary cost the month incurs, recurring and dated
    // alike, deduped. `projected + known === total` now holds identically —
    // before, `projected` folded the recurring expense in and `known` folded it
    // in again for any month it also carried a due date.
    expect(result.months[2]).toMatchObject({
      month: '2028-02',
      known: 35,
      projected: 100,
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

  /**
   * DOM-06. This test previously asserted the bug: an actual payroll replaced
   * the WHOLE month, so the recurring ₪40 expense disappeared from the month's
   * total, from the annual total and from the reserve recommendation — while
   * `known` on the same row still reported it. An actual replaces the SALARY
   * forecast, and nothing else.
   */
  it('lets a canonical actual replace the salary forecast, not the whole month', () => {
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
    // Closed month: the canonical closed record replaces the salary line, and
    // the month's own recurring expense is still counted and still explained.
    expect(result.months[0]).toMatchObject({
      actual: 95,
      known: 40,
      projected: 0,
      total: 135,
      status: 'ACTUAL',
    });
    expect(result.months[0]!.components).toHaveLength(2);
    expect(result.months[0]!.components[0]?.source).toBe('closed_payroll');
    // Open entered month: same rule for a payroll entry.
    expect(result.months[1]).toMatchObject({ total: 145, status: 'ACTUAL' });
    expect(result.months[1]!.components[0]?.source).toBe('payroll_entry');
    // Pure forecast month: salary forecast base plus the scenario layer.
    expect(result.months[2]).toMatchObject({ total: 140, status: 'FORECAST' });
  });

  /**
   * DOM-05. An expense that is BOTH monthly and dated used to land in the
   * `knownExpenses` sum and in the `recurring` sum, so the headline total
   * counted it twice while the components list — which deduped with `||` —
   * listed it once. The number and its own explanation disagreed.
   */
  it('counts a monthly expense that also carries a due date exactly once', () => {
    const result = projectFutureCost({
      startMonth: '2028-01',
      baseSalary: 100,
      expenses: [
        {
          id: 'ins',
          label: 'Insurance',
          amount: 50,
          frequency: 'monthly',
          dueDate: '2028-03-15',
        },
      ],
    });
    const march = result.months[2]!;
    expect(march.month).toBe('2028-03');
    expect(march.total).toBe(150);
    expect(march.components).toHaveLength(2);
  });

  it('always sums its components to its headline total', () => {
    const result = projectFutureCost({
      startMonth: '2028-01',
      baseSalary: 100,
      expenses: [
        { id: 'ins', label: 'Insurance', amount: 50, frequency: 'monthly', dueDate: '2028-03-15' },
        { id: 'fee', label: 'Fee', amount: 500, frequency: 'one_time', dueDate: '2028-01-10' },
      ],
      actuals: [{ month: '2028-01', amount: 95, sourceId: 'closed-1' }],
      scenario: { oneTimeExpense: { month: '2028-02', amount: 25, label: 'One off' } },
    });
    for (const month of result.months) {
      const componentSum = month.components.reduce(
        (sum, component) => sum + (component.amount ?? 0),
        0,
      );
      expect(componentSum).toBe(month.total);
    }
    // DOM-06 in the annual figure: the ₪500 fee is inside the year's total.
    expect(result.months[0]!.total).toBe(645);
  });

  /**
   * DOM-04. `roundMoney(amount) = Math.round((amount + Number.EPSILON) * 100) / 100`
   * rounded 8.165 DOWN to 8.16 while Postgres, given the same text, stores
   * 8.17. Twelve of them accumulated by float addition drifted further.
   */
  it('rounds every amount by the one documented rule and does not drift over a year', () => {
    const result = projectFutureCost({
      startMonth: '2028-01',
      baseSalary: 8.165,
      expenses: [],
    });
    expect(result.months[0]!.total).toBe(8.17);
    expect(result.total).toBe(98.04);
  });

  /**
   * E (work plan 16.10.2026). A quarterly or annual expense counted only in
   * the month of its due date: a quarterly payment appeared once a year, and
   * an annual renewal last due before the window did not appear at all.
   */
  describe('quarterly and annual expenses recur at their real frequency', () => {
    const monthsWith = (result: ReturnType<typeof projectFutureCost>, id: string) =>
      result.months
        .filter((month) => month.components.some((component) => component.id === id))
        .map((month) => month.month);

    it('forecasts a quarterly expense four times a year, from its due date', () => {
      const result = projectFutureCost({
        startMonth: '2026-10',
        baseSalary: 0,
        expenses: [
          { id: 'ni', label: 'NI', amount: 600, frequency: 'quarterly', dueDate: '2026-10-15' },
        ],
      });
      expect(monthsWith(result, 'ni')).toEqual(['2026-10', '2027-01', '2027-04', '2027-07']);
      expect(result.total).toBe(2400);
      expect(result.reserveRecommendation).toBe(200);
    });

    it('forecasts an annual expense last due before the window when it falls due again inside it', () => {
      const result = projectFutureCost({
        startMonth: '2026-10',
        baseSalary: 0,
        expenses: [
          {
            id: 'renewal',
            label: 'Insurance renewal',
            amount: 1200,
            frequency: 'annual',
            dueDate: '2025-11-20',
          },
        ],
      });
      expect(monthsWith(result, 'renewal')).toEqual(['2026-11']);
      expect(result.total).toBe(1200);
      const november = result.months[1]!;
      expect(november.components.find((c) => c.id === 'renewal')?.explanation).toBe(
        'Stored annual employment cost, repeated from its last due date',
      );
    });

    it('still counts an annual expense due inside the window exactly once', () => {
      const result = projectFutureCost({
        startMonth: '2026-10',
        baseSalary: 0,
        expenses: [
          { id: 'fee', label: 'Fee', amount: 300, frequency: 'annual', dueDate: '2027-03-01' },
        ],
      });
      expect(monthsWith(result, 'fee')).toEqual(['2027-03']);
      expect(result.total).toBe(300);
    });

    /**
     * The web app records National Insurance as one row per quarter, each
     * marked quarterly. Repeating every row would count each future quarter
     * once per recorded row; only the latest row of the series repeats.
     */
    it('repeats one row per series, so recorded quarters are not multiplied', () => {
      const result = projectFutureCost({
        startMonth: '2026-10',
        baseSalary: 0,
        expenses: [
          { id: 'ni-q1', label: 'NI', amount: 500, frequency: 'quarterly', dueDate: '2026-04-15' },
          { id: 'ni-q2', label: 'NI', amount: 550, frequency: 'quarterly', dueDate: '2026-07-15' },
          { id: 'ni-q3', label: 'NI', amount: 600, frequency: 'quarterly', dueDate: '2026-10-15' },
        ],
      });
      const niMonths = result.months
        .filter((month) => month.components.some((c) => c.id.startsWith('ni-')))
        .map((month) => month.month);
      expect(niMonths).toEqual(['2026-10', '2027-01', '2027-04', '2027-07']);
      // The latest recorded quarter sets the amount carried forward.
      expect(result.total).toBe(2400);
      expect(result.assumptions).toEqual([
        { id: 'ni-q3', label: 'NI repeats every 3 months', amount: 600 },
      ]);
    });

    it('keeps two different quarterly expenses as two series', () => {
      const result = projectFutureCost({
        startMonth: '2026-10',
        baseSalary: 0,
        expenses: [
          { id: 'a', label: 'NI', amount: 100, frequency: 'quarterly', dueDate: '2026-10-15' },
          { id: 'b', label: 'Agency', amount: 50, frequency: 'quarterly', dueDate: '2026-11-01' },
        ],
      });
      expect(monthsWith(result, 'a')).toEqual(['2026-10', '2027-01', '2027-04', '2027-07']);
      expect(monthsWith(result, 'b')).toEqual(['2026-11', '2027-02', '2027-05', '2027-08']);
      expect(result.total).toBe(600);
    });

    it('stops repeating after endMonth', () => {
      const result = projectFutureCost({
        startMonth: '2026-10',
        baseSalary: 0,
        expenses: [
          {
            id: 'ni',
            label: 'NI',
            amount: 600,
            frequency: 'quarterly',
            dueDate: '2026-10-15',
            endMonth: '2027-02',
          },
        ],
      });
      expect(monthsWith(result, 'ni')).toEqual(['2026-10', '2027-01']);
    });

    it('names a quarterly expense it cannot place instead of dropping it silently', () => {
      const result = projectFutureCost({
        startMonth: '2026-10',
        baseSalary: 0,
        expenses: [{ id: 'undated', label: 'Fee', amount: 90, frequency: 'quarterly' }],
      });
      expect(result.total).toBe(0);
      expect(result.unknowns).toEqual(['expense_schedule:undated']);
    });

    it('keeps every month summing to its headline total', () => {
      const result = projectFutureCost({
        startMonth: '2026-10',
        baseSalary: 7000,
        expenses: [
          { id: 'ni', label: 'NI', amount: 612.4, frequency: 'quarterly', dueDate: '2026-07-15' },
          {
            id: 'ins',
            label: 'Insurance',
            amount: 1450,
            frequency: 'annual',
            dueDate: '2026-02-01',
          },
          { id: 'm', label: 'Monthly', amount: 80, frequency: 'monthly' },
        ],
      });
      for (const month of result.months) {
        const sum = month.components.reduce((total, c) => total + (c.amount ?? 0), 0);
        expect(Math.round(sum * 100)).toBe(Math.round(month.total * 100));
      }
      // 12 x (7000 + 80) + 4 x 612.40 + 1450 = 84,960 + 2,449.60 + 1,450
      expect(result.total).toBe(88_859.6);
    });
  });
});
