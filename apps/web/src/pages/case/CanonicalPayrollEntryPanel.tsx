import { useEffect, useMemo, useState } from 'react';
import {
  ApiRequestError,
  listPayrollEntries,
  savePayrollEntry,
  type PayrollEntryResponse,
  type SavePayrollEntryRequest,
} from '../../api/client.js';

const currentMonth = new Date().toISOString().slice(0, 7);
const money = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' });

type FormState = {
  month: string;
  baseSalary: string;
  workDays: string;
  paidRestDays: string;
  restDayRate: string;
  paidHolidays: string;
  holidayPay: string;
  vacationDays: string;
  vacationPay: string;
  sickDays: string;
  sickPay: string;
  otherAbsenceDays: string;
  employerContributions: string;
  pocketMoney: string;
  deductions: string;
  advances: string;
  agreedDeductions: string;
};

const emptyForm: FormState = {
  month: currentMonth,
  baseSalary: '',
  workDays: '0',
  paidRestDays: '0',
  restDayRate: '0',
  paidHolidays: '0',
  holidayPay: '0',
  vacationDays: '0',
  vacationPay: '0',
  sickDays: '0',
  sickPay: '0',
  otherAbsenceDays: '0',
  employerContributions: '0',
  pocketMoney: '0',
  deductions: '0',
  advances: '0',
  agreedDeductions: '0',
};

const number = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

function formFromEntry(entry: PayrollEntryResponse): FormState {
  return {
    month: entry.month,
    baseSalary: String(entry.baseSalary),
    workDays: String(entry.workDays),
    paidRestDays: String(entry.paidRestDays),
    restDayRate: String(entry.restDayRate),
    paidHolidays: String(entry.paidHolidays),
    holidayPay: String(entry.holidayPay),
    vacationDays: String(entry.vacationDays),
    vacationPay: String(entry.vacationPay),
    sickDays: String(entry.sickDays),
    sickPay: String(entry.sickPay),
    otherAbsenceDays: String(entry.otherAbsenceDays),
    employerContributions: String(entry.employerContributions),
    pocketMoney: String(entry.pocketMoney),
    deductions: String(entry.deductions),
    advances: String(entry.advances),
    agreedDeductions: String(entry.agreedDeductions),
  };
}

