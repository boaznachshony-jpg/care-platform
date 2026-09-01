/* eslint-disable no-restricted-syntax */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { PayrollComponentError } from '@caredesk/domain';
import { useMvpProfile } from '../hooks/use-mvp-profile.js';
import { useClientPath } from '../hooks/use-client-path.js';
import { calculateMonthlyPayroll, calculateProratedBaseSalary } from '../payroll-calculation.js';
import { createAnnualPayrollReport, getPayrollYears } from '../payroll-report.js';
import { quarterlyInsuranceScheduleForPayrollMonth } from '../quarterly-national-insurance.js';
import {
  readMvpEmploymentExpenses,
  readMvpPayroll,
  saveMvpEmploymentExpenses,
  saveMvpPayroll,
  type EmploymentExpenseFrequency,
  type MvpAdditionalPayment,
  type MvpEmploymentExpense,
  type MvpPayrollRecord,
} from '../storage/mvp-storage.js';
import { PayrollIntelligence } from '../components/PayrollIntelligence.js';
import { ValueOrigin, ValueOriginLegend } from '../components/ValueOrigin.js';
import {
  clearFormDraft,
  readFormDraft,
  saveFormDraft,
  DraftStorageError,
} from '../storage/form-draft-store.js';
import { formatDateTime, toIsoAttribute } from '../format-timestamp.js';

const currentMonth = new Date().toISOString().slice(0, 7);
const money = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' });
const percent = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 });
const MAX_PAYROLL_AMOUNT = 10_000_000;
const MAX_PAID_SATURDAYS = 6;
const MAX_PAID_HOLIDAYS = 10;

/** The employment expense category that opens the national insurance calculator. */
export const NATIONAL_INSURANCE_CATEGORY = 'ביטוח לאומי';

/**
 * Index order matters: position 0 is month 01. The names themselves live in the
 * translation resources so the reporting table reads in the interface language.
 */
export const MONTH_NAME_KEYS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

/**
 * Starting value, in percent, for the national insurance rate field.
 *
 * This is the ONLY place the number appears. The rate is published by the
 * National Insurance Institute, changes from time to time and differs between
 * cases, so the field itself stays editable and the product never treats this
 * constant as authoritative. When the published rate changes, change it here.
 */
export const DEFAULT_NATIONAL_INSURANCE_RATE_PERCENT = 3.6;

/** Rounds to agorot and keeps binary floating point artifacts off the screen. */
function roundMoney(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function positiveAmount(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? (value as number) : 0;
}

function shiftMonth(month: string, offset: number): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) return '';
  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + offset;
  if (index < 0) return '';
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/**
 * The payroll months whose wages a national insurance payment covers.
 *
 * The payment is always made in the month AFTER the wage period it reports on
 * (a Q3 payment falls due on 15 October), so the period is anchored on the
 * month before the due date rather than on the due date itself.
 */
export function nationalInsuranceWageMonths(
  frequency: EmploymentExpenseFrequency,
  dueDate: string,
): string[] {
  const dueMonth = /^\d{4}-(0[1-9]|1[0-2])/.test(dueDate) ? dueDate.slice(0, 7) : currentMonth;
  const lastMonth = shiftMonth(dueMonth, -1);
  if (!lastMonth) return [];
  if (frequency === 'quarterly') {
    const monthNumber = Number(lastMonth.slice(5, 7));
    const quarterStart = `${lastMonth.slice(0, 4)}-${String(Math.floor((monthNumber - 1) / 3) * 3 + 1).padStart(2, '0')}`;
    return [0, 1, 2].map((offset) => shiftMonth(quarterStart, offset)).filter(Boolean);
  }
  if (frequency === 'annual') {
    return Array.from({ length: 12 }, (_, index) => shiftMonth(lastMonth, index - 11)).filter(
      Boolean,
    );
  }
  return [lastMonth];
}

/**
 * The gross wage a saved payroll month recorded for the caregiver: the base
 * salary actually paid plus every wage addition. Employer contributions are
 * excluded because they are not the caregiver's wage, and deductions are not
 * subtracted because the wage was earned before them.
 */
export function recordedGrossWage(record: MvpPayrollRecord): number {
  const additionalPayments = (record.additionalPayments ?? []).reduce(
    (total, payment) => total + positiveAmount(payment.amount),
    0,
  );
  return roundMoney(
    positiveAmount(record.baseSalary) +
      positiveAmount(record.saturdayPay) +
      positiveAmount(record.holidayPay) +
      positiveAmount(record.vacationPay) +
      positiveAmount(record.sickPay) +
      positiveAmount(record.otherAddition) +
      additionalPayments,
  );
}

/** base x rate, in shekels, rounded to agorot. Never returns NaN. */
export function nationalInsuranceAmount(wageBase: number, ratePercent: number): number {
  if (!Number.isFinite(wageBase) || !Number.isFinite(ratePercent)) return 0;
  if (wageBase <= 0 || ratePercent <= 0) return 0;
  return roundMoney((wageBase * ratePercent) / 100);
}

/**
 * What the customer changed on one month's line. Absent keys mean "keep
 * following the derived value", so re-deriving the period never discards a
 * correction and a correction never freezes the rest of the line.
 */
export interface NationalInsuranceMonthOverride {
  employed?: boolean;
  /** Whole shekels, kept as text so an emptied field stays empty. */
  wage?: string;
  rate?: string;
}

export interface NationalInsuranceMonthRow {
  month: string;
  /** The reporting line is closed for a month that has not happened yet. */
  isFuture: boolean;
  employed: boolean;
  /** Text in the field. */
  wageValue: string;
  rateValue: string;
  /** Whole shekels — the Institute's form is "ללא אגורות". */
  wage: number;
  ratePercent: number;
  /** wage x rate, to agorot. */
  amount: number;
  wageSource: 'payroll-records' | 'contract-base-salary' | 'none';
}

export interface NationalInsuranceTotals {
  wages: number;
  amount: number;
}

/**
 * One line per month of the reporting period, in the shape of the National
 * Insurance Institute's own form.
 *
 * The wage of each month comes from that month's saved payroll record; where
 * no record exists the contract base salary stands in, and where neither
 * exists the line starts empty rather than guessing. Every line stays
 * editable, which is why the derived value is only a starting point.
 *
 * `today` is a parameter and not `currentMonth` directly so that the rule
 * "a later month cannot be reported" is testable without a clock.
 */
export function nationalInsuranceMonthRows(
  records: MvpPayrollRecord[],
  months: string[],
  contractBaseSalary: number | null,
  sharedRatePercent: string,
  overrides: Record<string, NationalInsuranceMonthOverride>,
  today: string = currentMonth,
): NationalInsuranceMonthRow[] {
  return months.map((month) => {
    const isFuture = month > today;
    const override = overrides[month] ?? {};
    const record = records.find((item) => item.month === month);
    const derivedWage = record
      ? Math.round(recordedGrossWage(record))
      : Math.round(positiveAmount(contractBaseSalary ?? 0));
    const wageSource = record
      ? 'payroll-records'
      : derivedWage > 0
        ? 'contract-base-salary'
        : 'none';
    const wageValue = override.wage ?? (derivedWage > 0 ? String(derivedWage) : '');
    const rateValue = override.rate ?? sharedRatePercent;
    // A future month is reported as "לא" and cannot be switched back on.
    const employed = isFuture ? false : (override.employed ?? true);
    const wage = employed ? Math.round(numeric(wageValue)) : 0;
    const ratePercent = numeric(rateValue);
    return {
      month,
      isFuture,
      employed,
      wageValue,
      rateValue,
      wage,
      ratePercent,
      amount: employed ? nationalInsuranceAmount(wage, ratePercent) : 0,
      wageSource,
    };
  });
}

/**
 * The two summary lines of the form. The total to pay is the sum of the
 * per-month figures already shown, not a recomputation from the wage total,
 * so what the customer adds up on screen is what the field says.
 */
export function nationalInsuranceTotals(
  rows: NationalInsuranceMonthRow[],
): NationalInsuranceTotals {
  let wages = 0;
  let amount = 0;
  for (const row of rows) {
    wages += row.wage;
    amount += row.amount;
  }
  return { wages: Math.round(wages), amount: roundMoney(amount) };
}

/** "2026-07" -> "יולי 2026", using the month names the form itself prints. */
export function hebrewMonthLabel(month: string, monthNames: string[]): string {
  const index = Number(month.slice(5, 7)) - 1;
  const name = monthNames[index];
  return name ? `${name} ${month.slice(0, 4)}` : month;
}

interface PayrollSequenceState {
  startMonth: string;
  endMonth: string;
  pendingMonths: string[];
  skippedMonths: string[];
  addedMonths: string[];
}

export function monthsInRange(startMonth: string, endMonth: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(startMonth) || !/^\d{4}-\d{2}$/.test(endMonth) || startMonth > endMonth)
    return [];
  const result: string[] = [];
  let year = Number(startMonth.slice(0, 4));
  let month = Number(startMonth.slice(5, 7));
  const endYear = Number(endMonth.slice(0, 4));
  const endMonthNumber = Number(endMonth.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonthNumber)) {
    result.push(`${year}-${String(month).padStart(2, '0')}`);
    if (++month === 13) {
      month = 1;
      year += 1;
    }
  }
  return result;
}

interface AdditionalPaymentDraft {
  id: string;
  description: string;
  amount: string;
}

function newAdditionalPaymentDraft(): AdditionalPaymentDraft {
  return { id: crypto.randomUUID(), description: '', amount: '' };
}

function additionalPaymentDrafts(record: MvpPayrollRecord | undefined): AdditionalPaymentDraft[] {
  return (record?.additionalPayments ?? []).map((payment) => ({
    id: payment.id,
    description: payment.description,
    amount: String(payment.amount),
  }));
}

