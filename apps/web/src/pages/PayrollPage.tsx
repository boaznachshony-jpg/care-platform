/* eslint-disable no-restricted-syntax */
import { useMemo, useState } from 'react';
import { useMvpProfile } from '../hooks/use-mvp-profile.js';
import { readMvpPayroll, saveMvpPayroll, type MvpPayrollRecord } from '../storage/mvp-storage.js';

const currentMonth = new Date().toISOString().slice(0, 7);
const money = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' });

function numeric(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function PayrollPage() {
  const [profile, setProfile] = useMvpProfile();
  const [records, setRecords] = useState(readMvpPayroll);
  const [step, setStep] = useState(profile.baseSalary === null ? 0 : 1);
  const existing = records.find((record) => record.month === currentMonth);
  const [values, setValues] = useState({
    month: existing?.month ?? currentMonth,
    baseSalary: String(existing?.baseSalary ?? profile.baseSalary ?? ''),
    workDays: String(existing?.workDays ?? 0),
    paidSaturdays: String(existing?.paidSaturdays ?? 0),
    saturdayPay: String(existing?.saturdayPay ?? 0),
    pocketMoney: String(existing?.pocketMoney ?? 0),
    otherAddition: String(existing?.otherAddition ?? 0),
    advances: String(existing?.advances ?? 0),
    agreedDeduction: String(existing?.agreedDeduction ?? 0),
  });
  const [message, setMessage] = useState('');

  const calculation = useMemo(() => {
    const additions =
      numeric(values.saturdayPay) + numeric(values.pocketMoney) + numeric(values.otherAddition);
    const deductions = numeric(values.advances) + numeric(values.agreedDeduction);
    return {
      additions,
      deductions,
      total: Math.max(0, numeric(values.baseSalary) + additions - deductions),
    };
  }, [values]);

  function update(key: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setMessage('');
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
    const saved: MvpPayrollRecord = {
      id: existing?.id ?? crypto.randomUUID(),
      month: values.month,
      baseSalary: numeric(values.baseSalary),
      workDays: numeric(values.workDays),
      paidSaturdays: numeric(values.paidSaturdays),
      saturdayPay: numeric(values.saturdayPay),
      pocketMoney: numeric(values.pocketMoney),
      otherAddition: numeric(values.otherAddition),
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
    setMessage('חישוב השכר החודשי נשמר וניתן לעריכה חוזרת.');
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

  const headings = ['בחירת חודש', 'שכר בסיס', 'תוספות', 'ניכויים', 'סיכום ואישור'];
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
          {['חודש', 'שכר בסיס', 'תוספות', 'ניכויים', 'סיכום'].map((label, index) => (
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
                onChange={(event) => update('month', event.target.value)}
              />
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
                שבתות בתשלום
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={values.paidSaturdays}
                  onChange={(event) => update('paidSaturdays', event.target.value)}
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
                תשלום שבתות
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.saturdayPay}
                  onChange={(event) => update('saturdayPay', event.target.value)}
                />
              </label>
              <label>
                דמי כיס
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.pocketMoney}
                  onChange={(event) => update('pocketMoney', event.target.value)}
                />
              </label>
              <label>
                תוספת אחרת
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.otherAddition}
                  onChange={(event) => update('otherAddition', event.target.value)}
                />
              </label>
            </div>
          ) : null}
          {step === 4 ? (
            <div className="form-grid">
              <label>
                מקדמות
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.advances}
                  onChange={(event) => update('advances', event.target.value)}
                />
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
            </div>
          ) : null}
          {step === 5 ? (
            <div className="pay-summary">
              <div>
                <span>
                  שכר בסיס <small>נתוני העסקה</small>
                </span>
                <strong>{money.format(numeric(values.baseSalary))}</strong>
              </div>
              <div>
                <span>
                  תוספות <small>הזנה חודשית</small>
                </span>
                <strong>{money.format(calculation.additions)}</strong>
              </div>
              <div>
                <span>
                  ניכויים <small>הזנה חודשית</small>
                </span>
                <strong>−{money.format(calculation.deductions)}</strong>
              </div>
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
      {records.length > 0 ? (
        <section className="card">
          <h2>חישובים שנשמרו</h2>
          <div className="detail-list">
            {records.map((record) => (
              <div key={record.id}>
                <span>{record.month}</span>
                <strong>{money.format(record.total)}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
