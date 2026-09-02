// Root 8 (DOM-04). Every amount in this module is carried as integer agorot
// between the point it arrives and the point it is returned. The shekel
// `number`s in the input and output types are the HTTP contract, not a second
// money model.
import {
  addAgorot,
  agorotFromShekels,
  scaleAgorot,
  shekelsOf,
  subtractAgorot,
  toIsraelDate,
  ZERO_AGOROT,
  type Agorot,
} from '@caredesk/domain';

export type TimelineGroup = 'overdue' | 'today' | 'this_week' | 'later_this_month' | 'upcoming';
export type AttentionSeverity = 'critical' | 'high' | 'medium' | 'info';

export interface AttentionFact {
  id: string;
  caseId: string;
  tenantId: string;
  sourceType: 'task' | 'document' | 'authorization' | 'insurance' | 'workflow' | 'monthly_close';
  title: string;
  dueDate: string;
  status: 'open' | 'completed';
  reason: string;
  actionTarget?: string;
  provenance: { sourceId: string; ruleId?: string; ruleVersion?: string };
}

export interface ComplianceTimelineItem extends AttentionFact {
  severity: AttentionSeverity;
  group: TimelineGroup;
  daysUntilDue: number;
}

const DAY = 86_400_000;
/**
 * DOM-17. A due date is a CALENDAR day, and which calendar day an instant falls
 * on is a question only a time zone can answer. This used to read UTC fields
 * off whatever it was given, so a task due today was already 'overdue' from
 * 03:00 Israel time that morning whenever the caller handed over an instant.
 * Everything is now reduced to an Asia/Jerusalem calendar day first, and the
 * subtraction happens between two day numbers rather than between two instants.
 */
function businessDay(value: string | Date): number {
  const date = toIsraelDate(value);
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year!, month! - 1, day!) / DAY;
}

/** A deterministic projection: callers must pass the tenant, case and clock explicitly. */
export function projectComplianceTimeline(input: {
  tenantId: string;
  caseId: string;
  today: string;
  facts: readonly AttentionFact[];
}): ComplianceTimelineItem[] {
  const today = businessDay(input.today);
  const endOfMonth = new Date(`${input.today.slice(0, 10)}T00:00:00Z`);
  endOfMonth.setUTCMonth(endOfMonth.getUTCMonth() + 1, 0);
  const monthEndDay = businessDay(endOfMonth);
  const seen = new Set<string>();
  return input.facts
    .filter((fact) => fact.tenantId === input.tenantId && fact.caseId === input.caseId)
    .filter((fact) => fact.status === 'open')
    .filter((fact) => !seen.has(fact.id) && Boolean(seen.add(fact.id)))
    .map((fact) => {
      const daysUntilDue = businessDay(fact.dueDate) - today;
      const group: TimelineGroup =
        daysUntilDue < 0
          ? 'overdue'
          : daysUntilDue === 0
            ? 'today'
            : daysUntilDue <= 7
              ? 'this_week'
              : businessDay(fact.dueDate) <= monthEndDay
                ? 'later_this_month'
                : 'upcoming';
      const severity: AttentionSeverity =
        daysUntilDue < 0
          ? 'critical'
          : daysUntilDue <= 7
            ? 'high'
            : daysUntilDue <= 30
              ? 'medium'
              : 'info';
      return { ...fact, daysUntilDue, group, severity };
    })
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue || a.id.localeCompare(b.id));
}

export interface HealthFactor {
  id: string;
  title: string;
  status: 'good' | 'attention' | 'not_applicable';
  points: number;
  weight: number;
  explanation: string;
  recommendedAction?: string;
  actionTarget?: string;
  /** Stable, inspectable origin for this deterministic factor. */
  provenance: { sourceType: AttentionFact['sourceType'] | 'profile'; sourceIds: string[] };
}

export function projectCaseHealth(factors: readonly HealthFactor[]) {
  const applicable = factors.filter((factor) => factor.status !== 'not_applicable');
  const possible = applicable.reduce((sum, factor) => sum + factor.weight, 0);
  const earned = applicable.reduce(
    (sum, factor) => sum + Math.max(0, Math.min(factor.points, factor.weight)),
    0,
  );
  return {
    score: possible === 0 ? 100 : Math.max(0, Math.min(100, Math.round((earned / possible) * 100))),
    factors: [...factors],
    actionsRemaining: applicable.filter((factor) => factor.status === 'attention').length,
    disclaimer: 'employment_file_health_not_legal_certification' as const,
  };
}

