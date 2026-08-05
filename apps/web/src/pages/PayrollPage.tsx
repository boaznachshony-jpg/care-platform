/* eslint-disable no-restricted-syntax */
import { useMemo, useState } from 'react';
import { useMvpProfile } from '../hooks/use-mvp-profile.js';
import { useClientPath } from '../hooks/use-client-path.js';
import { calculateMonthlyPayroll, calculateProratedBaseSalary } from '../payroll-calculation.js';
import { createAnnualPayrollReport, getPayrollYears } from '../payroll-report.js';
import {
  readMvpEmploymentExpenses,
  readMvpPayroll,
  saveMvpEmploymentExpenses,
  saveMvpPayroll,
  type EmploymentExpenseFrequency,
  type MvpEmploymentExpense,
  type MvpPayrollRecord,
} from '../storage/mvp-storage.js';

const currentMonth = new Date().toISOString().slice(0, 7);
const money = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' });
const MAX_PAYROLL_AMOUNT = 10_000_000;
const MAX_PAID_SATURDAYS = 6;
const MAX_PAID_HOLIDAYS = 10;

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

function recordSaturdayRate(record: MvpPayrollRecord): number {
  return (
    record.saturdayRate ??
    (record.paidSaturdays ? (record.saturdayPay ?? 0) / record.paidSaturdays : 0)
  );
}

export function PayrollPage() {
  const path = useClientPath();
  const [profile, setProfile] = useMvpProfile();
  const [records, setRecords] = useState(readMvpPayroll);
  const [expenses, setExpenses] = useState(readMvpEmploymentExpenses);
  const [step, setStep] = useState(profile.baseSalary === null ? 0 : 1);
  const initialRecord = records.find((record) => record.month === currentMonth);
  const [values, setValues] = useState(() =>
    payrollValues(initialRecord, profile.baseSalary, profile.saturdayRate),
  );
  const [expenseDraft, setExpenseDraft] = useState({
    category: 'ביטוח לאומי',
    frequency: 'quarterly' as EmploymentExpenseFrequency,
    amount: '',
    dueDate: '',
    note: '',
  });
  const [message, setMessage] = useState('');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [payrollSaved, setPayrollSaved] = useState(false);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);

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
      otherAddition: numeric(values.otherAddition),
      medicalInsuranceDeduction: numeric(values.medicalInsuranceDeduction),
      housingDeduction: numeric(values.housingDeduction),
      advances: numeric(values.advances),
      agreedDeduction: numeric(values.agreedDeduction),
    });
  }, [proratedBaseSalary.amount, values]);
  const otherAdditions = Math.max(0, calculation.additions - calculation.saturdayPay);
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
    setValidationErrors([]);
    setPayrollSaved(false);
    setMessage(record ? 'הרישום השמור נטען לעריכה.' : 'נפתח חישוב חדש לחודש שנבחר.');
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

  function savePayroll() {
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
    saveMvpPayroll(next);
    setRecords(next);
    setReportYear(saved.month.slice(0, 4));
    setMessage('חישוב השכר החודשי נשמר וניתן לעריכה חוזרת.');
    setPayrollSaved(true);
  }

  function saveExpense(event: React.FormEvent) {
    event.preventDefault();
    if (!expenseDraft.category || !expenseDraft.dueDate) {
      setMessage('יש לבחור סוג תשלום ותאריך יעד.');
      return;
    }
    const saved: MvpEmploymentExpense = {
      id: crypto.randomUUID(),
      category: expenseDraft.category,
      frequency: expenseDraft.frequency,
      amount: numeric(expenseDraft.amount),
      dueDate: expenseDraft.dueDate,
      status: 'upcoming',
      note: expenseDraft.note,
      savedAt: new Date().toISOString(),
    };
    const next = [saved, ...expenses];
    saveMvpEmploymentExpenses(next);
    setExpenses(next);
    setExpenseDraft((current) => ({ ...current, amount: '', dueDate: '', note: '' }));
    setMessage('התשלום התקופתי נשמר בלוח עלויות ההעסקה.');
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
            <p>אין במערכת שכר מוגדר. הזינו את השכר שסוכם בהעסקה לפני הכנת חישוב חודשי.</p>
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
          <h1>הכנת שכר חודשי</h1>
          <p>כל הסכומים מוזנים על ידי המשתמש, מחושבים בזמן אמת ונשמרים לפי חודש.</p>
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
                onChange={(event) => loadMonth(event.target.value)}
              />
              {records.some((record) => record.month === values.month) ? (
                <small>קיים חישוב שמור לחודש זה. המשך התהליך יעדכן אותו.</small>
              ) : (
                <small>עדיין לא נשמר חישוב לחודש זה.</small>
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
                  <strong>{money.format(otherAdditions)}</strong>
                </div>
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
                  זהו כלי תיעוד וחישוב אריתמטי בלבד. יש לאמת זכויות, ניכויים ותשלומים מול גורם
                  מקצועי.
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
                aria-label="ריכוז חישוב שכר להדפסה"
              >
                <header>
                  <div>
                    <strong>CareDesk</strong>
                    <h1>ריכוז חישוב שכר חודשי / Monthly pay summary</h1>
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
                      <td>תוספות אחרות / Other additions</td>
                      <td>
                        חג, חופשה, מחלה ותוספות שהוזנו / Holiday, vacation, sick pay and additions
                      </td>
                      <td>{money.format(otherAdditions)}</td>
                    </tr>
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
              <span>החישוב לחודש {values.month} נוסף לדוח השנתי וניתן לערוך אותו בהמשך.</span>
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
                <button className="primary-button" type="button" onClick={savePayroll}>
                  {payrollSaved ? 'שמירה מחדש' : 'אישור ושמירה'}
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
          <button className="primary-button" type="submit">
            הוספת תשלום למעקב
          </button>
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
                <strong>{money.format(expense.amount)}</strong>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => toggleExpense(expense)}
                >
                  {expense.status === 'paid' ? 'שולם ✓' : 'סימון כשולם'}
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
        <section className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">דוח תקופתי</p>
              <h2>שכר מצטבר והיסטוריה שנתית</h2>
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
                תוספות מצטברות <small>לרבות הפרשות מעסיק שהוזנו</small>
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
              מקור הנתונים: חישובי השכר החודשיים שנשמרו במערכת. הדוח הוא כלי תיעוד וסיכום אריתמטי
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
