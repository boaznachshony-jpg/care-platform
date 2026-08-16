/* eslint-disable no-restricted-syntax -- Hebrew-first pilot surface; i18n extraction follows canonical cutover */
import { useEffect, useRef, useState } from 'react';
import {
  closeCanonicalPayrollMonth,
  listCanonicalPayrollCloses,
  type CanonicalPayrollClose,
} from '../../api/client.js';

const money = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' });
const currentMonth = new Date().toISOString().slice(0, 7);

/** Canonical close/history view. Forecast assumptions remain deliberately transient. */
export function CanonicalPayrollIntelligence({ caseId }: { caseId: string }) {
  const [closes, setCloses] = useState<CanonicalPayrollClose[]>();
  const [error, setError] = useState('');
  const replayKey = useRef(crypto.randomUUID());
  const [draft, setDraft] = useState({
    payrollReference: '',
    month: currentMonth,
    paymentDate: new Date().toISOString().slice(0, 10),
    paymentMethod: 'bank_transfer' as const,
    baseSalary: 0,
    additions: 0,
    deductions: 0,
  });
  const total = draft.baseSalary + draft.additions - draft.deductions;
  const refresh = () =>
    listCanonicalPayrollCloses(caseId)
      .then(setCloses)
      .catch(() => setError('טעינת נתוני הסגירה נכשלה.'));
  // refresh is intentionally recreated with the current authenticated case id.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void refresh(), [caseId]);

  async function closeMonth() {
    setError('');
    try {
      await closeCanonicalPayrollMonth(caseId, { ...draft, total }, replayKey.current);
      await refresh();
    } catch {
      setError('הסגירה נדחתה. בדקו את הנתונים וההרשאה.');
    }
  }

  return (
    <section className="card canonical-payroll" aria-labelledby="canonical-payroll-title">
      <p className="eyebrow">Product Intelligence קנוני</p>
      <h2 id="canonical-payroll-title">סגירת חודש ועלות עתידית</h2>
      <p>היסטוריית הביצוע נטענת משרת התיק. התחזית היא כלי תכנון בלבד ואינה ייעוץ שכר או משפטי.</p>
      {error ? <p role="alert">{error}</p> : null}
      <div className="form-grid">
        <label>
          חודש
          <input
            type="month"
            value={draft.month}
            onChange={(e) => setDraft({ ...draft, month: e.target.value })}
          />
        </label>
        <label>
          אסמכתת שכר
          <input
            value={draft.payrollReference}
            onChange={(e) => setDraft({ ...draft, payrollReference: e.target.value })}
          />
        </label>
        <label>
          שכר בסיס
          <input
            type="number"
            min="0"
            value={draft.baseSalary}
            onChange={(e) => setDraft({ ...draft, baseSalary: Number(e.target.value) })}
          />
        </label>
        <label>
          תוספות
          <input
            type="number"
            min="0"
            value={draft.additions}
            onChange={(e) => setDraft({ ...draft, additions: Number(e.target.value) })}
          />
        </label>
        <label>
          קיזוזים
          <input
            type="number"
            min="0"
            value={draft.deductions}
            onChange={(e) => setDraft({ ...draft, deductions: Number(e.target.value) })}
          />
        </label>
        <label>
          תאריך תשלום
          <input
            type="date"
            value={draft.paymentDate}
            onChange={(e) => setDraft({ ...draft, paymentDate: e.target.value })}
          />
        </label>
      </div>
      <p>
        סה״כ: <strong>{money.format(total)}</strong>
      </p>
      <button
        className="primary-button"
        type="button"
        disabled={!draft.payrollReference.trim() || total <= 0}
        onClick={() => void closeMonth()}
      >
        סגירה קנונית
      </button>
      <h3>בפועל לעומת תחזית</h3>
      {closes === undefined ? (
        <p>טוען…</p>
      ) : closes.length ? (
        <ul>
          {closes.map((close) => (
            <li key={close.id}>
              <strong>
                {close.month} — {close.total === null ? 'UNKNOWN' : 'ACTUAL'}
              </strong>{' '}
              · {close.total === null ? 'לא ידוע' : money.format(close.total)} · שולם{' '}
              {close.paymentDate}
            </li>
          ))}
        </ul>
      ) : (
        <p>אין חודשים סגורים; עלויות עתידיות הן UNKNOWN עד להזנת הנחות מפורשות.</p>
      )}
    </section>
  );
}
