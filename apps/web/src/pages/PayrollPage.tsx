/* eslint-disable no-restricted-syntax */
import { useMemo, useState } from 'react';
import { useMvpProfile } from '../hooks/use-mvp-profile.js';
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

function numeric(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function payrollValues(record: MvpPayrollRecord | undefined, baseSalary: number | null) {
  const saturdayRate =
    record?.saturdayRate ??
    (record?.paidSaturdays ? (record.saturdayPay ?? 0) / record.paidSaturdays : 0);

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
  const [profile, setProfile] = useMvpProfile();
  const [records, setRecords] = useState(readMvpPayroll);
  const [expenses, setExpenses] = useState(readMvpEmploymentExpenses);
  const [step, setStep] = useState(profile.baseSalary === null ? 0 : 1);
  const initialRecord = records.find((record) => record.month === currentMonth);
  const [values, setValues] = useState(() => payrollValues(initialRecord, profile.baseSalary));
  const [expenseDraft, setExpenseDraft] = useState({
    category: 'ביטוח לאומי',
    frequency: 'quarterly' as EmploymentExpenseFrequency,
    amount: '',
    dueDate: '',
    note: '',
  });
  const [message, setMessage] = useState('');
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

  function update(key: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setMessage('');
  }

  function loadMonth(month: string) {
    const record = records.find((item) => item.month === month);
    setValues({ ...payrollValues(record, profile.baseSalary), month });
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

  function removeExpense(id: string) {
    const next = expenses.filter((item) => item.id !== id);
    saveMvpEmploymentExpenses(next);
    setExpenses(next);
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
                  onChange={(event) => update('baseSalary', event.target.value)}
                />
              </label>
              <label>
                תאריך תחילת עבודה בחודש, לחישוב יחסי
                <input
                  type="date"
                  min={`${values.month}-01`}
                  max={`${values.month}-${String(proratedBaseSalary.daysInMonth).padStart(2, '0')}`}
                  value={values.prorationStartDate}
                  aria-label="תאריך תחילת עבודה בחודש, לחישוב יחסי"
                  onChange={(event) => update('prorationStartDate', event.target.value)}
                />
                <small>השאירו ריק כאשר העובד הועסק במשך כל החודש.</small>
              </label>
              <div className="payroll-live-total" aria-live="polite">
                <span>
                  שכר בסיס לחודש הנבחר
                  <small>
                    {proratedBaseSalary.isProrated
                      ? `${proratedBaseSalary.paidDays} מתוך ${proratedBaseSalary.daysInMonth} ימים`
                      : 'חודש מלא'}
                  </small>
                </span>
                <strong>{money.format(proratedBaseSalary.amount)}</strong>
              </div>
              <label>
                ימי עבודה
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={values.workDays}
                  onChange={(event) => update('workDays', event.target.value)}
                />
              </label>
              <label>
                ימי חופשה שנוצלו
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={values.vacationDays}
                  onChange={(event) => update('vacationDays', event.target.value)}
                />
              </label>
              <label>
                ימי מחלה
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={values.sickDays}
                  onChange={(event) => update('sickDays', event.target.value)}
                />
              </label>
              <label>
                ימי היעדרות אחרים
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={values.absenceDays}
                  onChange={(event) => update('absenceDays', event.target.value)}
                />
              </label>
              <label>
                מספר שבתות או ימי מנוחה שעבדו
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={values.paidSaturdays}
                  onChange={(event) => update('paidSaturdays', event.target.value)}
                />
              </label>
              <label>
                תעריף לכל שבת או יום מנוחה
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.saturdayRate}
                  onChange={(event) => update('saturdayRate', event.target.value)}
                />
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
                  onChange={(event) => update('paidHolidays', event.target.value)}
                />
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
                  onChange={(event) => update('holidayPay', event.target.value)}
                />
              </label>
              <label>
                תשלום חופשה
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.vacationPay}
                  onChange={(event) => update('vacationPay', event.target.value)}
                />
              </label>
              <label>
                תשלום מחלה
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.sickPay}
                  onChange={(event) => update('sickPay', event.target.value)}
                />
              </label>
              <label>
                הפרשות מעסיק: פנסיה ופיצויים
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.employerContributions}
                  onChange={(event) => update('employerContributions', event.target.value)}
                />
              </label>
              <label>
                תוספת אחרת, אם קיימת
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.otherAddition}
                  onChange={(event) => update('otherAddition', event.target.value)}
                />
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
                  onChange={(event) => update('pocketMoney', event.target.value)}
                />
                <small>הסכום יוצג בנפרד ויקוזז מהתשלום שנותר החודש.</small>
              </label>
              <label>
                ניכוי ביטוח רפואי
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.medicalInsuranceDeduction}
                  onChange={(event) => update('medicalInsuranceDeduction', event.target.value)}
                />
              </label>
              <label>
                ניכוי מגורים
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.housingDeduction}
                  onChange={(event) => update('housingDeduction', event.target.value)}
                />
              </label>
              <label>
                מקדמות שכבר שולמו
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.advances}
                  aria-label="מקדמות שכבר שולמו"
                  onChange={(event) => update('advances', event.target.value)}
                />
                <small>הסכום יקוזז מהתשלום הנותר החודש.</small>
              </label>
              <label>
                ניכוי מוסכם
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.agreedDeduction}
                  onChange={(event) => update('agreedDeduction', event.target.value)}
                />
              </label>
              <div className="payroll-live-total deduction" aria-live="polite">
                <span>סה״כ מקדמות וקיזוזים</span>
                <strong>−{money.format(calculation.deductions)}</strong>
              </div>
            </div>
          ) : null}
          {step === 5 ? (
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
                  כלל התוספות <small>כולל שבתות ותוספות אחרות</small>
                </span>
                <strong>{money.format(calculation.additions)}</strong>
              </div>
              <div>
                <span>
                  מקדמות וקיזוזים <small>כל הסכומים שהוזנו החודש</small>
                </span>
                <strong>−{money.format(calculation.deductions)}</strong>
              </div>
              {numeric(values.pocketMoney) > 0 ? (
                <div>
                  <span>
                    מתוכם דמי כיס <small>שולמו במהלך החודש</small>
                  </span>
                  <strong>−{money.format(numeric(values.pocketMoney))}</strong>
                </div>
              ) : null}
              <div className="total">
                <span>סה״כ לתשלום</span>
                <strong>{money.format(calculation.total)}</strong>
              </div>
              <p>
                זהו כלי תיעוד וחישוב אריתמטי בלבד. יש לאמת זכויות, ניכויים ותשלומים מול גורם מקצועי.
              </p>
            </div>
          ) : null}
          <div className="wizard-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={step === 1}
              onClick={() => setStep((value) => Math.max(1, value - 1))}
            >
              חזרה
            </button>
            {step === 5 ? (
              <button className="primary-button" type="button" onClick={savePayroll}>
                אישור ושמירה
              </button>
            ) : (
              <button
                className="primary-button"
                type="button"
                onClick={() => setStep((value) => Math.min(5, value + 1))}
              >
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
                  onClick={() => removeExpense(expense.id)}
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
              מקור הנתונים: חישובי השכר החודשיים שנשמרו במכשיר זה. הדוח הוא כלי תיעוד וסיכום אריתמטי
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