export function CanonicalPayrollEntryPanel({ caseId }: { caseId: string }) {
  const [entries, setEntries] = useState<PayrollEntryResponse[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [version, setVersion] = useState<number | undefined>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const additionalPayments: SavePayrollEntryRequest['additionalPayments'] = [];
  const total = useMemo(
    () =>
      number(form.baseSalary) +
      number(form.paidRestDays) * number(form.restDayRate) +
      number(form.holidayPay) +
      number(form.vacationPay) +
      number(form.sickPay) +
      number(form.employerContributions) -
      number(form.pocketMoney) -
      number(form.deductions) -
      number(form.advances) -
      number(form.agreedDeductions),
    [form],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    listPayrollEntries(caseId)
      .then((items) => {
        if (!active) return;
        setEntries(items);
        const selected = items.find((item) => item.month === currentMonth) ?? items[0];
        if (selected) {
          setForm(formFromEntry(selected));
          setVersion(selected.version);
        }
      })
      .catch(() => {
        if (active) setError('לא ניתן לטעון כרגע את רישומי השכר מהתיק.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [caseId]);

  function update(key: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setMessage('');
    setError('');
  }

  function loadMonth(month: string) {
    const selected = entries.find((entry) => entry.month === month);
    if (selected) {
      setForm(formFromEntry(selected));
      setVersion(selected.version);
      setMessage('הרישום הקנוני נטען לעריכה.');
    } else {
      setForm({ ...emptyForm, month });
      setVersion(undefined);
      setMessage('נפתח רישום חדש לחודש שנבחר.');
    }
    setError('');
  }

  async function save() {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(form.month) || number(form.baseSalary) <= 0) {
      setError('יש לבחור חודש תקין ולהזין שכר בסיס גדול מאפס.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    const input: SavePayrollEntryRequest = {
      baseSalary: number(form.baseSalary),
      workDays: number(form.workDays),
      paidRestDays: number(form.paidRestDays),
      restDayRate: number(form.restDayRate),
      paidHolidays: number(form.paidHolidays),
      holidayPay: number(form.holidayPay),
      vacationDays: number(form.vacationDays),
      vacationPay: number(form.vacationPay),
      sickDays: number(form.sickDays),
      sickPay: number(form.sickPay),
      otherAbsenceDays: number(form.otherAbsenceDays),
      employerContributions: number(form.employerContributions),
      additionalPayments,
      pocketMoney: number(form.pocketMoney),
      deductions: number(form.deductions),
      advances: number(form.advances),
      agreedDeductions: number(form.agreedDeductions),
      total,
      status: 'draft',
      ...(version ? { version } : {}),
    };
    try {
      const result = await savePayrollEntry(caseId, form.month, input, crypto.randomUUID());
      const next = entries.some((entry) => entry.month === result.entry.month)
        ? entries.map((entry) => (entry.month === result.entry.month ? result.entry : entry))
        : [result.entry, ...entries];
      setEntries(next);
      setForm(formFromEntry(result.entry));
      setVersion(result.entry.version);
      setMessage(result.replayed ? 'השמירה אומתה מחדש.' : 'השכר נשמר בתיק הקנוני.');
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.status === 409) {
        setError('הרישום השתנה מאז שנטען. טענו מחדש את החודש לפני שמירה נוספת.');
      } else {
        setError('שמירת השכר נכשלה. לא נשמר עותק מקומי חלופי.');
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="card" aria-label="שכר קנוני">
        <p>טוען רישומי שכר…</p>
      </section>
    );
  }

  return (
    <section className="card" aria-labelledby="canonical-payroll-entry-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">שכר קנוני</p>
          <h2 id="canonical-payroll-entry-title">רישום שכר חודשי בתיק</h2>
          <p>הרישום נשמר בשרת תחת תיק ההעסקה המאומת. אין כתיבה מקבילה לאחסון המקומי.</p>
        </div>
      </div>

      {message ? <p className="success-box" role="status">{message}</p> : null}
      {error ? <p className="info-box" role="alert">{error}</p> : null}

      <div className="form-grid">
        <label>
          חודש שכר
          <input type="month" value={form.month} onChange={(event) => loadMonth(event.target.value)} />
        </label>
        <label>
          שכר בסיס
          <input type="number" min="0" step="0.01" value={form.baseSalary} onChange={(event) => update('baseSalary', event.target.value)} />
        </label>
        <label>
          ימי עבודה
          <input type="number" min="0" max="31" step="1" value={form.workDays} onChange={(event) => update('workDays', event.target.value)} />
        </label>
        <label>
          ימי מנוחה בתשלום
          <input type="number" min="0" max="6" step="1" value={form.paidRestDays} onChange={(event) => update('paidRestDays', event.target.value)} />
        </label>
        <label>
          תעריף יום מנוחה
          <input type="number" min="0" step="0.01" value={form.restDayRate} onChange={(event) => update('restDayRate', event.target.value)} />
        </label>
        <label>
          ימי חג
          <input type="number" min="0" max="10" step="1" value={form.paidHolidays} onChange={(event) => update('paidHolidays', event.target.value)} />
        </label>
        <label>
          תשלום חג
          <input type="number" min="0" step="0.01" value={form.holidayPay} onChange={(event) => update('holidayPay', event.target.value)} />
        </label>
        <label>
          ימי חופשה
          <input type="number" min="0" max="31" step="0.5" value={form.vacationDays} onChange={(event) => update('vacationDays', event.target.value)} />
        </label>
        <label>
          תשלום חופשה
          <input type="number" min="0" step="0.01" value={form.vacationPay} onChange={(event) => update('vacationPay', event.target.value)} />
        </label>
        <label>
          ימי מחלה
          <input type="number" min="0" max="31" step="0.5" value={form.sickDays} onChange={(event) => update('sickDays', event.target.value)} />
        </label>
        <label>
          תשלום מחלה
          <input type="number" min="0" step="0.01" value={form.sickPay} onChange={(event) => update('sickPay', event.target.value)} />
        </label>
        <label>
          היעדרות אחרת
          <input type="number" min="0" max="31" step="0.5" value={form.otherAbsenceDays} onChange={(event) => update('otherAbsenceDays', event.target.value)} />
        </label>
        <label>
          הפרשות מעסיק
          <input type="number" min="0" step="0.01" value={form.employerContributions} onChange={(event) => update('employerContributions', event.target.value)} />
        </label>
        <label>
          דמי כיס
          <input type="number" min="0" step="0.01" value={form.pocketMoney} onChange={(event) => update('pocketMoney', event.target.value)} />
        </label>
        <label>
          ניכויים נוספים
          <input type="number" min="0" step="0.01" value={form.deductions} onChange={(event) => update('deductions', event.target.value)} />
        </label>
        <label>
          מקדמות
          <input type="number" min="0" step="0.01" value={form.advances} onChange={(event) => update('advances', event.target.value)} />
        </label>
        <label>
          ניכוי מוסכם
          <input type="number" min="0" step="0.01" value={form.agreedDeductions} onChange={(event) => update('agreedDeductions', event.target.value)} />
        </label>
      </div>

      <div className="payroll-live-total" aria-live="polite">
        <span>סה״כ לתשלום לפי הנתונים שהוזנו</span>
        <strong>{money.format(total)}</strong>
      </div>

      <div className="button-row">
        <button className="primary-button" type="button" disabled={saving} onClick={() => void save()}>
          {saving ? 'שומר…' : version ? 'שמירת עדכון' : 'שמירת רישום'}
        </button>
        <button className="secondary-button" type="button" onClick={() => loadMonth(form.month)}>
          טעינה מחדש
        </button>
      </div>

      {entries.length > 0 ? (
        <div className="detail-list payroll-history">
          {entries.map((entry) => (
            <div key={entry.id}>
              <span>
                <strong>{entry.month}</strong>
                <small>גרסה {entry.version} · {entry.status === 'final' ? 'סופי' : 'טיוטה'}</small>
              </span>
              <strong>{money.format(entry.total)}</strong>
              <button className="secondary-button" type="button" onClick={() => loadMonth(entry.month)}>
                עריכה
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
