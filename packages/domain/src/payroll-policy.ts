import { israelDate } from './date.js';
import {
  addAgorot,
  agorotFromShekels,
  scaleAgorot,
  shekelsOf,
  subtractAgorot,
  MoneyError,
  ZERO_AGOROT,
  type Agorot,
} from './money.js';
import { calculateMonthlyPayroll, type PayrollComponents } from './payroll.js';
import {
  isRestDay,
  isWeeklyRestDay,
  prorateMonthlySalary,
  type WeeklyRestDay,
} from './proration.js';

export type PayrollDayKind =
  | 'rest_worked'
  | 'holiday_worked'
  | 'holiday_unworked'
  | 'vacation_paid'
  | 'vacation_redemption'
  | 'sick'
  | 'unpaid_absence';
export type PayrollDeductionCategory = 'medical' | 'housing' | 'agreed' | 'other';
interface PayrollRecordedDayCounters {
  paidHolidays: number;
  vacationDays: number;
  sickDays: number;
  otherAbsenceDays: number;
}
export type PayrollRuleConfiguration =
  | { kind: 'proration'; convention: 'exclude_rest_days_from_both_terms' }
  | {
      kind: 'day';
      purpose: PayrollDayKind;
      treatment: 'included_in_base' | 'addition' | 'base_reduction';
      dailyRate: number;
      overlap: 'exclusive' | 'stack';
      priority: number;
      episodeRates?: readonly { throughDay: number | null; multiplier: number }[];
    }
  | {
      kind: 'deduction';
      category: PayrollDeductionCategory;
      maximum: number;
      actualCostFraction: number;
      consentRequired: boolean;
    }
  | { kind: 'carry'; allowSignedCarry: boolean };

/** Supplied by the authenticated server resolver, never trusted from an HTTP body. */
export interface VerifiedPayrollRule {
  id: string;
  code: string;
  version: number;
  status: 'active';
  effectiveFrom: string;
  effectiveTo?: string | null;
  sourceReference: string;
  sourceVerifiedAt: string;
  reviewedBy: string;
  approvedAt: string;
  config: PayrollRuleConfiguration;
}

export interface PayrollCalculationContext {
  schemaVersion: 1;
  restDay?: WeeklyRestDay;
  salaryPeriods?: readonly { from: string; to: string; monthlySalary: number; ruleId: string }[];
  dayFacts?: readonly {
    id: string;
    date: string;
    kind: PayrollDayKind;
    quantity: number;
    ruleId: string;
    episodeId?: string;
    episodeStart?: string;
  }[];
  deductionItems?: readonly {
    id: string;
    category: PayrollDeductionCategory;
    amount: number;
    actualCost: number;
    consent: boolean;
    ruleId: string;
  }[];
  paymentEvents?: readonly {
    id: string;
    date: string;
    appliesToMonth: string;
    kind: 'advance' | 'pocket_money';
    amount: number;
  }[];
  openingBalance?: {
    sourceMonth: string;
    amount: number;
    reference: string;
    sourceVersion: number;
    ruleId: string;
  };
}