function numeric(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function payrollValues(
  record: MvpPayrollRecord | undefined,
  baseSalary: number | null,
  profileSaturdayRate: number | null,
) {
  const saturdayRate =
    record?.saturdayRate ??
    (record?.paidSaturdays
      ? (record.saturdayPay ?? 0) / record.paidSaturdays
      : (profileSaturdayRate ?? 0));

  return {
    month: record?.month ?? currentMonth,
    baseSalary: String(record?.contractBaseSalary ?? record?.baseSalary ?? baseSalary ?? ''),
    prorationStartDate: record?.prorationStartDate ?? '',
    workDays: String(record?.workDays ?? 0),
    vacationDays: String(record?.vacationDays ?? 0),
    sickDays: String(record?.sickDays ?? 0),
    absenceDays: String(record?.absenceDays ?? 0),
    paidSaturdays: String(record?.paidSaturdays ?? 0),
    saturdayRate: String(saturdayRate),
    paidHolidays: String(record?.paidHolidays ?? 0),
    holidayPay: String(record?.holidayPay ?? 0),
    vacationPay: String(record?.vacationPay ?? 0),
    sickPay: String(record?.sickPay ?? 0),
    pocketMoney: String(record?.pocketMoney ?? 0),
    employerContributions: String(record?.employerContributions ?? 0),
    otherAddition: String(record?.otherAddition ?? 0),
    medicalInsuranceDeduction: String(record?.medicalInsuranceDeduction ?? 0),
    housingDeduction: String(record?.housingDeduction ?? 0),
    advances: String(record?.advances ?? 0),
    agreedDeduction: String(record?.agreedDeduction ?? 0),
  };
}

export function nextSequencePayrollValues(month: string, baseSalary: string, saturdayRate: string) {
  return {
    ...payrollValues(undefined, numeric(baseSalary), numeric(saturdayRate)),
    month,
  };
}

function recordSaturdayRate(record: MvpPayrollRecord): number {
  return (
    record.saturdayRate ??
    (record.paidSaturdays ? (record.saturdayPay ?? 0) / record.paidSaturdays : 0)
  );
}

function withNationalInsuranceTracking(
  expenses: MvpEmploymentExpense[],
  payrollMonth: string,
): MvpEmploymentExpense[] {
  const schedule = quarterlyInsuranceScheduleForPayrollMonth(payrollMonth);
  if (!schedule) return expenses;

  const sourcePeriod = `${schedule.year}-Q${schedule.quarter}`;
  const id = `expense-${schedule.id}`;
  const existing = expenses.find(
    (expense) => expense.id === id || expense.sourcePeriod === sourcePeriod,
  );
  const trackedExpense: MvpEmploymentExpense = {
    id: existing?.id ?? id,
    category: NATIONAL_INSURANCE_CATEGORY,
    frequency: 'quarterly',
    amount: existing?.amount ?? 0,
    amountEntered: existing?.amountEntered ?? false,
    dueDate: schedule.deadlineDate,
    status: existing?.status ?? 'upcoming',
    note:
      existing?.note ||
      `${schedule.periodRange} · ${schedule.paymentWindow} · נוצר אוטומטית משכר ${payrollMonth}`,
    savedAt: existing?.savedAt ?? new Date().toISOString(),
    source: 'payroll-national-insurance',
    sourcePeriod,
  };

  return existing
    ? expenses.map((expense) => (expense.id === existing.id ? trackedExpense : expense))
    : [trackedExpense, ...expenses];
}

/**
 * WEB-02 — the payroll wizard's draft.
 *
 * The five steps hold roughly twenty typed fields plus a repeatable
 * additional-payments list, and nothing was persisted until the final
 * "אישור ושמירה". Tapping "משימות" in the fixed mobile bottom nav unmounted
 * the page and every value was gone, silently. For the 50-60-year-old target
 * user on a phone that is a routine mis-tap, not an edge case.
 *
 * The draft lives in the `caredesk.draft.*` namespace (see
 * storage/form-draft-store.ts) and not in `caredesk.mvp.*`: ADR-006 clause 5
 * freezes the workspace payload, and a value stored there would in any case be
 * destroyed by the next server hydration.
 */
export const PAYROLL_WIZARD_DRAFT = 'payroll-wizard';

type PayrollWizardValues = ReturnType<typeof payrollValues>;

export interface PayrollWizardDraft {
  step: number;
  values: PayrollWizardValues;
  additionalPayments: AdditionalPaymentDraft[];
}

/**
 * The comparable form of everything the wizard holds. Used to decide whether
 * there is unsaved work: a draft identical to the stored record is not
 * unsaved work, and warning about it would train the user to dismiss the
 * warning that matters.
 */
export function payrollWizardSnapshot(
  values: PayrollWizardValues,
  additionalPayments: AdditionalPaymentDraft[],
): string {
  return JSON.stringify({
    values,
    additionalPayments: additionalPayments
      .map((payment) => ({
        description: payment.description.trim(),
        amount: payment.amount.trim(),
      }))
      .filter((payment) => payment.description !== '' || payment.amount !== ''),
  });
}

function isUsableDraft(draft: unknown): draft is PayrollWizardDraft {
  const candidate = draft as Partial<PayrollWizardDraft> | null;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof candidate.values === 'object' &&
    candidate.values !== null &&
    typeof (candidate.values as PayrollWizardValues).month === 'string' &&
    Array.isArray(candidate.additionalPayments)
  );
}

