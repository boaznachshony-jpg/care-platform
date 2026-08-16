/* eslint-disable no-restricted-syntax */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
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
import { listPayrollEntries, savePayrollEntry } from '../api/client.js';

const currentMonth = new Date().toISOString().slice(0, 7);
const money = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' });
const MAX_PAYROLL_AMOUNT = 10_000_000;
const MAX_PAID_SATURDAYS = 6;
const MAX_PAID_HOLIDAYS = 10;

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
    category: 'ביטוח לאומי',
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

export function PayrollPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const path = useClientPath();
  const [profile, setProfile] = useMvpProfile();
  const [records, setRecords] = useState(readMvpPayroll);
  const [expenses, setExpenses] = useState(readMvpEmploymentExpenses);
  const [step, setStep] = useState(profile.baseSalary === null ? 0 : 1);
  const initialRecord = records.find((record) => record.month === currentMonth);
  const [values, setValues] = useState(() =>
    payrollValues(initialRecord, profile.baseSalary, profile.saturdayRate),
  );
  const [additionalPayments, setAdditionalPayments] = useState<AdditionalPaymentDraft[]>(() =>
    additionalPaymentDrafts(initialRecord),
  );
  const [expenseDraft, setExpenseDraft] = useState({
    category: 'ביטוח לאומי',
    frequency: 'quarterly' as EmploymentExpenseFrequency,
    amount: '',
    dueDate: '',
    note: '',
  });
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
  const canonicalCaseId =
    clientId && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(clientId) ? clientId : null;

  useEffect(() => {
    if (!canonicalCaseId) return;
    let active = true;
    void listPayrollEntries(canonicalCaseId)
      .then((entries) => {
        if (!active) return;
        const canonical = entries.map<MvpPayrollRecord>((entry) => ({
          id: entry.id,
          month: entry.month,
          baseSalary: entry.baseSalary,
          contractBaseSalary: entry.baseSalary,
          workDays: entry.workDays,
          vacationDays: entry.vacationDays,
          sickDays: entry.sickDays,
          absenceDays: entry.otherAbsenceDays,
          paidSaturdays: entry.paidRestDays,
          saturdayRate: entry.restDayRate,
          paidHolidays: entry.paidHolidays,
          saturdayPay: entry.paidRestDays * entry.restDayRate,
          holidayPay: entry.holidayPay,
          vacationPay: entry.vacationPay,
          sickPay: entry.sickPay,
          pocketMoney: entry.pocketMoney,
          employerContributions: entry.employerContributions,
          otherAddition: 0,
          additionalPayments: entry.additionalPayments.map((payment) => ({
            ...payment,
            id: crypto.randomUUID(),
          })),
          medicalInsuranceDeduction: entry.deductions,
          housingDeduction: 0,
          advances: entry.advances,
          agreedDeduction: entry.agreedDeductions,
          total: entry.total,
          savedAt: entry.updatedAt,
          canonicalVersion: entry.version,
        }));
        setRecords(canonical);
      })
      .catch(() => setMessage('לא ניתן לטעון כרגע את רישומי השכר מהשרת.'));
    return () => {
      active = false;
    };
  }, [canonicalCaseId]);

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

  function loadMonth(month: string) {
    const record = records.find((item) => item.month === month);
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

  async function savePayroll(continueSequence = false) {
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
      savedAt: new Date().toISOString(),
    };
    const next = records.some((record) => record.month === saved.month)
      ? records.map((record) => (record.month === saved.month ? saved : record))
      : [saved, ...records];
    const nextExpenses = withNationalInsuranceTracking(expenses, saved.month);
    if (canonicalCaseId) {
      try {
        const result = await savePayrollEntry(
          canonicalCaseId,
          saved.month,
          {
            baseSalary: saved.baseSalary,
            workDays: saved.workDays,
            paidRestDays: saved.paidSaturdays,
            restDayRate: saved.saturdayRate ?? 0,
            paidHolidays: saved.paidHolidays ?? 0,
            holidayPay: saved.holidayPay ?? 0,
            vacationDays: saved.vacationDays ?? 0,
            vacationPay: saved.vacationPay ?? 0,
            sickDays: saved.sickDays ?? 0,
            sickPay: saved.sickPay ?? 0,
            otherAbsenceDays: saved.absenceDays ?? 0,
            employerContributions: saved.employerContributions ?? 0,
            additionalPayments: savedAdditionalPayments.map(({ description, amount }) => ({
              description,
              amount,
            })),
            pocketMoney: saved.pocketMoney,
            deductions: (saved.medicalInsuranceDeduction ?? 0) + (saved.housingDeduction ?? 0),
            advances: saved.advances,
            agreedDeductions: saved.agreedDeduction,
            total: saved.total,
            status: 'draft',
            ...(existing?.canonicalVersion ? { version: existing.canonicalVersion } : {}),
          },
          crypto.randomUUID(),
        );
        saved.id = result.entry.id;
        saved.savedAt = result.entry.updatedAt;
        saved.canonicalVersion = result.entry.version;
      } catch {
        setMessage('שמירת השכר בשרת נכשלה. לא נשמר עותק מקומי חלופי.');
        setPayrollSaved(false);
        return;
      }
    } else {
      // Compatibility-only for pre-case routes. Authorized case routes never
      // dual-write and always use PostgreSQL as their durable authority.
      saveMvpPayroll(next);
    }
    saveMvpEmploymentExpenses(nextExpenses);
    setRecords(next);
    setExpenses(nextExpenses);
    setReportYear(saved.month.slice(0, 4));
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
      amount: numeric(expenseDraft.amount),
      amountEntered: expenseDraft.amount.trim() !== '',
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
                </span>
                <strong>{money.format(calculation.saturdayPay)}</strong>
              </div>
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
                <span>כל התוספות לחודש, כולל שבתות</span>
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
                <span>סה״כ מקדמות וקיזוזים</span>
                <strong>−{money.format(calculation.deductions)}</strong>
              </div>
            </div>
          ) : null}
          {step === 5 ? (
            <>
              <div className="pay-summary">
                <div>
                  <span>
                    שכר בסיס <small>נתוני העסקה</small>
                  </span>
                  <strong>{money.format(proratedBaseSalary.amount)}</strong>
                </div>
                <div>
                  <span>
                    שבתות וימי מנוחה
                    <small>
                      {numeric(values.paidSaturdays)} × {money.format(numeric(values.saturdayRate))}
                    </small>
                  </span>
                  <strong>{money.format(calculation.saturdayPay)}</strong>
                </div>
                <div>
                  <span>
                    תוספות אחרות <small>לא כולל שבתות, המוצגות בשורה נפרדת</small>
                  </span>
                  <strong>{money.format(standardOtherAdditions)}</strong>
                </div>
                {additionalPayments
                  .filter((payment) => payment.description.trim() || numeric(payment.amount) > 0)
                  .map((payment) => (
                    <div key={payment.id}>
                      <span>
                        תשלום נוסף <small>{payment.description || 'ללא תיאור'}</small>
                      </span>
                      <strong>{money.format(numeric(payment.amount))}</strong>
                    </div>
                  ))}
                <div className="payroll-subtotal">
                  <span>סכום לפני קיזוזים</span>
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
                  </span>
                  <strong>−{money.format(calculation.deductions)}</strong>
                </div>
                <div className="total">
                  <span>סה״כ לתשלום</span>
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
        <form className="readable-form" onSubmit={saveExpense}>
          <div className="form-grid">
            <label>
              סוג התשלום
              <select
                value={expenseDraft.category}
                onChange={(event) =>
                  setExpenseDraft((current) => ({ ...current, category: event.target.value }))
                }
              >
                <option>ביטוח לאומי</option>
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
            <label>
              סכום בש״ח
              <input
                type="number"
                min="0"
                step="0.01"
                value={expenseDraft.amount}
                onChange={(event) =>
                  setExpenseDraft((current) => ({ ...current, amount: event.target.value }))
                }
              />
              <small>אפשר להשאיר ריק ולהוסיף את הסכום בהמשך. המעקב יישמר בכל מקרה.</small>
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
              <span>סה״כ לתשלום בשנת {reportYear}</span>
              <strong>{money.format(annualReport.totalPaid)}</strong>
            </div>
            <p>
              מקור הנתונים: רישומי השכר החודשיים שנשמרו במערכת. הדוח הוא כלי תיעוד וסיכום אריתמטי
              ואינו מחליף תלוש שכר או בדיקה מקצועית.
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
