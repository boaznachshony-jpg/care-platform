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
function utcDay(value: string | Date): number {
  const date = typeof value === 'string' ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : value;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / DAY;
}

/** A deterministic projection: callers must pass the tenant, case and clock explicitly. */
export function projectComplianceTimeline(input: {
  tenantId: string;
  caseId: string;
  today: string;
  facts: readonly AttentionFact[];
}): ComplianceTimelineItem[] {
  const today = utcDay(input.today);
  const endOfMonth = new Date(`${input.today.slice(0, 10)}T00:00:00Z`);
  endOfMonth.setUTCMonth(endOfMonth.getUTCMonth() + 1, 0);
  const monthEndDay = utcDay(endOfMonth);
  const seen = new Set<string>();
  return input.facts
    .filter((fact) => fact.tenantId === input.tenantId && fact.caseId === input.caseId)
    .filter((fact) => fact.status === 'open')
    .filter((fact) => !seen.has(fact.id) && Boolean(seen.add(fact.id)))
    .map((fact) => {
      const daysUntilDue = utcDay(fact.dueDate) - today;
      const group: TimelineGroup =
        daysUntilDue < 0
          ? 'overdue'
          : daysUntilDue === 0
            ? 'today'
            : daysUntilDue <= 7
              ? 'this_week'
              : utcDay(fact.dueDate) <= monthEndDay
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

export function projectPayrollAnalytics(records: readonly PayrollFact[], year: string) {
  const months = records
    .filter((record) => record.month.startsWith(`${year}-`))
    .sort((a, b) => a.month.localeCompare(b.month));
  let cumulative = 0;
  const trend = months.map((record) => ({ ...record, cumulative: (cumulative += record.total) }));
  const total = trend.at(-1)?.cumulative ?? 0;
  return {
    trend,
    total,
    average: months.length ? total / months.length : 0,
    highest: months.length ? months.reduce((a, b) => (a.total >= b.total ? a : b)) : null,
    lowest: months.length ? months.reduce((a, b) => (a.total <= b.total ? a : b)) : null,
    previousMonthChange: months.length > 1 ? months.at(-1)!.total - months.at(-2)!.total : null,
    hasOpenMonth: months.some((record) => !record.closed),
  };
}

export interface ForecastExpense {
  id: string;
  label: string;
  amount: number;
  frequency: 'monthly' | 'quarterly' | 'annual' | 'one_time';
  dueDate?: string;
}
export function projectFutureCost(input: {
  startMonth: string;
  baseSalary?: number;
  expenses: readonly ForecastExpense[];
}) {
  const start = new Date(`${input.startMonth}-01T00:00:00Z`);
  const safeBase =
    Number.isFinite(input.baseSalary) && (input.baseSalary ?? 0) >= 0 ? input.baseSalary! : 0;
  const months = Array.from({ length: 12 }, (_, offset) => {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + offset, 1));
    const month = date.toISOString().slice(0, 7);
    const known = input.expenses
      .filter((e) => e.dueDate?.startsWith(month))
      .reduce((sum, e) => sum + e.amount, 0);
    const recurring = input.expenses
      .filter((e) => e.frequency === 'monthly')
      .reduce((sum, e) => sum + e.amount, 0);
    return { month, known, projected: safeBase + recurring, total: known + safeBase + recurring };
  });
  const total = months.reduce((sum, month) => sum + month.total, 0);
  return {
    months,
    total,
    average: total / 12,
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