export function PayrollPage() {
  const { t } = useTranslation();
  const { clientId } = useParams<{ clientId: string }>();
  const path = useClientPath();
  const [profile, setProfile] = useMvpProfile();
  const [records, setRecords] = useState(readMvpPayroll);
  const [expenses, setExpenses] = useState(readMvpEmploymentExpenses);
  /**
   * WEB-02: read once, synchronously, before the first paint. Restoring in an
   * effect would flash the empty wizard and race the user's first keystroke.
   */
  const [restoredDraft] = useState(() => {
    const stored = readFormDraft<PayrollWizardDraft>(PAYROLL_WIZARD_DRAFT);
    return stored && isUsableDraft(stored.value)
      ? { savedAt: stored.savedAt, value: stored.value }
      : null;
  });
  const [step, setStep] = useState(() => {
    if (profile.baseSalary === null) return 0;
    const restoredStep = restoredDraft?.value.step;
    return typeof restoredStep === 'number' && restoredStep >= 1 && restoredStep <= 5
      ? restoredStep
      : 1;
  });
  const initialRecord = records.find(
    (record) => record.month === (restoredDraft?.value.values.month ?? currentMonth),
  );
  const [values, setValues] = useState(
    () =>
      restoredDraft?.value.values ??
      payrollValues(initialRecord, profile.baseSalary, profile.saturdayRate),
  );
  const [additionalPayments, setAdditionalPayments] = useState<AdditionalPaymentDraft[]>(
    () => restoredDraft?.value.additionalPayments ?? additionalPaymentDrafts(initialRecord),
  );
  const [draftStatus, setDraftStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [draftSavedAt, setDraftSavedAt] = useState(restoredDraft?.savedAt ?? '');
  const [draftRestoredNotice, setDraftRestoredNotice] = useState(Boolean(restoredDraft));
  const [expenseDraft, setExpenseDraft] = useState({
    category: NATIONAL_INSURANCE_CATEGORY,
    frequency: 'quarterly' as EmploymentExpenseFrequency,
    amount: '',
    dueDate: '',
    note: '',
  });
  const [insuranceRate, setInsuranceRate] = useState(
    String(DEFAULT_NATIONAL_INSURANCE_RATE_PERCENT),
  );
  /** Per-month corrections on the reporting table, keyed by "YYYY-MM". */
  const [insuranceMonthOverrides, setInsuranceMonthOverrides] = useState<
    Record<string, NationalInsuranceMonthOverride>
  >({});
  /** true means the customer typed an amount that replaces the computed one. */
  const [expenseAmountOverridden, setExpenseAmountOverridden] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [payrollSaved, setPayrollSaved] = useState(false);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [sequenceDraft, setSequenceDraft] = useState({
    startMonth: `${currentMonth.slice(0, 4)}-01`,
    endMonth: currentMonth,
  });
  const [sequence, setSequence] = useState<PayrollSequenceState | null>(null);
  const [sequenceSummary, setSequenceSummary] = useState<PayrollSequenceState | null>(null);

  /**
   * WEB-02 — what "unsaved" means here.
   *
   * The stored record for the month currently on screen, rendered in exactly
   * the shape the wizard holds. Anything else on screen is work the user has
   * done and the product has not committed.
   */
  const committedSnapshot = useMemo(() => {
    const record = records.find((item) => item.month === values.month);
    return payrollWizardSnapshot(
      { ...payrollValues(record, profile.baseSalary, profile.saturdayRate), month: values.month },
      additionalPaymentDrafts(record),
    );
  }, [records, values.month, profile.baseSalary, profile.saturdayRate]);
  const currentSnapshot = useMemo(
    () => payrollWizardSnapshot(values, additionalPayments),
    [values, additionalPayments],
  );
  const hasUnsavedWork = currentSnapshot !== committedSnapshot;
  /** Read inside the beforeunload listener, which must not be re-bound per keystroke. */
  const hasUnsavedWorkRef = useRef(hasUnsavedWork);
  hasUnsavedWorkRef.current = hasUnsavedWork;

  /**
   * Autosave. Debounced so typing a five-digit salary is one write, not five,
   * and cleared the moment the work is committed — a stale draft that
   * outlives its record is the WEB-15 failure in a different screen.
   */
  useEffect(() => {
    if (!hasUnsavedWork) {
      clearFormDraft(PAYROLL_WIZARD_DRAFT);
      setDraftStatus('idle');
      setDraftSavedAt('');
      return undefined;
    }
    setDraftStatus('saving');
    const timer = window.setTimeout(() => {
      const savedAt = new Date().toISOString();
      try {
        saveFormDraft<PayrollWizardDraft>(
          PAYROLL_WIZARD_DRAFT,
          { step, values, additionalPayments },
          savedAt,
        );
        setDraftStatus('saved');
        setDraftSavedAt(savedAt);
      } catch (error) {
        // WEB-06: a full or read-only store must surface as a message next to
        // the form, never as an uncaught throw that blanks the application.
        if (!(error instanceof DraftStorageError)) throw error;
        setDraftStatus('error');
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [hasUnsavedWork, step, values, additionalPayments]);

  /**
   * A reload or a tab close is the one navigation the draft alone cannot make
   * invisible, because the debounce may not have fired yet. React Router is
   * mounted here as a `BrowserRouter`, not a data router, so `useBlocker` is
   * unavailable; in-app navigation is covered by the draft surviving it.
   */
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedWorkRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  function discardDraft() {
    if (!window.confirm(t('payments.draftDiscardConfirm'))) return;
    const record = records.find((item) => item.month === values.month);
    setValues({
      ...payrollValues(record, profile.baseSalary, profile.saturdayRate),
      month: values.month,
    });
    setAdditionalPayments(additionalPaymentDrafts(record));
    setDraftRestoredNotice(false);
    setValidationErrors([]);
    clearFormDraft(PAYROLL_WIZARD_DRAFT);
  }

  const validationTerms: Partial<Record<keyof typeof values, string[]>> = {
    month: ['חודש שכר'],
    baseSalary: ['שכר בסיס'],
    prorationStartDate: ['תאריך תחילת'],
    workDays: ['ימי עבודה'],
    vacationDays: ['ימי חופשה'],
    sickDays: ['ימי מחלה'],
    absenceDays: ['ימי היעדרות'],
    paidSaturdays: ['שבתות בתשלום'],
    saturdayRate: ['תעריף שבת'],
    paidHolidays: ['ימי חג'],
    holidayPay: ['תשלום ימי חג'],
    vacationPay: ['תשלום חופשה'],
    sickPay: ['תשלום מחלה'],
    employerContributions: ['הפרשות מעסיק'],
    otherAddition: ['תוספת אחרת'],
    pocketMoney: ['דמי כיס'],
    medicalInsuranceDeduction: ['ניכוי ביטוח רפואי'],
    housingDeduction: ['ניכוי מגורים'],
    advances: ['מקדמות'],
    agreedDeduction: ['ניכוי מוסכם'],
  };

  function validationErrorFor(key: keyof typeof values): string | undefined {
    const terms = validationTerms[key] ?? [];
    return validationErrors.find((error) => terms.some((term) => error.includes(term)));
  }

  function invalidFieldProps(key: keyof typeof values) {
    const error = validationErrorFor(key);
    return {
      'aria-invalid': error ? true : undefined,
      'aria-describedby': error ? `payroll-${key}-error` : undefined,
      className: error ? 'field-input-error' : undefined,
    };
  }

  function fieldErrorMessage(key: keyof typeof values) {
    const error = validationErrorFor(key);
    return error ? (
      <small className="field-error-message" id={`payroll-${key}-error`}>
        {error}
      </small>
    ) : null;
  }
  const payrollYears = useMemo(() => getPayrollYears(records), [records]);
  const [reportYear, setReportYear] = useState(() => payrollYears[0] ?? currentMonth.slice(0, 4));
  const annualReport = useMemo(
    () => createAnnualPayrollReport(records, reportYear),
    [records, reportYear],
  );
  const proratedBaseSalary = useMemo(
    () =>
      calculateProratedBaseSalary(
        numeric(values.baseSalary),
        values.month,
        values.prorationStartDate,
      ),
    [values.baseSalary, values.month, values.prorationStartDate],
  );
  const additionalPaymentsTotal = useMemo(
    () => additionalPayments.reduce((total, payment) => total + numeric(payment.amount), 0),
    [additionalPayments],
  );

  const calculation = useMemo(() => {
    try {
      return calculateMonthlyPayroll({
        baseSalary: proratedBaseSalary.amount,
        paidSaturdays: numeric(values.paidSaturdays),
        saturdayRate: numeric(values.saturdayRate),
        holidayPay: numeric(values.holidayPay),
        vacationPay: numeric(values.vacationPay),
        sickPay: numeric(values.sickPay),
        pocketMoney: numeric(values.pocketMoney),
        employerContributions: numeric(values.employerContributions),
        otherAddition: numeric(values.otherAddition) + additionalPaymentsTotal,
        medicalInsuranceDeduction: numeric(values.medicalInsuranceDeduction),
        housingDeduction: numeric(values.housingDeduction),
        advances: numeric(values.advances),
        agreedDeduction: numeric(values.agreedDeduction),
      });
    } catch (error) {
      // Root 8: the domain refuses a component outside 0 … MAX_PAYROLL_AMOUNT,
      // and every field on this wizard is a text input the user is still
      // typing into. "10000001" is a value in transit, not a crash: without
      // this catch the throw escapes render and React 18 unmounts the whole
      // page, so the one screen that could name the offending field is the
      // screen that disappears.
      //
      // Zeroes rather than the last good total, because a stale number
      // presented as the current one is the failure this preview exists to
      // prevent. Nothing here can be saved while it is wrong: validateStep()
      // reports the same fields by name and blocks both the step and the save.
      // Same shape as CanonicalPayrollIntelligence's null total (DOM-07),
      // which cannot be used here because 14 render sites read this value.
      if (error instanceof PayrollComponentError) {
        return { saturdayPay: 0, additions: 0, deductions: 0, total: 0 };
      }
      throw error;
    }
  }, [additionalPaymentsTotal, proratedBaseSalary.amount, values]);
  const otherAdditions = Math.max(0, calculation.additions - calculation.saturdayPay);
  const standardOtherAdditions = Math.max(0, otherAdditions - additionalPaymentsTotal);
  const beforeDeductions = proratedBaseSalary.amount + calculation.additions;
  const deductionBreakdown = [
    numeric(values.pocketMoney) > 0 ? `דמי כיס ${money.format(numeric(values.pocketMoney))}` : '',
    numeric(values.medicalInsuranceDeduction) > 0
      ? `ביטוח רפואי ${money.format(numeric(values.medicalInsuranceDeduction))}`
      : '',
    numeric(values.housingDeduction) > 0
      ? `מגורים ${money.format(numeric(values.housingDeduction))}`
      : '',
    numeric(values.advances) > 0 ? `מקדמות ${money.format(numeric(values.advances))}` : '',
    numeric(values.agreedDeduction) > 0
      ? `ניכוי מוסכם ${money.format(numeric(values.agreedDeduction))}`
      : '',
  ].filter(Boolean);
  const deductionBreakdownEnglish = [
    numeric(values.pocketMoney) > 0
      ? `Pocket money ${money.format(numeric(values.pocketMoney))}`
      : '',
    numeric(values.medicalInsuranceDeduction) > 0
      ? `Medical insurance ${money.format(numeric(values.medicalInsuranceDeduction))}`
      : '',
    numeric(values.housingDeduction) > 0
      ? `Housing ${money.format(numeric(values.housingDeduction))}`
      : '',
    numeric(values.advances) > 0 ? `Advances ${money.format(numeric(values.advances))}` : '',
    numeric(values.agreedDeduction) > 0
      ? `Agreed deduction ${money.format(numeric(values.agreedDeduction))}`
      : '',
  ].filter(Boolean);

  const isNationalInsuranceExpense = expenseDraft.category === NATIONAL_INSURANCE_CATEGORY;
  const insuranceWageMonths = useMemo(
    () => nationalInsuranceWageMonths(expenseDraft.frequency, expenseDraft.dueDate),
    [expenseDraft.frequency, expenseDraft.dueDate],
  );
  const insuranceMonthNames = useMemo(
    () => MONTH_NAME_KEYS.map((key) => t(`payments.monthNames.${key}`)),
    [t],
  );
  const insuranceMonthRows = useMemo(
    () =>
      nationalInsuranceMonthRows(
        records,
        insuranceWageMonths,
        profile.baseSalary,
        insuranceRate,
        insuranceMonthOverrides,
      ),
    [records, insuranceWageMonths, profile.baseSalary, insuranceRate, insuranceMonthOverrides],
  );
  const insuranceTotals = useMemo(
    () => nationalInsuranceTotals(insuranceMonthRows),
    [insuranceMonthRows],
  );
  const computedInsuranceAmount = insuranceTotals.amount;
  const computedInsuranceAmountValue =
    computedInsuranceAmount > 0 ? String(computedInsuranceAmount) : '';
  /**
   * The single source of truth for the amount field and for the saved record:
   * the computed figure while the calculator is driving it, the customer's own
   * text as soon as they type over it.
   */
  const expenseAmountValue =
    isNationalInsuranceExpense && !expenseAmountOverridden
      ? computedInsuranceAmountValue
      : expenseDraft.amount;
  const monthsFromPayrollRecords = insuranceMonthRows
    .filter((row) => row.wageSource === 'payroll-records')
    .map((row) => row.month);
  const monthsFromContractSalary = insuranceMonthRows
    .filter((row) => row.wageSource === 'contract-base-salary')
    .map((row) => row.month);
  const wageSourceNotes = [
    monthsFromPayrollRecords.length > 0
      ? t('payments.insuranceTable.wageFromPayroll', {
          months: monthsFromPayrollRecords.join(', '),
        })
      : '',
    monthsFromContractSalary.length > 0
      ? t('payments.insuranceTable.wageFromContract', {
          months: monthsFromContractSalary.join(', '),
        })
      : '',
    insuranceMonthRows.length > 0 && insuranceMonthRows.every((row) => row.wageSource === 'none')
      ? t('payments.insuranceTable.wageMissing')
      : '',
  ].filter(Boolean);

  function updateInsuranceMonth(month: string, change: NationalInsuranceMonthOverride) {
    setInsuranceMonthOverrides((current) => ({
      ...current,
      [month]: { ...current[month], ...change },
    }));
    setExpenseAmountOverridden(false);
  }

  function update(key: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setMessage('');
    setValidationErrors([]);
    setPayrollSaved(false);
  }

  function updateAdditionalPayment(id: string, field: 'description' | 'amount', value: string) {
    setAdditionalPayments((current) =>
      current.map((payment) => (payment.id === id ? { ...payment, [field]: value } : payment)),
    );
    setMessage('');
    setValidationErrors([]);
    setPayrollSaved(false);
  }

  function addAdditionalPayment() {
    setAdditionalPayments((current) => [...current, newAdditionalPaymentDraft()]);
    setValidationErrors([]);
    setPayrollSaved(false);
  }

  function removeAdditionalPayment(id: string) {
    setAdditionalPayments((current) => current.filter((payment) => payment.id !== id));
    setValidationErrors([]);
    setPayrollSaved(false);
  }

  function validateStep(stepToValidate: number): string[] {
    const errors: string[] = [];
    const validateAmount = (value: string, label: string, positive = false) => {
      const parsed = Number(value);
      if (
        value.trim() === '' ||
        !Number.isFinite(parsed) ||
        parsed < (positive ? Number.EPSILON : 0) ||
        parsed > MAX_PAYROLL_AMOUNT
      ) {
        errors.push(
          positive
            ? `${label}: יש להזין סכום גדול מאפס ועד ${MAX_PAYROLL_AMOUNT.toLocaleString('he-IL')}.`
            : `${label}: יש להזין סכום בין 0 ל־${MAX_PAYROLL_AMOUNT.toLocaleString('he-IL')}.`,
        );
      }
    };
    const validateDays = (value: string, label: string, maximum: number, increment: number) => {
      const parsed = Number(value);
      const isValidIncrement =
        Number.isFinite(parsed) &&
        Math.abs(parsed / increment - Math.round(parsed / increment)) < 1e-9;
      if (
        value.trim() === '' ||
        !Number.isFinite(parsed) ||
        parsed < 0 ||
        parsed > maximum ||
        !isValidIncrement
      ) {
        errors.push(`${label}: יש להזין ערך בין 0 ל־${maximum} בקפיצות של ${increment}.`);
      }
    };

    if (stepToValidate === 1 && !/^\d{4}-\d{2}$/.test(values.month)) {
      errors.push('יש לבחור חודש שכר תקין.');
    }
    if (stepToValidate === 2) {
      const daysInMonth = proratedBaseSalary.calendarDaysInMonth || 31;
      validateAmount(values.baseSalary, 'שכר בסיס', true);
      validateDays(values.workDays, 'ימי עבודה', daysInMonth, 1);
      validateDays(values.vacationDays, 'ימי חופשה', daysInMonth, 0.5);
      validateDays(values.sickDays, 'ימי מחלה', daysInMonth, 0.5);
      validateDays(values.absenceDays, 'ימי היעדרות', daysInMonth, 0.5);
      validateDays(values.paidSaturdays, 'שבתות בתשלום', MAX_PAID_SATURDAYS, 1);
      validateAmount(values.saturdayRate, 'תעריף שבת');
      validateDays(values.paidHolidays, 'ימי חג', MAX_PAID_HOLIDAYS, 1);
      if (
        values.prorationStartDate &&
        (values.prorationStartDate < `${values.month}-01` ||
          values.prorationStartDate > `${values.month}-${String(daysInMonth).padStart(2, '0')}`)
      ) {
        errors.push('תאריך תחילת העבודה חייב להיות בתוך חודש השכר.');
      }
    }
    if (stepToValidate === 3) {
      (
        [
          ['holidayPay', 'תשלום ימי חג'],
          ['vacationPay', 'תשלום חופשה'],
          ['sickPay', 'תשלום מחלה'],
          ['employerContributions', 'הפרשות מעסיק'],
          ['otherAddition', 'תוספת אחרת'],
        ] as const
      ).forEach(([key, label]) => validateAmount(values[key as keyof typeof values], label));
      additionalPayments.forEach((payment, index) => {
        const hasDescription = payment.description.trim().length > 0;
        const hasAmount = payment.amount.trim().length > 0;
        if (!hasDescription && !hasAmount) return;
        if (!hasDescription) errors.push(`תשלום נוסף ${index + 1}: יש להזין תיאור.`);
        validateAmount(payment.amount, `תשלום נוסף ${index + 1}`);
      });
    }
    if (stepToValidate === 4) {
      (
        [
          ['pocketMoney', 'דמי כיס'],
          ['medicalInsuranceDeduction', 'ניכוי ביטוח רפואי'],
          ['housingDeduction', 'ניכוי מגורים'],
          ['advances', 'מקדמות'],
          ['agreedDeduction', 'ניכוי מוסכם'],
        ] as const
      ).forEach(([key, label]) => validateAmount(values[key as keyof typeof values], label));
    }
    return errors;
  }

  function goForward() {
    const errors = validateStep(step);
    setValidationErrors(errors);
    if (errors.length === 0) {
      setStep((value) => Math.min(5, value + 1));
      return;
    }
    window.setTimeout(() => {
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }, 0);
  }

  function loadMonth(month: string, confirmDiscard = true) {
    // WEB-02(b)(c): changing the month input, or "עריכת החודש" in the annual
    // history, used to overwrite every typed value with no warning at all.
    if (confirmDiscard && hasUnsavedWork && !window.confirm(t('payments.draftSwitchMonthConfirm')))
      return;
    const record = records.find((item) => item.month === month);
    setDraftRestoredNotice(false);
    setValues({ ...payrollValues(record, profile.baseSalary, profile.saturdayRate), month });
    setAdditionalPayments(additionalPaymentDrafts(record));
    setValidationErrors([]);
    setPayrollSaved(false);
    setMessage(record ? 'הרישום השמור נטען לעריכה.' : 'נפתח רישום חדש לחודש שנבחר.');
  }

  function startPayrollSequence() {
    const months = monthsInRange(sequenceDraft.startMonth, sequenceDraft.endMonth);
    if (months.length === 0 || sequenceDraft.endMonth > currentMonth) {
      setMessage('יש לבחור טווח חודשים תקין שאינו מסתיים בעתיד.');
      return;
    }
    const existingMonths = new Set(records.map((record) => record.month));
    const nextSequence: PayrollSequenceState = {
      ...sequenceDraft,
      pendingMonths: months.filter((month) => !existingMonths.has(month)),
      skippedMonths: months.filter((month) => existingMonths.has(month)),
      addedMonths: [],
    };
    setSequenceSummary(null);
    const firstMissingMonth = nextSequence.pendingMonths[0];
    if (!firstMissingMonth) {
      setSequence(null);
      setSequenceSummary(nextSequence);
      setMessage('כל החודשים בטווח כבר קיימים ולכן לא בוצע שינוי.');
      return;
    }
    setSequence(nextSequence);
    loadMonth(firstMissingMonth);
    setStep(1);
    setMessage(`נפתח החודש החסר הראשון, ${firstMissingMonth}. חודשים קיימים יסומנו וידולגו.`);
  }

  function saveSalarySettings(event: React.FormEvent) {
    event.preventDefault();
    const baseSalary = numeric(values.baseSalary);
    if (baseSalary <= 0 || !profile.salaryEffectiveDate) {
      setMessage('יש להזין שכר בסיס ותאריך תחולה.');
      return;
    }
    setProfile({ ...profile, baseSalary, salaryEffectiveDate: profile.salaryEffectiveDate });
    setMessage('הגדרת השכר נשמרה. מקור השכר: נתוני ההעסקה שהזין המשתמש.');
    setStep(1);
  }

  function savePayroll(continueSequence = false) {
    const errorsByStep = [1, 2, 3, 4].map((stepNumber) => ({
      stepNumber,
      errors: validateStep(stepNumber),
    }));
    const errors = errorsByStep.flatMap(({ errors: stepErrors }) => stepErrors);
    setValidationErrors(errors);
    if (errors.length > 0) {
      setPayrollSaved(false);
      setStep(
        errorsByStep.find(({ errors: stepErrors }) => stepErrors.length > 0)?.stepNumber ?? 1,
      );
      window.setTimeout(() => {
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      }, 0);
      return;
    }
    const existing = records.find((record) => record.month === values.month);
    if (sequence && existing) {
      setMessage(
        'החודש כבר קיים ולא נדרס. עריכת חודש קיים זמינה רק מפעולת העריכה המפורשת בהיסטוריה.',
      );
      return;
    }
    const savedAdditionalPayments: MvpAdditionalPayment[] = additionalPayments
      .filter((payment) => payment.description.trim() || numeric(payment.amount) > 0)
      .map((payment) => ({
        id: payment.id,
        description: payment.description.trim(),
        amount: numeric(payment.amount),
      }));
    const saved: MvpPayrollRecord = {
      id: existing?.id ?? crypto.randomUUID(),
      month: values.month,
      baseSalary: proratedBaseSalary.amount,
      contractBaseSalary: numeric(values.baseSalary),
      prorationStartDate: values.prorationStartDate || undefined,
      prorationDays: proratedBaseSalary.paidDays,
      workDays: numeric(values.workDays),
      vacationDays: numeric(values.vacationDays),
      sickDays: numeric(values.sickDays),
      absenceDays: numeric(values.absenceDays),
      paidSaturdays: numeric(values.paidSaturdays),
      saturdayRate: numeric(values.saturdayRate),
      paidHolidays: numeric(values.paidHolidays),
      saturdayPay: calculation.saturdayPay,
      holidayPay: numeric(values.holidayPay),
      vacationPay: numeric(values.vacationPay),
      sickPay: numeric(values.sickPay),
      pocketMoney: numeric(values.pocketMoney),
      employerContributions: numeric(values.employerContributions),
      otherAddition: numeric(values.otherAddition),
      additionalPayments: savedAdditionalPayments,
      medicalInsuranceDeduction: numeric(values.medicalInsuranceDeduction),
      housingDeduction: numeric(values.housingDeduction),
      advances: numeric(values.advances),
      agreedDeduction: numeric(values.agreedDeduction),
      total: calculation.total,
      // WEB-23: `canonicalVersion` is documented as the server optimistic-lock
      // version and was declared but never read or written, so every re-save
      // through this wizard dropped it. A record that silently loses its
      // version either gets rejected by the canonical write path or overwrites
      // server state unconditionally. Carry it forward.
      canonicalVersion: existing?.canonicalVersion,
      savedAt: new Date().toISOString(),
    };
    const next = records.some((record) => record.month === saved.month)
      ? records.map((record) => (record.month === saved.month ? saved : record))
      : [saved, ...records];
    const nextExpenses = withNationalInsuranceTracking(expenses, saved.month);
    saveMvpPayroll(next);
    saveMvpEmploymentExpenses(nextExpenses);
    setRecords(next);
    setExpenses(nextExpenses);
    setReportYear(saved.month.slice(0, 4));
    // WEB-02: the work is committed, so the draft is no longer recoverable
    // work — it is a stale copy that could later be offered over newer data.
    clearFormDraft(PAYROLL_WIZARD_DRAFT);
    setDraftRestoredNotice(false);
    setDraftStatus('idle');
    setDraftSavedAt('');
    setMessage('רישום השכר החודשי נשמר. מעקב התשלום לביטוח לאומי הופעל לרבעון גם ללא סכום.');
    setPayrollSaved(true);
    if (sequence && continueSequence) {
      const addedMonths = sequence.addedMonths.includes(saved.month)
        ? sequence.addedMonths
        : [...sequence.addedMonths, saved.month];
      const nextMonth = sequence.pendingMonths.find(
        (month) => month > saved.month && !next.some((record) => record.month === month),
      );
      if (!nextMonth) {
        const completed = { ...sequence, addedMonths };
        setSequence(null);
        setSequenceSummary(completed);
        setStep(1);
        setMessage(
          `הרצף הושלם: ${addedMonths.length} חודשים נוספו ו-${sequence.skippedMonths.length} חודשים קיימים דולגו.`,
        );
        return;
      }
      setSequence({ ...sequence, addedMonths });
      setValues(nextSequencePayrollValues(nextMonth, values.baseSalary, values.saturdayRate));
      setAdditionalPayments([]);
      setValidationErrors([]);
      setPayrollSaved(false);
      setStep(1);
      setMessage(`חודש ${saved.month} נשמר. הועברת לחודש החסר הבא: ${nextMonth}.`);
    }
  }

  function saveExpense(event: React.FormEvent) {
    event.preventDefault();
    if (!expenseDraft.category || !expenseDraft.dueDate) {
      setMessage('יש לבחור סוג תשלום ותאריך יעד.');
      return;
    }
    const existingExpense = expenses.find((expense) => expense.id === editingExpenseId);
    const saved: MvpEmploymentExpense = {
      id: existingExpense?.id ?? crypto.randomUUID(),
      category: expenseDraft.category,
      frequency: expenseDraft.frequency,
      amount: numeric(expenseAmountValue),
      amountEntered: expenseAmountValue.trim() !== '',
      dueDate: expenseDraft.dueDate,
      status: existingExpense?.status ?? 'upcoming',
      note: expenseDraft.note,
      savedAt: existingExpense?.savedAt ?? new Date().toISOString(),
      source: existingExpense?.source,
      sourcePeriod: existingExpense?.sourcePeriod,
    };
    const next = existingExpense
      ? expenses.map((expense) => (expense.id === existingExpense.id ? saved : expense))
      : [saved, ...expenses];
    saveMvpEmploymentExpenses(next);
    setExpenses(next);
    setExpenseDraft((current) => ({ ...current, amount: '', dueDate: '', note: '' }));
    setInsuranceMonthOverrides({});
    setExpenseAmountOverridden(false);
    setEditingExpenseId(null);
    setMessage(
      existingExpense ? 'פרטי התשלום התקופתי עודכנו.' : 'התשלום התקופתי נשמר בלוח עלויות ההעסקה.',
    );
  }

  function editExpense(expense: MvpEmploymentExpense) {
    setExpenseDraft({
      category: expense.category,
      frequency: expense.frequency,
      amount: expense.amountEntered === false ? '' : String(expense.amount),
      dueDate: expense.dueDate,
      note: expense.note,
    });
    // A saved amount is the customer's figure and must not be overwritten by
    // the calculator; a tracking item with no amount yet is left to compute.
    setExpenseAmountOverridden(expense.amountEntered !== false);
    setInsuranceMonthOverrides({});
    setEditingExpenseId(expense.id);
    setMessage('עדכנו את הפרטים בטופס ושמרו.');
  }

  function toggleExpense(expense: MvpEmploymentExpense) {
    const next = expenses.map((item) =>
      item.id === expense.id
        ? { ...item, status: item.status === 'paid' ? ('upcoming' as const) : ('paid' as const) }
        : item,
    );
    saveMvpEmploymentExpenses(next);
    setExpenses(next);
  }

  function removeExpense(expense: MvpEmploymentExpense) {
    if (!window.confirm(`למחוק את התשלום "${expense.category}"?`)) return;
    const next = expenses.filter((item) => item.id !== expense.id);
    saveMvpEmploymentExpenses(next);
    setExpenses(next);
    setMessage('התשלום התקופתי נמחק.');
  }

  if (step === 0) {
    return (
      <div className="page-stack">
        <header className="page-header">
          <div>
            <p className="eyebrow">שכר</p>
            <h1>הגדרת מקור השכר</h1>
            <p>אין במערכת שכר מוגדר. הזינו את השכר שסוכם בהעסקה לפני פתיחת רישום חודשי.</p>
          </div>
          <span className="pill amber">טרם הוגדר</span>
        </header>
        {message ? (
          <p className="info-box" role="alert">
            {message}
          </p>
        ) : null}
        <form className="wizard-card readable-form wizard-content" onSubmit={saveSalarySettings}>
          <h2>נתוני ההעסקה</h2>
          <label>
            שכר בסיס חודשי בש״ח
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={values.baseSalary}
              onChange={(event) => update('baseSalary', event.target.value)}
            />
          </label>
          <label>
            בתוקף מתאריך
            <input
              type="date"
              required
              value={profile.salaryEffectiveDate}
              onChange={(event) =>
                setProfile({ ...profile, salaryEffectiveDate: event.target.value })
              }
            />
          </label>
          <p className="info-box">
            הסכום מגיע מהזנת המשתמש בלבד. המערכת אינה קובעת שכר חוקי ואינה מחליפה בדיקה מקצועית.
          </p>
          <button className="primary-button" type="submit">
            שמירת הגדרת השכר
          </button>
        </form>
      </div>
    );
  }

  const headings = [
    'בחירת חודש',
    'שכר בסיס ושבתות',
    'תוספות נוספות',
    'מקדמות וקיזוזים',
    'סיכום ואישור',
  ];
  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">שכר</p>
          <h1>רישום שכר חודשי</h1>
          <p>כל הסכומים מוזנים על ידי המשתמש, מסוכמים אריתמטית ונשמרים לפי חודש.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => setStep(0)}>
          עדכון שכר בסיס
        </button>
      </header>
      {message ? (
        <p className="info-box" role="status">
          {message}
        </p>
      ) : null}
      {validationErrors.length > 0 ? (
        <div className="info-box" role="alert" aria-live="assertive">
          <strong>יש לתקן את הנתונים לפני המשך התהליך:</strong>
          <ul>
            {validationErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <PayrollIntelligence
        records={records}
        expenses={expenses}
        baseSalary={profile.baseSalary}
        caseId={clientId}
      />
      <section className="card payroll-sequence-card" aria-labelledby="payroll-sequence-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">הזנה רטרואקטיבית</p>
            <h2 id="payroll-sequence-title">הוספת רצף חודשים</h2>
            <p>בחרו טווח. חודשים שכבר נשמרו לא יידרסו, אלא יסומנו וידולגו אוטומטית.</p>
          </div>
        </div>
        <div className="form-grid payroll-sequence-range">
          <label>
            חודש התחלה
            <input
              type="month"
              aria-label="חודש התחלה לרצף"
              max={currentMonth}
              value={sequenceDraft.startMonth}
              disabled={Boolean(sequence)}
              onChange={(event) =>
                setSequenceDraft((draft) => ({ ...draft, startMonth: event.target.value }))
              }
            />
          </label>
          <label>
            חודש סיום
            <input
              type="month"
              aria-label="חודש סיום לרצף"
              max={currentMonth}
              value={sequenceDraft.endMonth}
              disabled={Boolean(sequence)}
              onChange={(event) =>
                setSequenceDraft((draft) => ({ ...draft, endMonth: event.target.value }))
              }
            />
          </label>
        </div>
        {sequence ? (
          <div className="info-box payroll-sequence-progress" role="status">
            <strong>
              חודש {sequence.addedMonths.length + 1} מתוך {sequence.pendingMonths.length}
            </strong>
            <span>כעת מזינים: {values.month}</span>
            <span>{sequence.skippedMonths.length} חודשים קיימים ידולגו.</span>
          </div>
        ) : (
          <button className="primary-button" type="button" onClick={startPayrollSequence}>
            התחלת הזנת רצף
          </button>
        )}
        {sequenceSummary ? (
          <div className="success-box payroll-sequence-summary" role="status">
            <strong>סיכום הרצף</strong>
            <span>
              נוספו:{' '}
              {sequenceSummary.addedMonths.length
                ? sequenceSummary.addedMonths.join(', ')
                : 'לא נוספו חודשים'}
            </span>
            <span>
              דולגו כקיימים:{' '}
              {sequenceSummary.skippedMonths.length
                ? sequenceSummary.skippedMonths.join(', ')
                : 'לא דולגו חודשים'}
            </span>
          </div>
        ) : null}
      </section>
      <section className="wizard-card">
        <div className="steps">
          {['חודש', 'בסיס ושבתות', 'תוספות', 'קיזוזים', 'סיכום'].map((label, index) => (
            <div className={step >= index + 1 ? 'active' : ''} key={label}>
              <span>{step > index + 1 ? '✓' : index + 1}</span>
              <small>{label}</small>
            </div>
          ))}
        </div>
        <div className="wizard-content">
          <h2>{headings[step - 1]}</h2>
          {/* R5-01/R5-02. Steps 2-5 mix figures the user typed with figures the
              wizard derived from them, in the same typeface. The key is stated
              once, above them, so the reader meets the rule before acting on the
              numbers. Step 1 chooses a month and carries no amount. */}
          {step >= 2 ? <ValueOriginLegend kinds={['input', 'calculated']} /> : null}
          {/* WEB-02 / WEB-06: the wizard now says out loud whether the work on
              screen is recoverable. A failed draft write is shown as itself
              instead of being swallowed or crashing the page. */}
          {draftRestoredNotice && draftSavedAt ? (
            <p className="draft-status draft-status-restored" role="status">
              {t('payments.draftRestored', { savedAt: formatDateTime(draftSavedAt) })}
            </p>
          ) : null}
          {draftStatus === 'error' ? (
            <p className="draft-status draft-status-error" role="alert">
              {t('payments.draftSaveFailed')}
            </p>
          ) : draftStatus !== 'idle' ? (
            <p className="draft-status" role="status">
              {draftStatus === 'saving'
                ? t('payments.draftSaving')
                : t('payments.draftSaved', { savedAt: formatDateTime(draftSavedAt) })}
              <button className="link-button" type="button" onClick={discardDraft}>
                {t('payments.draftDiscard')}
              </button>
            </p>
          ) : null}
          {step === 1 ? (
            <label>
              חודש שכר
              <input
                type="month"
                aria-label="חודש שכר"
                value={values.month}
                disabled={Boolean(sequence)}
                onChange={(event) => loadMonth(event.target.value)}
              />
              {records.some((record) => record.month === values.month) ? (
                <small>קיים רישום שמור לחודש זה. המשך התהליך יעדכן אותו.</small>
              ) : (
                <small>עדיין לא נשמר רישום לחודש זה.</small>
              )}
            </label>
          ) : null}
          {step === 2 ? (
            <div className="form-grid">
              <label>
                שכר בסיס
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.baseSalary}
                  {...invalidFieldProps('baseSalary')}
                  onChange={(event) => update('baseSalary', event.target.value)}
                />
                {fieldErrorMessage('baseSalary')}
              </label>
              <label>
                תאריך תחילת עבודה בחודש, לחישוב יחסי
                <input
                  type="date"
                  min={`${values.month}-01`}
                  max={`${values.month}-${String(proratedBaseSalary.calendarDaysInMonth).padStart(2, '0')}`}
                  value={values.prorationStartDate}
                  aria-label="תאריך תחילת עבודה בחודש, לחישוב יחסי"
                  {...invalidFieldProps('prorationStartDate')}
                  onChange={(event) => update('prorationStartDate', event.target.value)}
                />
                {fieldErrorMessage('prorationStartDate')}
                <small>השאירו ריק כאשר העובד הועסק במשך כל החודש.</small>
              </label>
              <div className="payroll-live-total" aria-live="polite">
                <span>
                  שכר בסיס לחודש הנבחר
                  <small>
                    {proratedBaseSalary.isProrated
                      ? `${proratedBaseSalary.paidDays} מתוך ${proratedBaseSalary.daysInMonth} ימי בסיס`
                      : 'חודש מלא'}
                  </small>
                  {/* R5-02. Not the salary the user typed: the proration formula
                      stated below produced it. The source is named (R5-05) —
                      the inputs are user entry — and nothing else is claimed,
                      because the MVP payroll draft records no actor and no
                      calculation timestamp. */}
                  <ValueOrigin
                    kind="calculated"
                    provenance={{ source: t('valueOrigin.source.userEntry') }}
                  />
                </span>
                <strong>{money.format(proratedBaseSalary.amount)}</strong>
              </div>
              <p className="form-note">
                נוסחת החישוב: שכר הבסיס {money.format(numeric(values.baseSalary))} ×{' '}
                {proratedBaseSalary.paidDays} ימי בסיס לתשלום ÷ {proratedBaseSalary.daysInMonth} ימי
                בסיס בחודש = {money.format(proratedBaseSalary.amount)}. מהמכנה הוצאו{' '}
                {proratedBaseSalary.excludedSaturdays} שבתות, משום שתשלום שבתות מחושב בנפרד.
              </p>
              <label>
                ימי עבודה
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={values.workDays}
                  {...invalidFieldProps('workDays')}
                  onChange={(event) => update('workDays', event.target.value)}
                />
                {fieldErrorMessage('workDays')}
              </label>
              <label>
                ימי חופשה שנוצלו
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={values.vacationDays}
                  {...invalidFieldProps('vacationDays')}
                  onChange={(event) => update('vacationDays', event.target.value)}
                />
                {fieldErrorMessage('vacationDays')}
              </label>
              <label>
                ימי מחלה
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={values.sickDays}
                  {...invalidFieldProps('sickDays')}
                  onChange={(event) => update('sickDays', event.target.value)}
                />
                {fieldErrorMessage('sickDays')}
              </label>
              <label>
                ימי היעדרות אחרים
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={values.absenceDays}
                  {...invalidFieldProps('absenceDays')}
                  onChange={(event) => update('absenceDays', event.target.value)}
                />
                {fieldErrorMessage('absenceDays')}
              </label>
              <label>
                מספר שבתות או ימי מנוחה שעבדו
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={values.paidSaturdays}
                  {...invalidFieldProps('paidSaturdays')}
                  onChange={(event) => update('paidSaturdays', event.target.value)}
                />
                {fieldErrorMessage('paidSaturdays')}
              </label>
              <label>
                תעריף לכל שבת או יום מנוחה
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.saturdayRate}
                  {...invalidFieldProps('saturdayRate')}
                  onChange={(event) => update('saturdayRate', event.target.value)}
                />
                {fieldErrorMessage('saturdayRate')}
              </label>
              <div className="payroll-live-total" aria-live="polite">
                <span>
                  תוספת שבתות
                  <small>
                    {numeric(values.paidSaturdays)} × {money.format(numeric(values.saturdayRate))}
                  </small>
                  {/* R5-02. The count and the rate beside it are typed; their
                      product is not. */}
                  <ValueOrigin kind="calculated" />
                </span>
                <strong>{money.format(calculation.saturdayPay)}</strong>
              </div>
              {/* The Saturday figure is the first calculated amount in the wizard,
                  so the qualification is stated here rather than only at step 5. */}
              <p className="legal-note">{t('liability.calculation')}</p>
              <label>
                ימי חג שעבדו
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={values.paidHolidays}
                  {...invalidFieldProps('paidHolidays')}
                  onChange={(event) => update('paidHolidays', event.target.value)}
                />
                {fieldErrorMessage('paidHolidays')}
              </label>
              <p className="form-note">
                מקור שכר הבסיס: נתוני ההעסקה, בתוקף מ־{profile.salaryEffectiveDate}.
              </p>
            </div>
          ) : null}
          {step === 3 ? (
            <div className="form-grid">
              <label>
                תשלום ימי חג
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.holidayPay}
                  {...invalidFieldProps('holidayPay')}
                  onChange={(event) => update('holidayPay', event.target.value)}
                />
                {fieldErrorMessage('holidayPay')}
              </label>
              <label>
                תשלום חופשה
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.vacationPay}
                  {...invalidFieldProps('vacationPay')}
                  onChange={(event) => update('vacationPay', event.target.value)}
                />
                {fieldErrorMessage('vacationPay')}
              </label>
              <label>
                תשלום מחלה
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.sickPay}
                  {...invalidFieldProps('sickPay')}
                  onChange={(event) => update('sickPay', event.target.value)}
                />
                {fieldErrorMessage('sickPay')}
              </label>
              <label>
                הפרשות מעסיק: פנסיה ופיצויים
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.employerContributions}
                  {...invalidFieldProps('employerContributions')}
                  onChange={(event) => update('employerContributions', event.target.value)}
                />
                {fieldErrorMessage('employerContributions')}
              </label>
              <label>
                תוספת אחרת, אם קיימת
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.otherAddition}
                  {...invalidFieldProps('otherAddition')}
                  onChange={(event) => update('otherAddition', event.target.value)}
                />
                {fieldErrorMessage('otherAddition')}
              </label>
              <section
                className="additional-payments-editor"
                aria-labelledby="additional-payments-title"
              >
                <div className="section-heading">
                  <div>
                    <h3 id="additional-payments-title">תשלומים נוספים</h3>
                    <p>אפשר להוסיף כמה רכיבים, עם תיאור וסכום נפרד לכל תשלום.</p>
                  </div>
                  <button className="secondary-button" type="button" onClick={addAdditionalPayment}>
                    ＋ הוספת תשלום
                  </button>
                </div>
                {additionalPayments.length === 0 ? (
                  <p className="form-note">לא נוספו תשלומים נוספים לחודש זה.</p>
                ) : (
                  <div className="additional-payments-list">
                    {additionalPayments.map((payment, index) => {
                      const rowError = validationErrors.find((error) =>
                        error.includes(`תשלום נוסף ${index + 1}`),
                      );
                      return (
                        <div className="additional-payment-row" key={payment.id}>
                          <label>
                            תיאור תשלום נוסף {index + 1}
                            <input
                              value={payment.description}
                              maxLength={100}
                              aria-invalid={rowError ? true : undefined}
                              onChange={(event) =>
                                updateAdditionalPayment(
                                  payment.id,
                                  'description',
                                  event.target.value,
                                )
                              }
                            />
                          </label>
                          <label>
                            סכום תשלום נוסף {index + 1}
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={payment.amount}
                              aria-invalid={rowError ? true : undefined}
                              onChange={(event) =>
                                updateAdditionalPayment(payment.id, 'amount', event.target.value)
                              }
                            />
                          </label>
                          <button
                            className="danger-text-button"
                            type="button"
                            aria-label={`מחיקת תשלום נוסף ${index + 1}`}
                            onClick={() => removeAdditionalPayment(payment.id)}
                          >
                            מחיקה
                          </button>
                          {rowError ? (
                            <small className="field-error-message" role="alert">
                              {rowError}
                            </small>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
              <div className="payroll-live-total" aria-live="polite">
                <span>
                  כל התוספות לחודש, כולל שבתות
                  {/* R5-02. A sum of typed amounts is still a derivation: the
                      user never typed this figure. */}
                  <ValueOrigin kind="calculated" />
                </span>
                <strong>{money.format(calculation.additions)}</strong>
              </div>
            </div>
          ) : null}
          {step === 4 ? (
            <div className="form-grid">
              <label>
                דמי כיס שכבר שולמו
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.pocketMoney}
                  aria-label="דמי כיס שכבר שולמו"
                  {...invalidFieldProps('pocketMoney')}
                  onChange={(event) => update('pocketMoney', event.target.value)}
                />
                {fieldErrorMessage('pocketMoney')}
                <small>הסכום יוצג בנפרד ויקוזז מהתשלום שנותר החודש.</small>
              </label>
              <label>
                ניכוי ביטוח רפואי
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.medicalInsuranceDeduction}
                  {...invalidFieldProps('medicalInsuranceDeduction')}
                  onChange={(event) => update('medicalInsuranceDeduction', event.target.value)}
                />
                {fieldErrorMessage('medicalInsuranceDeduction')}
              </label>
              <label>
                ניכוי מגורים
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.housingDeduction}
                  {...invalidFieldProps('housingDeduction')}
                  onChange={(event) => update('housingDeduction', event.target.value)}
                />
                {fieldErrorMessage('housingDeduction')}
              </label>
              <label>
                מקדמות שכבר שולמו
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.advances}
                  aria-label="מקדמות שכבר שולמו"
                  {...invalidFieldProps('advances')}
                  onChange={(event) => update('advances', event.target.value)}
                />
                {fieldErrorMessage('advances')}
                <small>הסכום יקוזז מהתשלום הנותר החודש.</small>
              </label>
              <label>
                ניכוי מוסכם
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.agreedDeduction}
                  {...invalidFieldProps('agreedDeduction')}
                  onChange={(event) => update('agreedDeduction', event.target.value)}
                />
                {fieldErrorMessage('agreedDeduction')}
              </label>
              <div className="payroll-live-total deduction" aria-live="polite">
                <span>
                  סה״כ מקדמות וקיזוזים
                  {/* R5-02. */}
                  <ValueOrigin kind="calculated" />
                </span>
                <strong>−{money.format(calculation.deductions)}</strong>
              </div>
            </div>
          ) : null}
          {step === 5 ? (
            <>
              {/* R5-01..R5-04. The monthly summary is the screen the owner
                  prints and hands over, so it is the screen where an unmarked
                  number is most likely to be read as a payslip. Every line here
                  is now marked: the amounts the user typed as `input`, the ones
                  the wizard derived as `calculated`. Nothing on this screen is
                  `paid` — the month has not been closed yet, and saying "שולם"
                  before a payment date exists would be the exact confusion
                  R5-03 is meant to remove. */}
              <div className="pay-summary">
                <div>
                  <span>
                    שכר בסיס <small>נתוני העסקה</small>
                    <ValueOrigin
                      kind="calculated"
                      provenance={{ source: t('valueOrigin.source.userEntry') }}
                    />
                  </span>
                  <strong>{money.format(proratedBaseSalary.amount)}</strong>
                </div>
                <div>
                  <span>
                    שבתות וימי מנוחה
                    <small>
                      {numeric(values.paidSaturdays)} × {money.format(numeric(values.saturdayRate))}
                    </small>
                    <ValueOrigin kind="calculated" />
                  </span>
                  <strong>{money.format(calculation.saturdayPay)}</strong>
                </div>
                <div>
                  <span>
                    תוספות אחרות <small>לא כולל שבתות, המוצגות בשורה נפרדת</small>
                    <ValueOrigin kind="calculated" />
                  </span>
                  <strong>{money.format(standardOtherAdditions)}</strong>
                </div>
                {additionalPayments
                  .filter((payment) => payment.description.trim() || numeric(payment.amount) > 0)
                  .map((payment) => (
                    <div key={payment.id}>
                      <span>
                        תשלום נוסף <small>{payment.description || 'ללא תיאור'}</small>
                        {/* R5-01. This one really is just what the user typed,
                            line by line — CareDesk asserts nothing about it. */}
                        <ValueOrigin kind="input" />
                      </span>
                      <strong>{money.format(numeric(payment.amount))}</strong>
                    </div>
                  ))}
                <div className="payroll-subtotal">
                  <span>
                    סכום לפני קיזוזים
                    <ValueOrigin kind="calculated" />
                  </span>
                  <strong>{money.format(beforeDeductions)}</strong>
                </div>
                <div>
                  <span>
                    מקדמות וקיזוזים
                    <small>
                      {deductionBreakdown.length > 0
                        ? deductionBreakdown.join(' · ')
                        : 'לא הוזנו קיזוזים החודש'}
                    </small>
                    <ValueOrigin kind="calculated" />
                  </span>
                  <strong>−{money.format(calculation.deductions)}</strong>
                </div>
                <div className="total">
                  <span>
                    סה״כ לתשלום
                    <ValueOrigin kind="calculated" />
                  </span>
                  <strong>{money.format(calculation.total)}</strong>
                </div>
                <p>
                  זהו כלי רישום, תיעוד וסיכום אריתמטי בלבד. יש לאמת זכויות, ניכויים ותשלומים מול
                  גורם מקצועי.
                </p>
              </div>
              {printPreviewOpen ? (
                <div className="payroll-preview-heading" role="status">
                  <div>
                    <strong>תצוגה מקדימה לפני הדפסה</strong>
                    <span>זהו המסמך הדו־לשוני שיודפס או יישמר כ־PDF.</span>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setPrintPreviewOpen(false)}
                  >
                    סגירת תצוגה מקדימה
                  </button>
                </div>
              ) : null}
              <section
                className={`payroll-print-slip${printPreviewOpen ? ' payroll-print-preview' : ''}`}
                aria-label="ריכוז שכר חודשי להדפסה"
              >
                <header>
                  <div>
                    <strong>CareDesk</strong>
                    <h1>ריכוז שכר חודשי / Monthly pay summary</h1>
                  </div>
                  <span>חודש שכר / Pay month: {values.month}</span>
                </header>
                <p className="payroll-print-disclaimer">
                  מסמך תיעוד שהופק מהנתונים שהמשתמש הזין. אינו תלוש שכר רשמי ואינו מחליף בדיקה
                  מקצועית.
                  <br />
                  This record was generated from information entered by the user. It is not an
                  official payslip and does not replace professional review.
                </p>
                <div className="payroll-print-details">
                  <div>
                    <span>שם המעסיק / Employer name</span>
                    <strong>{profile.employerName || 'לא הוזן / Not provided'}</strong>
                  </div>
                  <div>
                    <span>מספר זהות מעסיק / Employer ID</span>
                    <strong>{profile.employerIdNumber || 'לא הוזן / Not provided'}</strong>
                  </div>
                  <div>
                    <span>שם המטופל/ת / Care recipient</span>
                    <strong>{profile.recipientName || 'לא הוזן / Not provided'}</strong>
                  </div>
                  <div>
                    <span>שם העובד/ת / Caregiver</span>
                    <strong>{profile.caregiverName || 'לא הוזן / Not provided'}</strong>
                  </div>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>רכיב / Component</th>
                      <th>פירוט / Details</th>
                      <th>סכום / Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>שכר בסיס / Base salary</td>
                      <td>
                        {proratedBaseSalary.isProrated
                          ? `${proratedBaseSalary.paidDays} מתוך ${proratedBaseSalary.daysInMonth} ימי בסיס / ${proratedBaseSalary.paidDays} of ${proratedBaseSalary.daysInMonth} base days`
                          : 'חודש מלא / Full month'}
                      </td>
                      <td>{money.format(proratedBaseSalary.amount)}</td>
                    </tr>
                    <tr>
                      <td>שבתות וימי מנוחה / Saturdays and rest days</td>
                      <td>
                        {numeric(values.paidSaturdays)} ×{' '}
                        {money.format(numeric(values.saturdayRate))}
                      </td>
                      <td>{money.format(calculation.saturdayPay)}</td>
                    </tr>
                    <tr>
                      <td>תשלום ימי חג / Holiday pay</td>
                      <td>
                        {numeric(values.paidHolidays)} ימי חג / {numeric(values.paidHolidays)} paid
                        holidays
                      </td>
                      <td>{money.format(numeric(values.holidayPay))}</td>
                    </tr>
                    <tr>
                      <td>תשלום חופשה / Vacation pay</td>
                      <td>{numeric(values.vacationDays)} ימי חופשה / Vacation days</td>
                      <td>{money.format(numeric(values.vacationPay))}</td>
                    </tr>
                    <tr>
                      <td>תשלום מחלה / Sick pay</td>
                      <td>{numeric(values.sickDays)} ימי מחלה / Sick days</td>
                      <td>{money.format(numeric(values.sickPay))}</td>
                    </tr>
                    <tr>
                      <td>הפרשות מעסיק / Employer contributions</td>
                      <td>פנסיה ופיצויים שהוזנו / Entered pension and severance</td>
                      <td>{money.format(numeric(values.employerContributions))}</td>
                    </tr>
                    <tr>
                      <td>תוספת אחרת / Other addition</td>
                      <td>תוספת כללית שהוזנה / Entered general addition</td>
                      <td>{money.format(numeric(values.otherAddition))}</td>
                    </tr>
                    {additionalPayments
                      .filter(
                        (payment) => payment.description.trim() || numeric(payment.amount) > 0,
                      )
                      .map((payment) => (
                        <tr key={payment.id}>
                          <td>תשלום נוסף / Additional payment</td>
                          <td>{payment.description || 'ללא תיאור / No description'}</td>
                          <td>{money.format(numeric(payment.amount))}</td>
                        </tr>
                      ))}
                    <tr className="subtotal">
                      <td colSpan={2}>סכום לפני קיזוזים / Total before deductions</td>
                      <td>{money.format(beforeDeductions)}</td>
                    </tr>
                    <tr>
                      <td>מקדמות וקיזוזים / Advances and deductions</td>
                      <td>
                        {deductionBreakdown.length > 0
                          ? deductionBreakdown.join(' · ')
                          : 'לא הוזנו קיזוזים'}
                        <br />
                        <span dir="ltr">
                          {deductionBreakdownEnglish.length > 0
                            ? deductionBreakdownEnglish.join(' · ')
                            : 'No deductions entered'}
                        </span>
                      </td>
                      <td>−{money.format(calculation.deductions)}</td>
                    </tr>
                    <tr className="total">
                      <td colSpan={2}>סה״כ לתשלום / Net amount payable</td>
                      <td>{money.format(calculation.total)}</td>
                    </tr>
                  </tbody>
                </table>
                <div className="payroll-print-attendance">
                  <span>ימי עבודה / Work days: {values.workDays}</span>
                  <span>ימי חופשה / Vacation days: {values.vacationDays}</span>
                  <span>ימי מחלה / Sick days: {values.sickDays}</span>
                  <span>ימי היעדרות / Absence days: {values.absenceDays}</span>
                </div>
                <div className="payroll-print-signatures">
                  <div>
                    <span>חתימת העובד/ת / Caregiver signature</span>
                    <i />
                  </div>
                  <div>
                    <span>חתימת המעסיק/ה / Employer signature</span>
                    <i />
                  </div>
                  <div>
                    <span>תאריך / Date</span>
                    <i />
                  </div>
                </div>
              </section>
            </>
          ) : null}
          {step === 5 && payrollSaved ? (
            <div className="success-box payroll-save-confirmation" role="status">
              <strong>השכר נשמר בהצלחה</strong>
              <span>הרישום לחודש {values.month} נוסף לדוח השנתי וניתן לערוך אותו בהמשך.</span>
            </div>
          ) : null}
          <div className="wizard-actions">
            {step === 1 ? (
              <a className="secondary-button" href={path('/')}>
                חזרה לדף הבית
              </a>
            ) : (
              <button
                className="secondary-button"
                type="button"
                onClick={() => setStep((value) => Math.max(1, value - 1))}
              >
                חזרה
              </button>
            )}
            {step === 5 ? (
              <div className="wizard-primary-actions">
                <button
                  className="secondary-button"
                  type="button"
                  aria-expanded={printPreviewOpen}
                  onClick={() => setPrintPreviewOpen((open) => !open)}
                >
                  {printPreviewOpen ? 'הסתרת תצוגה מקדימה' : 'תצוגה מקדימה להדפסה'}
                </button>
                {printPreviewOpen ? (
                  <button className="secondary-button" type="button" onClick={() => window.print()}>
                    הדפסה / שמירה כ־PDF
                  </button>
                ) : null}
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => savePayroll(Boolean(sequence))}
                >
                  {sequence
                    ? sequence.pendingMonths.at(-1) === values.month
                      ? 'שמירה וסיום הרצף'
                      : 'שמירה והמשך לחודש הבא'
                    : payrollSaved
                      ? 'שמירה מחדש'
                      : 'אישור ושמירה'}
                </button>
              </div>
            ) : (
              <button className="primary-button" type="button" onClick={goForward}>
                המשך
              </button>
            )}
          </div>
        </div>
      </section>
      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">מעקב עלויות</p>
            <h2>תשלומים תקופתיים של ההעסקה</h2>
            <p>
              כאן מתעדים תשלומים שאינם חלק מהשכר נטו לעובד. הסכום, התדירות והמועד נקבעים לפי הנתונים
              שהמשתמש מזין.
            </p>
          </div>
        </div>
        {/* R5-01..R5-03. This one section holds all three at once: typed
            amounts, the national insurance calculator's derived amount, and
            rows the user marked as paid. Before the badges they were three
            claims in one typeface. */}
        <ValueOriginLegend kinds={['input', 'calculated', 'paid']} />
        <form className="readable-form" onSubmit={saveExpense}>
          <div className="form-grid">
            <label>
              סוג התשלום
              <select
                value={expenseDraft.category}
                onChange={(event) => {
                  setExpenseDraft((current) => ({ ...current, category: event.target.value }));
                  setInsuranceMonthOverrides({});
                  setExpenseAmountOverridden(false);
                }}
              >
                <option>{NATIONAL_INSURANCE_CATEGORY}</option>
                <option>אגרת רישוי או היתר העסקה</option>
                <option>תשלום לתאגיד מורשה</option>
                <option>ביטוח רפואי</option>
                <option>הפרשות פנסיה ופיצויים</option>
                <option>דמי הבראה</option>
                <option>תשלום אחר</option>
              </select>
            </label>
            <label>
              תדירות
              <select
                value={expenseDraft.frequency}
                onChange={(event) =>
                  setExpenseDraft((current) => ({
                    ...current,
                    frequency: event.target.value as EmploymentExpenseFrequency,
                  }))
                }
              >
                <option value="monthly">חודשי</option>
                <option value="quarterly">רבעוני</option>
                <option value="annual">שנתי</option>
                <option value="one_time">חד־פעמי</option>
              </select>
            </label>
            {isNationalInsuranceExpense ? (
              <div className="full-width national-insurance-calculator">
                <div className="form-grid">
                  <label>
                    שיעור התשלום, באחוזים
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={insuranceRate}
                      onChange={(event) => {
                        setInsuranceRate(event.target.value);
                        setExpenseAmountOverridden(false);
                      }}
                    />
                    <small>
                      {`ברירת המחדל היא ${percent.format(DEFAULT_NATIONAL_INSURANCE_RATE_PERCENT)}%. `}
                      {t('payments.nationalInsuranceRateNote')}
                    </small>
                  </label>
                </div>
                {/* The Institute's form is a table with one line per month, and the
                    "was there employment" column is the whole point of it: a month
                    with no employment is reported and contributes nothing. Six
                    columns cannot survive a 360px viewport, so the LINE is the unit
                    that survives — each month is a card carrying its own captions,
                    and the captions stay visible at every width rather than being
                    hoisted into a header row that would strand them when it wraps. */}
                <ol className="ni-month-list">
                  {insuranceMonthRows.map((row, index) => {
                    const monthName = insuranceMonthNames[Number(row.month.slice(5, 7)) - 1] ?? '';
                    const monthLabel = hebrewMonthLabel(row.month, insuranceMonthNames);
                    const wageDisabled = row.isFuture || !row.employed;
                    return (
                      <li
                        className={[
                          'ni-month-row',
                          row.isFuture ? 'is-future' : '',
                          !row.employed ? 'is-not-employed' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        key={row.month}
                      >
                        <p className="ni-month-name">
                          <span className="ni-month-index" aria-hidden="true">
                            {index + 1}
                          </span>
                          <span>
                            <small>{t('payments.insuranceTable.monthColumn')}</small>
                            <strong>{monthLabel}</strong>
                          </span>
                        </p>
                        {row.isFuture ? (
                          <p className="ni-month-future">
                            {t('payments.insuranceTable.futureMonth', { month: monthName })}
                          </p>
                        ) : null}
                        <label className="ni-month-field">
                          <span>{t('payments.insuranceTable.employedColumn')}</span>
                          <select
                            aria-label={`${t('payments.insuranceTable.employedColumn')} ${monthLabel}`}
                            disabled={row.isFuture}
                            onChange={(event) =>
                              updateInsuranceMonth(row.month, {
                                employed: event.target.value === 'yes',
                              })
                            }
                            value={row.employed ? 'yes' : 'no'}
                          >
                            <option value="yes">{t('payments.insuranceTable.employedYes')}</option>
                            <option value="no">{t('payments.insuranceTable.employedNo')}</option>
                          </select>
                        </label>
                        <label className="ni-month-field">
                          <span>{t('payments.insuranceTable.wageColumn')}</span>
                          <input
                            aria-label={`${t('payments.insuranceTable.wageColumn')} ${monthLabel}`}
                            disabled={wageDisabled}
                            inputMode="numeric"
                            min="0"
                            onChange={(event) =>
                              updateInsuranceMonth(row.month, { wage: event.target.value })
                            }
                            step="1"
                            type="number"
                            value={row.wageValue}
                          />
                        </label>
                        <label className="ni-month-field">
                          <span>{t('payments.insuranceTable.rateColumn')}</span>
                          <input
                            aria-label={`${t('payments.insuranceTable.rateColumn')} ${monthLabel}`}
                            disabled={wageDisabled}
                            min="0"
                            onChange={(event) =>
                              updateInsuranceMonth(row.month, { rate: event.target.value })
                            }
                            step="0.01"
                            type="number"
                            value={row.rateValue}
                          />
                        </label>
                        <p className="ni-month-amount">
                          <span>{t('payments.insuranceTable.amountColumn')}</span>
                          {/* R5-02. The wage and the rate on the two fields
                              above are typed; this cell is wage × rate. It is
                              the figure the customer will pay by, so it must
                              not read as one more thing they entered. */}
                          <ValueOrigin kind="calculated" />
                          <strong>{money.format(row.amount)}</strong>
                        </p>
                      </li>
                    );
                  })}
                </ol>
                {wageSourceNotes.map((note) => (
                  <p className="form-note" key={note}>
                    {note}
                  </p>
                ))}
                <div className="payroll-live-total ni-total-wages" aria-live="polite">
                  <span>
                    {t('payments.insuranceTable.totalWages')}
                    {/* R5-02. */}
                    <ValueOrigin kind="calculated" />
                  </span>
                  <strong>{money.format(insuranceTotals.wages)}</strong>
                </div>
                <div className="payroll-live-total" aria-live="polite">
                  <span>
                    {t('payments.insuranceTable.totalToPay')}
                    {/* The rate is per line, so the total cannot be restated as one
                        multiplication. What it IS, is the sum of the lines above. */}
                    <small>
                      {t('payments.insuranceTable.totalToPayNote', {
                        months: insuranceMonthRows.filter((row) => row.employed).length,
                      })}
                    </small>
                    {/* R5-02. The sum of the per-month lines above; the rate
                        differs per line, so it cannot be restated as one
                        multiplication and must not read as a quoted figure. */}
                    <ValueOrigin
                      kind="calculated"
                      provenance={{ source: t('valueOrigin.source.nationalInsuranceCalculator') }}
                    />
                  </span>
                  <strong>{money.format(insuranceTotals.amount)}</strong>
                </div>
                {/* The computed figure is what the customer will pay by, so the
                    qualification sits beside it and not at the foot of the page. */}
                <p className="legal-note">{t('liability.calculation')}</p>
              </div>
            ) : null}
            <label>
              סכום בש״ח
              <input
                type="number"
                min="0"
                step="0.01"
                value={expenseAmountValue}
                onChange={(event) => {
                  setExpenseDraft((current) => ({ ...current, amount: event.target.value }));
                  setExpenseAmountOverridden(true);
                }}
              />
              <small>אפשר להשאיר ריק ולהוסיף את הסכום בהמשך. המעקב יישמר בכל מקרה.</small>
              {isNationalInsuranceExpense ? (
                <small>
                  {expenseAmountOverridden
                    ? 'הסכום הוזן ידנית ומחליף את החישוב שלמעלה.'
                    : 'הסכום מולא מהחישוב שלמעלה. אפשר להקליד כאן סכום אחר.'}
                </small>
              ) : null}
              {/* R5-01/R5-02. The same field holds either kind depending on
                  what the user did: typing here overrides the calculator, and
                  the badge follows the override flag that already exists rather
                  than a new piece of state. Outside the national insurance
                  category the field is only ever typed. */}
              <ValueOrigin
                kind={
                  isNationalInsuranceExpense && !expenseAmountOverridden ? 'calculated' : 'input'
                }
                provenance={
                  isNationalInsuranceExpense && !expenseAmountOverridden
                    ? { source: t('valueOrigin.source.nationalInsuranceCalculator') }
                    : undefined
                }
              />
            </label>
            <label>
              תאריך יעד
              <input
                type="date"
                required
                value={expenseDraft.dueDate}
                onChange={(event) =>
                  setExpenseDraft((current) => ({ ...current, dueDate: event.target.value }))
                }
              />
            </label>
            <label className="full-width">
              הערה או אסמכתה
              <input
                value={expenseDraft.note}
                onChange={(event) =>
                  setExpenseDraft((current) => ({ ...current, note: event.target.value }))
                }
                placeholder="לדוגמה: רבעון 3 או מספר אסמכתה"
              />
            </label>
          </div>
          <p className="info-box">
            המערכת אינה קובעת את שיעור התשלום או את מועדו המשפטי. יש להזין את הנתונים מהדרישה
            שקיבלתם ולאמת אותם מול גורם מוסמך.
          </p>
          <div className="button-row">
            <button className="primary-button" type="submit">
              {editingExpenseId ? 'שמירת עדכון' : 'הוספת תשלום למעקב'}
            </button>
            {editingExpenseId ? (
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setEditingExpenseId(null);
                  setExpenseDraft((current) => ({
                    ...current,
                    amount: '',
                    dueDate: '',
                    note: '',
                  }));
                  setInsuranceMonthOverrides({});
                  setExpenseAmountOverridden(false);
                }}
              >
                ביטול עריכה
              </button>
            ) : null}
          </div>
        </form>
        {expenses.length > 0 ? (
          <div className="detail-list employment-expenses">
            {expenses.map((expense) => (
              <div key={expense.id}>
                <span>
                  <strong>{expense.category}</strong>
                  <small>
                    {expense.frequency === 'monthly'
                      ? 'חודשי'
                      : expense.frequency === 'quarterly'
                        ? 'רבעוני'
                        : expense.frequency === 'annual'
                          ? 'שנתי'
                          : 'חד־פעמי'}{' '}
                    · יעד {expense.dueDate}
                    {expense.note ? ` · ${expense.note}` : ''}
                  </small>
                  {/* R5-01/R5-03. A row marked paid is a claim that money left
                      the account; an unpaid row is only what the user typed.
                      R5-05 note: the MVP expense record carries `savedAt` and
                      an optional `source`, and NOT a payment date — so "שולם"
                      here can name when the row was recorded but cannot name
                      when it was paid. No field was added to make it able to;
                      that is a data gap, recorded in the backlog, not a display
                      problem to paper over. */}
                  {expense.amountEntered === false ? null : (
                    <ValueOrigin
                      kind={expense.status === 'paid' ? 'paid' : 'input'}
                      provenance={{
                        source:
                          expense.source === 'payroll-national-insurance'
                            ? t('valueOrigin.source.nationalInsuranceCalculator')
                            : t('valueOrigin.source.userEntry'),
                        when: formatDateTime(expense.savedAt) ?? undefined,
                      }}
                    />
                  )}
                </span>
                <strong>
                  {expense.amountEntered === false ? 'סכום טרם הוזן' : money.format(expense.amount)}
                </strong>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => toggleExpense(expense)}
                >
                  {expense.status === 'paid' ? 'שולם ✓' : 'סימון כשולם'}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => editExpense(expense)}
                >
                  עדכון פרטים
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => removeExpense(expense)}
                >
                  מחיקה
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-copy">עדיין לא נשמרו תשלומים תקופתיים.</p>
        )}
      </section>
      {records.length > 0 ? (
        <section className="card" aria-labelledby="annual-payroll-history-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">דוח תקופתי</p>
              <h2 id="annual-payroll-history-title">שכר מצטבר והיסטוריה שנתית</h2>
              <p>
                הסכומים בדוח מחושבים מרשומות השכר החודשיות ששמרתם. הסכום השנתי לתשלום הוא החיבור
                המדויק של הסכום לתשלום בכל חודש.
              </p>
            </div>
            <label>
              שנת הדוח
              <select
                aria-label="שנת הדוח"
                value={reportYear}
                onChange={(event) => setReportYear(event.target.value)}
              >
                {payrollYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="pay-summary" aria-live="polite">
            <div>
              <span>
                חודשי שכר בדוח <small>רשומות שנשמרו</small>
              </span>
              <strong>{annualReport.monthsReported}</strong>
            </div>
            <div>
              <span>
                שכר בסיס מצטבר <small>סכום שכר הבסיס בכל חודש</small>
              </span>
              <strong>{money.format(annualReport.baseSalary)}</strong>
            </div>
            <div>
              <span>
                שבתות וימי מנוחה מצטברים <small>תשלום נפרד משכר הבסיס</small>
              </span>
              <strong>{money.format(annualReport.saturdayPay)}</strong>
            </div>
            <div>
              <span>
                תשלום ימי חג מצטבר <small>לפי הסכומים שנשמרו בכל חודש</small>
              </span>
              <strong>{money.format(annualReport.holidayPay)}</strong>
            </div>
            <div>
              <span>
                תשלום חופשה מצטבר <small>לפי הסכומים שנשמרו בכל חודש</small>
              </span>
              <strong>{money.format(annualReport.vacationPay)}</strong>
            </div>
            <div>
              <span>
                תשלום מחלה מצטבר <small>לפי הסכומים שנשמרו בכל חודש</small>
              </span>
              <strong>{money.format(annualReport.sickPay)}</strong>
            </div>
            <div>
              <span>
                הפרשות מעסיק מצטברות <small>פנסיה ופיצויים שהוזנו</small>
              </span>
              <strong>{money.format(annualReport.employerContributions)}</strong>
            </div>
            <div>
              <span>
                תשלומים ותוספות אחרים <small>תוספת כללית ותשלומים בעלי תיאור</small>
              </span>
              <strong>{money.format(annualReport.otherAdditions)}</strong>
            </div>
            <div className="payroll-subtotal">
              <span>
                סך כל התוספות <small>שבתות, חג, חופשה, מחלה ושאר התוספות</small>
              </span>
              <strong>{money.format(annualReport.additions)}</strong>
            </div>
            <div>
              <span>
                ניכויים מצטברים <small>כל הניכויים שהוזנו בחודשים</small>
              </span>
              <strong>−{money.format(annualReport.deductions)}</strong>
            </div>
            <div className="total">
              <span>
                סה״כ לתשלום בשנת {reportYear}
                {/* R5-02/R5-03. The underlying field is called `totalPaid`, but
                    it is the sum of the payroll records that were SAVED for the
                    year — a saved month is not a paid month, and closing a month
                    is a separate act with its own payment date. Marking this
                    `calculated` rather than `paid` is the point of R5-03. */}
                <ValueOrigin
                  kind="calculated"
                  provenance={{ source: t('valueOrigin.source.payrollRecord') }}
                />
              </span>
              <strong>{money.format(annualReport.totalPaid)}</strong>
            </div>
            {/* Footnote, not a banner: the caveat stays available without competing
                with the figures it annotates. */}
            <p className="report-footnote">
              <span aria-hidden="true">*</span> מקור הנתונים: רישומי השכר החודשיים שנשמרו במערכת.
              הדוח הוא כלי תיעוד וסיכום אריתמטי ואינו מחליף תלוש שכר או בדיקה מקצועית.
            </p>
          </div>
          <h3>פירוט לפי חודש</h3>
          <div className="detail-list payroll-history">
            {annualReport.records.map((record) => (
              <div key={record.id}>
                <span>
                  <strong>{record.month}</strong>
                  <small>
                    בסיס {money.format(record.baseSalary)} · {record.paidSaturdays} שבתות ×{' '}
                    {money.format(recordSaturdayRate(record))}
                    {record.pocketMoney ? ` · דמי כיס ${money.format(record.pocketMoney)}` : ''}
                    {record.advances ? ` · מקדמות ${money.format(record.advances)}` : ''}
                    {record.prorationStartDate
                      ? ` · שכר יחסי מ־${record.prorationStartDate} (${record.prorationDays ?? 0} ימים)`
                      : ''}
                  </small>
                  {toIsoAttribute(record.savedAt) ? (
                    <small className="record-timestamp">
                      נשמר{' '}
                      <time dateTime={toIsoAttribute(record.savedAt) ?? undefined}>
                        {formatDateTime(record.savedAt)}
                      </time>
                    </small>
                  ) : null}
                </span>
                <strong>{money.format(record.total)}</strong>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    loadMonth(record.month);
                    setStep(1);
                  }}
                >
                  עריכת החודש
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