export class PayrollPolicyError extends Error {
  constructor(
    readonly code:
      | 'invalid_context'
      | 'money_precision'
      | 'rule_unavailable'
      | 'rule_mismatch'
      | 'duplicate_event'
      | 'overlapping_periods'
      | 'ambiguous_overlap'
      | 'deduction_not_permitted',
    readonly field: string,
  ) {
    super(`${code}: ${field}`);
    this.name = 'PayrollPolicyError';
  }
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONEY_FIELDS = [
  'baseSalary',
  'restDayRate',
  'holidayPay',
  'vacationPay',
  'sickPay',
  'employerContributions',
  'pocketMoney',
  'deductions',
  'advances',
  'agreedDeductions',
  'total',
  'otherAddition',
  'medicalInsuranceDeduction',
  'housingDeduction',
  'agreedDeduction',
  'saturdayRate',
] as const;

export function assertPayrollMoneyAmount(value: number, field: string, signed = false): void {
  if (!Number.isFinite(value) || (!signed && value < 0))
    throw new PayrollPolicyError('invalid_context', field);
  // Compare decimal digits, not amount*100: ordinary two-decimal binary floats
  // such as 0.29 need not have an integer product with 100.
  const decimal = String(value);
  const [, fraction = ''] = decimal.split('.');
  if (/[eE]/.test(decimal) ? value !== 0 : fraction.length > 2)
    throw new PayrollPolicyError('money_precision', field);
  try {
    agorotFromShekels(value);
  } catch (error) {
    if (error instanceof MoneyError) throw new PayrollPolicyError('invalid_context', field);
    throw error;
  }
}

/** HTTP edge guard; derived products may still round a half-agora exactly once. */
export function assertPayrollMoneyPrecision(input: unknown): void {
  if (!input || typeof input !== 'object')
    throw new PayrollPolicyError('invalid_context', 'payroll');
  const record = input as Record<string, unknown>;
  for (const field of MONEY_FIELDS) {
    if (record[field] !== undefined) {
      if (typeof record[field] !== 'number') throw new PayrollPolicyError('invalid_context', field);
      assertPayrollMoneyAmount(record[field] as number, field, field === 'total');
    }
  }
  if (record.additionalPayments !== undefined) {
    if (!Array.isArray(record.additionalPayments))
      throw new PayrollPolicyError('invalid_context', 'additionalPayments');
    record.additionalPayments.forEach((payment: unknown, index) => {
      const amount = (payment as { amount?: unknown } | null)?.amount;
      if (typeof amount !== 'number')
        throw new PayrollPolicyError('invalid_context', `additionalPayments.${index}.amount`);
      assertPayrollMoneyAmount(amount, `additionalPayments.${index}.amount`);
    });
  }
}

export interface PayrollSettlementBreakdown {
  payableToWorker: number;
  openingBalance: number;
  closingWorkerBalance: number;
  wageBeforePriorPayments: number;
  previouslyPaid: number;
  employerContributions: number;
  employmentCost: number;
}

/** Prior payments settle wages; they do not erase the cost already incurred. */
export function derivePayrollSettlement(
  components: PayrollComponents,
  openingBalance = 0,
): PayrollSettlementBreakdown {
  assertPayrollMoneyAmount(openingBalance, 'openingBalance.amount', true);
  const totals = calculateMonthlyPayroll(components);
  const previouslyPaid = addAgorot(
    agorotFromShekels(components.advances),
    agorotFromShekels(components.pocketMoney),
  );
  const wages = addAgorot(agorotFromShekels(totals.payableToWorker), previouslyPaid);
  return {
    payableToWorker: totals.payableToWorker,
    openingBalance,
    closingWorkerBalance: shekelsOf(
      addAgorot(agorotFromShekels(totals.payableToWorker), agorotFromShekels(openingBalance)),
    ),
    wageBeforePriorPayments: shekelsOf(wages),
    previouslyPaid: shekelsOf(previouslyPaid),
    employerContributions: components.employerContributions,
    employmentCost: shekelsOf(
      addAgorot(wages, agorotFromShekels(components.employerContributions)),
    ),
  };
}

function validDate(value: string, field: string): string {
  try {
    return israelDate(value);
  } catch {
    throw new PayrollPolicyError('invalid_context', field);
  }
}
function dateDay(value: string): number {
  return Date.parse(`${value}T00:00:00Z`) / 86_400_000;
}
function nonempty(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** No context means the existing manually entered monetary components remain authoritative. */
function deriveApprovedPayrollComponentsUnchecked<
  T extends PayrollComponents & Partial<PayrollRecordedDayCounters>,
>(
  input: T,
  context: PayrollCalculationContext | undefined,
  month: string,
  verifiedRules: readonly VerifiedPayrollRule[],
): { components: T; ruleIds: string[]; settlement: PayrollSettlementBreakdown } {
  assertPayrollMoneyPrecision(input);
  if (!MONTH.test(month)) throw new PayrollPolicyError('invalid_context', 'month');
  const components = { ...input };
  if (!context) return { components, ruleIds: [], settlement: derivePayrollSettlement(components) };
  if (
    context.schemaVersion !== 1 ||
    (context.restDay !== undefined && !isWeeklyRestDay(context.restDay))
  )
    throw new PayrollPolicyError('invalid_context', 'calculationContext');
  const used = new Set<string>();
  const ruleMap = new Map<string, VerifiedPayrollRule>();
  for (const rule of verifiedRules) {
    if (ruleMap.has(rule.id)) throw new PayrollPolicyError('rule_unavailable', rule.id);
    ruleMap.set(rule.id, rule);
  }
  const ruleAt = (id: string, date: string) => {
    const rule = ruleMap.get(id);
    if (
      !rule ||
      rule.status !== 'active' ||
      !nonempty(rule.sourceReference) ||
      !nonempty(rule.reviewedBy) ||
      !nonempty(rule.code) ||
      !Number.isInteger(rule.version) ||
      rule.version < 1 ||
      !Number.isFinite(Date.parse(rule.sourceVerifiedAt)) ||
      !Number.isFinite(Date.parse(rule.approvedAt)) ||
      Date.parse(rule.approvedAt) < Date.parse(rule.sourceVerifiedAt)
    )
      throw new PayrollPolicyError('rule_unavailable', id);
    validDate(rule.effectiveFrom, 'rule.effectiveFrom');
    if (rule.effectiveTo) validDate(rule.effectiveTo, 'rule.effectiveTo');
    if (date < rule.effectiveFrom || (rule.effectiveTo != null && date > rule.effectiveTo))
      throw new PayrollPolicyError('rule_unavailable', id);
    used.add(id);
    return rule.config;
  };
  const inMonth = (date: string, field: string) => {
    validDate(date, field);
    if (!date.startsWith(`${month}-`)) throw new PayrollPolicyError('invalid_context', field);
  };
  if (context.salaryPeriods !== undefined) {
    if (!context.salaryPeriods.length || context.restDay === undefined)
      throw new PayrollPolicyError('invalid_context', 'salaryPeriods');
    let amount = ZERO_AGOROT;
    const periods = [...context.salaryPeriods].sort((a, b) => a.from.localeCompare(b.from));
    const monthStart = `${month}-01`;
    const monthEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
      .toISOString()
      .slice(0, 10);
    let previousEnd = '';
    for (const period of periods) {
      validDate(period.from, 'salaryPeriods.from');
      validDate(period.to, 'salaryPeriods.to');
      if (period.from > period.to)
        throw new PayrollPolicyError('invalid_context', 'salaryPeriods.to');
      assertPayrollMoneyAmount(period.monthlySalary, 'salaryPeriods.monthlySalary');
      const from = period.from < monthStart ? monthStart : period.from;
      const to = period.to > monthEnd ? monthEnd : period.to;
      if (from > to) continue;
      if (from <= previousEnd) throw new PayrollPolicyError('overlapping_periods', 'salaryPeriods');
      previousEnd = to;
      const config = ruleAt(period.ruleId, from);
      ruleAt(period.ruleId, to);
      if (config.kind !== 'proration' || config.convention !== 'exclude_rest_days_from_both_terms')
        throw new PayrollPolicyError('rule_mismatch', period.ruleId);
      amount = addAgorot(
        amount,
        prorateMonthlySalary({
          fullSalary: agorotFromShekels(period.monthlySalary),
          from: israelDate(from),
          to: israelDate(to),
          restDay: context.restDay,
        }).amount,
      );
    }
    components.baseSalary = shekelsOf(amount);
  }
  if (context.dayFacts !== undefined) {
    const byDate = new Map<
      string,
      {
        fact: NonNullable<PayrollCalculationContext['dayFacts']>[number];
        config: Extract<PayrollRuleConfiguration, { kind: 'day' }>;
      }[]
    >();
    const ids = new Map<string, string>();
    for (const fact of context.dayFacts) {
      if (
        !nonempty(fact.id) ||
        !Number.isFinite(fact.quantity) ||
        fact.quantity <= 0 ||
        fact.quantity > 1 ||
        /[eE]/.test(String(fact.quantity)) ||
        (String(fact.quantity).split('.')[1]?.length ?? 0) > 2
      )
        throw new PayrollPolicyError('invalid_context', 'dayFacts');
      inMonth(fact.date, 'dayFacts.date');
      if (
        context.salaryPeriods !== undefined &&
        !context.salaryPeriods.some((period) => period.from <= fact.date && fact.date <= period.to)
      )
        throw new PayrollPolicyError('invalid_context', 'dayFacts.outsideEmploymentPeriod');
      const serialized = JSON.stringify(fact);
      if (ids.has(fact.id)) {
        if (ids.get(fact.id) === serialized) continue;
        throw new PayrollPolicyError('duplicate_event', fact.id);
      }
      ids.set(fact.id, serialized);
      const config = ruleAt(fact.ruleId, fact.date);
      if (
        config.kind !== 'day' ||
        config.purpose !== fact.kind ||
        !Number.isFinite(config.priority) ||
        !['exclusive', 'stack'].includes(config.overlap)
      )
        throw new PayrollPolicyError('rule_mismatch', fact.ruleId);
      assertPayrollMoneyAmount(config.dailyRate, 'rule.dailyRate');
      if (
        fact.kind === 'rest_worked' &&
        (context.restDay === undefined || !isRestDay(israelDate(fact.date), context.restDay))
      )
        throw new PayrollPolicyError('invalid_context', 'dayFacts.rest_worked');
      const group = byDate.get(fact.date) ?? [];
      group.push({ fact, config });
      byDate.set(fact.date, group);
    }
    let holiday = ZERO_AGOROT;
    let vacation = ZERO_AGOROT;
    let sick = ZERO_AGOROT;
    let reduction = ZERO_AGOROT;
    let restDayHundredths = 0;
    let holidayDayHundredths = 0;
    let vacationDayHundredths = 0;
    let sickDayHundredths = 0;
    let absenceDayHundredths = 0;
    let restRate: number | undefined;
    const episodes = new Map<string, string>();
    for (const items of byDate.values()) {
      const stacking = items.filter((item) => item.config.overlap === 'stack');
      const exclusive = items
        .filter((item) => item.config.overlap === 'exclusive')
        .sort((a, b) => b.config.priority - a.config.priority || b.fact.quantity - a.fact.quantity);
      const winner = exclusive[0];
      if (
        winner &&
        exclusive.some(
          (item) =>
            item !== winner &&
            item.config.priority === winner.config.priority &&
            (item.fact.kind !== winner.fact.kind || item.fact.ruleId !== winner.fact.ruleId),
        )
      )
        throw new PayrollPolicyError('ambiguous_overlap', winner.fact.date);
      const selected = [...stacking, ...(winner ? [winner] : [])];
      // Even stackable events cannot contain the same purpose twice on a date.
      const purposes = new Set<string>();
      for (const { fact, config } of selected) {
        if (purposes.has(fact.kind)) throw new PayrollPolicyError('ambiguous_overlap', fact.date);
        purposes.add(fact.kind);
        const quantityHundredths = Math.round(fact.quantity * 100);
        // These are recorded day facts, including a zero-paid illness day.
        // Redemption is money for prior leave, not leave taken this month;
        // the historic holiday counter names holidays actually worked.
        if (fact.kind === 'holiday_worked') holidayDayHundredths += quantityHundredths;
        else if (fact.kind === 'vacation_paid') vacationDayHundredths += quantityHundredths;
        else if (fact.kind === 'sick') sickDayHundredths += quantityHundredths;
        else if (fact.kind === 'unpaid_absence') absenceDayHundredths += quantityHundredths;
        let multiplier = 1;
        if (fact.kind === 'sick') {
          if (!nonempty(fact.episodeId) || !fact.episodeStart || !config.episodeRates?.length)
            throw new PayrollPolicyError('invalid_context', 'dayFacts.episode');
          validDate(fact.episodeStart, 'dayFacts.episodeStart');
          const priorStart = episodes.get(fact.episodeId!);
          if (priorStart !== undefined && priorStart !== fact.episodeStart)
            throw new PayrollPolicyError('invalid_context', 'dayFacts.episodeStart');
          episodes.set(fact.episodeId!, fact.episodeStart);
          const ordinal = dateDay(fact.date) - dateDay(fact.episodeStart) + 1;
          if (ordinal < 1) throw new PayrollPolicyError('invalid_context', 'dayFacts.episodeStart');
          let last = 0;
          for (const [index, band] of config.episodeRates.entries()) {
            if (
              !Number.isFinite(band.multiplier) ||
              band.multiplier < 0 ||
              (band.throughDay === null && index !== config.episodeRates.length - 1) ||
              (band.throughDay !== null &&
                (!Number.isInteger(band.throughDay) || band.throughDay <= last))
            )
              throw new PayrollPolicyError('rule_mismatch', fact.ruleId);
            if (band.throughDay !== null) last = band.throughDay;
          }
          for (const band of config.episodeRates) {
            if (band.throughDay === null || ordinal <= band.throughDay) {
              multiplier = band.multiplier;
              break;
            }
            if (band === config.episodeRates.at(-1))
              throw new PayrollPolicyError('rule_unavailable', fact.ruleId);
          }
        }
        if (config.treatment === 'included_in_base') continue;
        const amount = scaleAgorot(agorotFromShekels(config.dailyRate), fact.quantity * multiplier);
        if (config.treatment === 'base_reduction') {
          reduction = addAgorot(reduction, amount);
          continue;
        }
        if (config.treatment !== 'addition')
          throw new PayrollPolicyError('rule_mismatch', fact.ruleId);
        if (fact.kind === 'rest_worked') {
          if (restRate !== undefined && restRate !== config.dailyRate)
            throw new PayrollPolicyError('rule_mismatch', 'dayFacts.mixedRestRates');
          restRate = config.dailyRate;
          restDayHundredths += Math.round(fact.quantity * 100);
        } else if (fact.kind.startsWith('holiday_')) holiday = addAgorot(holiday, amount);
        else if (fact.kind.startsWith('vacation_')) vacation = addAgorot(vacation, amount);
        else if (fact.kind === 'sick') sick = addAgorot(sick, amount);
        else throw new PayrollPolicyError('rule_mismatch', fact.ruleId);
      }
    }
    const base = subtractAgorot(agorotFromShekels(components.baseSalary), reduction);
    // Re-saving a derived row must not subtract the same absence a second time.
    // An explicit salary source is required whenever a policy reduces the base.
    if (reduction !== 0 && context.salaryPeriods === undefined)
      throw new PayrollPolicyError('invalid_context', 'salaryPeriods.requiredForBaseReduction');
    if (base < 0) throw new PayrollPolicyError('invalid_context', 'baseSalary.afterAbsence');
    if (holidayDayHundredths > 1000)
      throw new PayrollPolicyError('invalid_context', 'dayFacts.paidHolidays');
    components.baseSalary = shekelsOf(base);
    components.paidRestDays = restDayHundredths / 100;
    components.restDayRate = restRate ?? 0;
    components.holidayPay = shekelsOf(holiday);
    components.vacationPay = shekelsOf(vacation);
    components.sickPay = shekelsOf(sick);
    components.paidHolidays = holidayDayHundredths / 100;
    components.vacationDays = vacationDayHundredths / 100;
    components.sickDays = sickDayHundredths / 100;
    components.otherAbsenceDays = absenceDayHundredths / 100;
  }
  if (context.deductionItems !== undefined) {
    const ids = new Set<string>();
    const categorySums = new Map<string, Agorot>();
    const categoryRules = new Map<string, string>();
    let general = ZERO_AGOROT;
    let agreed = ZERO_AGOROT;
    for (const item of context.deductionItems) {
      if (!nonempty(item.id) || ids.has(item.id))
        throw new PayrollPolicyError('duplicate_event', item.id);
      ids.add(item.id);
      assertPayrollMoneyAmount(item.amount, 'deductionItems.amount');
      assertPayrollMoneyAmount(item.actualCost, 'deductionItems.actualCost');
      const config = ruleAt(item.ruleId, `${month}-01`);
      if (config.kind !== 'deduction' || config.category !== item.category)
        throw new PayrollPolicyError('rule_mismatch', item.ruleId);
      assertPayrollMoneyAmount(config.maximum, 'rule.maximum');
      if (
        !Number.isFinite(config.actualCostFraction) ||
        config.actualCostFraction < 0 ||
        config.actualCostFraction > 1 ||
        (config.consentRequired && item.consent !== true)
      )
        throw new PayrollPolicyError('deduction_not_permitted', item.id);
      const amount = agorotFromShekels(item.amount);
      const categoryKey = item.category;
      if (categoryRules.has(categoryKey) && categoryRules.get(categoryKey) !== item.ruleId)
        throw new PayrollPolicyError('rule_mismatch', 'deductionItems.mixedCategoryRules');
      categoryRules.set(categoryKey, item.ruleId);
      const categorySum = addAgorot(categorySums.get(categoryKey) ?? ZERO_AGOROT, amount);
      categorySums.set(categoryKey, categorySum);
      if (
        categorySum > agorotFromShekels(config.maximum) ||
        amount > scaleAgorot(agorotFromShekels(item.actualCost), config.actualCostFraction)
      )
        throw new PayrollPolicyError('deduction_not_permitted', item.id);
      if (item.category === 'agreed') agreed = addAgorot(agreed, amount);
      else general = addAgorot(general, amount);
    }
    components.deductions = shekelsOf(general);
    components.agreedDeductions = shekelsOf(agreed);
  }
  if (context.paymentEvents !== undefined) {
    const ids = new Set<string>();
    let advances = ZERO_AGOROT;
    let pocket = ZERO_AGOROT;
    for (const event of context.paymentEvents) {
      if (!nonempty(event.id) || ids.has(event.id))
        throw new PayrollPolicyError('duplicate_event', event.id);
      ids.add(event.id);
      validDate(event.date, 'paymentEvents.date');
      if (event.appliesToMonth !== month)
        throw new PayrollPolicyError('invalid_context', 'paymentEvents.appliesToMonth');
      assertPayrollMoneyAmount(event.amount, 'paymentEvents.amount');
      if (event.kind === 'advance') advances = addAgorot(advances, agorotFromShekels(event.amount));
      else if (event.kind === 'pocket_money')
        pocket = addAgorot(pocket, agorotFromShekels(event.amount));
      else throw new PayrollPolicyError('invalid_context', 'paymentEvents.kind');
    }
    components.advances = shekelsOf(advances);
    components.pocketMoney = shekelsOf(pocket);
  }
  const carry = context.openingBalance;
  if (carry) {
    if (
      !MONTH.test(carry.sourceMonth) ||
      carry.sourceMonth >= month ||
      !nonempty(carry.reference) ||
      !Number.isInteger(carry.sourceVersion) ||
      carry.sourceVersion < 1
    )
      throw new PayrollPolicyError('invalid_context', 'openingBalance');
    assertPayrollMoneyAmount(carry.amount, 'openingBalance.amount', true);
    const config = ruleAt(carry.ruleId, `${month}-01`);
    if (config.kind !== 'carry' || config.allowSignedCarry !== true)
      throw new PayrollPolicyError('rule_mismatch', carry.ruleId);
  }
  return {
    components,
    ruleIds: [...used].sort(),
    settlement: derivePayrollSettlement(components, carry?.amount ?? 0),
  };
}

export function deriveApprovedPayrollComponents<
  T extends PayrollComponents & Partial<PayrollRecordedDayCounters>,
>(
  input: T,
  context: PayrollCalculationContext | undefined,
  month: string,
  verifiedRules: readonly VerifiedPayrollRule[],
): { components: T; ruleIds: string[]; settlement: PayrollSettlementBreakdown } {
  try {
    return deriveApprovedPayrollComponentsUnchecked(input, context, month, verifiedRules);
  } catch (error) {
    if (error instanceof MoneyError)
      throw new PayrollPolicyError('invalid_context', 'calculationContext.money_range');
    throw error;
  }
}