export interface PayrollFact {
  month: string;
  baseSalary: number;
  additions: number;
  deductions: number;
  total: number;
  closed: boolean;
}

/** "2026-01" -> "2025-12". Crosses the year boundary on purpose (see below). */
function previousCalendarMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const prevYear = monthNumber === 1 ? year - 1 : year;
  const prevMonthNumber = monthNumber === 1 ? 12 : monthNumber - 1;
  return `${String(prevYear).padStart(4, '0')}-${String(prevMonthNumber).padStart(2, '0')}`;
}

/**
 * DOM-04. `cumulative` used to be raw float addition across twelve months and
 * `average` was an unrounded division, so a year's running total drifted by
 * fractions of an agora that nothing ever reconciled. Both now accumulate in
 * whole agorot and convert back once, at the return.
 */
export function projectPayrollAnalytics(records: readonly PayrollFact[], year: string) {
  const months = records
    .filter((record) => record.month.startsWith(`${year}-`))
    .sort((a, b) => a.month.localeCompare(b.month));
  let cumulative = ZERO_AGOROT;
  const trend = months.map((record) => {
    cumulative = addAgorot(cumulative, agorotFromShekels(record.total));
    return { ...record, cumulative: shekelsOf(cumulative) };
  });
  const totalAgorot = months.reduce(
    (sum: Agorot, record) => addAgorot(sum, agorotFromShekels(record.total)),
    ZERO_AGOROT,
  );
  const total = shekelsOf(totalAgorot);
  /**
   * DOM-21. This used to be `months.at(-1)` vs `months.at(-2)` from the
   * year-filtered list: two problems compounded there. First, "months" only
   * ever held records inside the selected `year`, so a January record's
   * "previous month" comparison to the December before it was thrown away by
   * the filter and the metric silently vanished instead of comparing across
   * the boundary. Second — and worse, because it does not vanish, it lies —
   * `.at(-2)` is "the second-most-recent record that exists", not "the
   * calendar month before the most recent one". A customer who recorded June
   * and August but never recorded July got "the change from the previous
   * month" computed as August-minus-June while the label still said "previous
   * month" (singular, adjacent). The label and the number disagreed, and the
   * number that looked most current was the wrong one.
   *
   * The fix looks up the specific calendar month before the latest recorded
   * one, in the FULL (unfiltered) record set so a December record on the
   * other side of the year boundary is still found, and only reports a change
   * when that exact month has its own record. Otherwise it says so —
   * `previousMonthChange: null` — which the screen already renders as "אין
   * השוואה" (no comparison), rather than a confident, wrong shekel figure.
   */
  const latestMonth = months.at(-1)?.month;
  const previousMonthRecord = latestMonth
    ? records.find((record) => record.month === previousCalendarMonth(latestMonth))
    : undefined;
  const previousMonthChange =
    latestMonth && previousMonthRecord
      ? shekelsOf(
          subtractAgorot(
            agorotFromShekels(months.at(-1)!.total),
            agorotFromShekels(previousMonthRecord.total),
          ),
        )
      : null;
  return {
    trend,
    total,
    average: months.length ? shekelsOf(scaleAgorot(totalAgorot, 1 / months.length)) : 0,
    highest: months.length ? months.reduce((a, b) => (a.total >= b.total ? a : b)) : null,
    lowest: months.length ? months.reduce((a, b) => (a.total <= b.total ? a : b)) : null,
    previousMonthChange,
    hasOpenMonth: months.some((record) => !record.closed),
  };
}

export interface ForecastExpense {
  id: string;
  label: string;
  amount: number;
  frequency: 'monthly' | 'quarterly' | 'annual' | 'one_time';
  dueDate?: string;
  /** Optional YYYY-MM window: a monthly expense applies only from this month on. */
  startMonth?: string;
  /** Optional YYYY-MM window end (inclusive) for monthly expenses. */
  endMonth?: string;
  /** Provenance of the stored expense; canonical scenario rows are planning-only. */
  source?: 'employment_expense' | 'planning_scenario';
}
export interface FutureCostScenario {
  salaryChange?: { effectiveMonth: string; amount: number };
  insuranceRenewal?: { month: string; amount: number };
  oneTimeExpense?: { month: string; amount: number; label: string };
}
export interface FutureCostActual {
  month: string;
  amount: number;
  sourceId: string;
}
export type FutureCostEnteredPayroll = FutureCostActual;
export function projectFutureCost(input: {
  startMonth: string;
  baseSalary?: number;
  expenses: readonly ForecastExpense[];
  actuals?: readonly FutureCostActual[];
  /** Canonical payroll_entry facts for months that have not been closed yet. */
  enteredPayroll?: readonly FutureCostEnteredPayroll[];
  scenario?: FutureCostScenario;
}) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.startMonth))
    throw new Error('startMonth must be YYYY-MM');
  const amounts = [
    input.baseSalary,
    ...input.expenses.map((expense) => expense.amount),
    ...(input.actuals ?? []).map((actual) => actual.amount),
    ...(input.enteredPayroll ?? []).map((actual) => actual.amount),
    input.scenario?.salaryChange?.amount,
    input.scenario?.insuranceRenewal?.amount,
    input.scenario?.oneTimeExpense?.amount,
  ].filter((amount): amount is number => amount !== undefined);
  if (amounts.some((amount) => !Number.isFinite(amount) || amount < 0))
    throw new Error('Forecast amounts must be finite and non-negative');
  // DOM-04. `roundMoney = (a) => Math.round((a + Number.EPSILON) * 100) / 100`
  // used to live here. EPSILON is ~2.2e-16 while the representation gap at
  // shekel magnitudes is ~1e-13, so it corrected nothing where it mattered and
  // rounded 1.015 up but 8.165 down. Every amount below is converted to whole
  // agorot once, on entry, and back to shekels once, at the return; there is no
  // rounding in between because integer addition does not need any.
  const money = (amount: number): Agorot => agorotFromShekels(amount);
  const start = new Date(`${input.startMonth}-01T00:00:00Z`);
  const safeBase = input.baseSalary ?? 0;
  const months = Array.from({ length: 12 }, (_, offset) => {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + offset, 1));
    const month = date.toISOString().slice(0, 7);
    const actual = input.actuals?.find((item) => item.month === month);
    const entered = input.enteredPayroll?.find((item) => item.month === month);
    const inWindow = (e: ForecastExpense) =>
      (e.startMonth === undefined || month >= e.startMonth) &&
      (e.endMonth === undefined || month <= e.endMonth);
    // DOM-05. There used to be two overlapping sums here: `knownExpenses`
    // (everything with a dueDate in this month) and `recurring` (everything
    // monthly and in window). An expense that is BOTH monthly and dated landed
    // in both, so the headline total counted a ₪50 premium twice while the
    // itemised breakdown — which used `||` — listed it once. The total and the
    // explanation of the total disagreed, on the one surface this product
    // exists to provide. One deduped set now feeds both.
    const monthExpenses = input.expenses.filter(
      (e) => (e.frequency === 'monthly' && inWindow(e)) || e.dueDate?.startsWith(month),
    );
    const expenseTotal = monthExpenses.reduce(
      (sum: Agorot, e) => addAgorot(sum, money(e.amount)),
      ZERO_AGOROT,
    );
    const scenarioSalary =
      input.scenario?.salaryChange && month >= input.scenario.salaryChange.effectiveMonth
        ? input.scenario.salaryChange.amount
        : safeBase;
    const scenarioItems = [
      ...(input.scenario?.insuranceRenewal?.month === month
        ? [
            {
              id: 'scenario_insurance',
              label: 'Insurance renewal scenario',
              amount: input.scenario.insuranceRenewal.amount,
            },
          ]
        : []),
      ...(input.scenario?.oneTimeExpense?.month === month
        ? [
            {
              id: 'scenario_one_time',
              label: input.scenario.oneTimeExpense.label,
              amount: input.scenario.oneTimeExpense.amount,
            },
          ]
        : []),
    ];
    const scenarioTotal = scenarioItems.reduce(
      (sum: Agorot, item) => addAgorot(sum, money(item.amount)),
      ZERO_AGOROT,
    );
    // DOM-06. The salary line is what an actual or entered payroll REPLACES —
    // not the month. Before this, a month with a closed payroll had its total
    // set to the payroll amount alone while `known` on the same row still
    // reported the month's ₪500 insurance renewal: the row contradicted itself,
    // and the expense vanished from the annual total and from the reserve
    // recommendation. Salary, expenses and scenario items are now three
    // independent terms, and the total is their sum in every branch.
    const salaryComponent = actual
      ? {
          id: actual.sourceId,
          label: 'Closed payroll',
          amount: actual.amount,
          source: 'closed_payroll',
          explanation: 'Canonical closed payroll record',
          status: 'ACTUAL' as const,
        }
      : entered
        ? {
            id: entered.sourceId,
            label: 'Entered payroll',
            amount: entered.amount,
            source: 'payroll_entry',
            explanation: 'Canonical payroll entry for an open month',
            status: 'ACTUAL' as const,
          }
        : input.baseSalary === undefined
          ? {
              id: 'salary_unknown',
              label: 'Salary',
              amount: null,
              source: 'salary_configuration',
              explanation: 'No current salary is stored',
              status: 'UNKNOWN' as const,
            }
          : {
              id: 'base_salary',
              label: 'Salary',
              amount: scenarioSalary,
              source:
                input.scenario?.salaryChange && month >= input.scenario.salaryChange.effectiveMonth
                  ? 'planning_scenario'
                  : 'salary_configuration',
              explanation: 'Current configured salary; repeated without statutory assumptions',
              status: 'FORECAST' as const,
            };
    const components = [
      salaryComponent,
      ...monthExpenses.map((e) => ({
        id: e.id,
        label: e.label,
        amount: e.amount,
        source: e.source ?? 'employment_expense',
        explanation:
          e.source === 'planning_scenario'
            ? 'Planning-only value; canonical records are unchanged'
            : e.frequency === 'monthly'
              ? 'Stored recurring employment cost'
              : 'Stored dated employment cost',
        status: 'FORECAST' as const,
      })),
      ...scenarioItems.map((item) => ({
        ...item,
        source: 'planning_scenario',
        explanation: 'Planning-only value; canonical records are unchanged',
        status: 'FORECAST' as const,
      })),
    ];
    const payrollAgorot = actual
      ? money(actual.amount)
      : entered
        ? money(entered.amount)
        : ZERO_AGOROT;
    const projectedSalary = actual || entered ? ZERO_AGOROT : money(scenarioSalary);
    // `known` carries every non-salary cost the month is expected to incur —
    // recurring and dated alike, deduped — so that `total = actual + projected
    // + known` holds identically and the components list sums to the headline.
    const known = addAgorot(expenseTotal, scenarioTotal);
    return {
      month,
      actual: shekelsOf(payrollAgorot),
      known: shekelsOf(known),
      projected: shekelsOf(projectedSalary),
      total: shekelsOf(addAgorot(payrollAgorot, projectedSalary, known)),
      status: actual || entered ? ('ACTUAL' as const) : ('FORECAST' as const),
      components,
    };
  });
  const totalAgorot = months.reduce(
    (sum: Agorot, month) => addAgorot(sum, money(month.total)),
    ZERO_AGOROT,
  );
  const total = shekelsOf(totalAgorot);
  return {
    months,
    total,
    next3MonthsTotal: shekelsOf(
      months
        .slice(0, 3)
        .reduce((sum: Agorot, month) => addAgorot(sum, money(month.total)), ZERO_AGOROT),
    ),
    average: shekelsOf(scaleAgorot(totalAgorot, 1 / 12)),
    reserveRecommendation: shekelsOf(scaleAgorot(totalAgorot, 1 / 12)),
    guidance: 'planning_guidance_not_financial_advice' as const,
    unknowns: input.baseSalary === undefined ? ['base_salary'] : [],
    assumptions: [
      ...(safeBase
        ? [
            {
              id: 'base_salary',
              label: 'Current entered base salary repeats monthly',
              amount: safeBase,
            },
          ]
        : []),
      ...input.expenses
        .filter((e) => e.frequency === 'monthly')
        .map((e) => ({ id: e.id, label: `${e.label} repeats monthly`, amount: e.amount })),
    ],
  };
}
