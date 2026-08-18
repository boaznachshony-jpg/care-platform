/* eslint-disable no-restricted-syntax -- Hebrew-first pilot surface; i18n extraction follows canonical cutover */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { projectFutureCost } from '@caredesk/application';
import {
  ApiRequestError,
  listCanonicalPayrollCloses,
  listPayrollEntries,
  savePayrollEntry,
  type CanonicalPayrollClose,
  type PayrollEntryResponse,
  type SavePayrollEntryRequest,
} from '../../api/client.js';
import { readMvpPayroll, saveMvpPayroll } from '../../storage/mvp-storage.js';

const money = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' });
const currentMonth = new Date().toISOString().slice(0, 7);
const blank = (): SavePayrollEntryRequest => ({
  baseSalary: 0,
  workDays: 0,
  paidRestDays: 0,
  restDayRate: 0,
  paidHolidays: 0,
  holidayPay: 0,
  vacationDays: 0,
  vacationPay: 0,
  sickDays: 0,
  sickPay: 0,
  otherAbsenceDays: 0,
  employerContributions: 0,
  additionalPayments: [],
  pocketMoney: 0,
  deductions: 0,
  advances: 0,
  agreedDeductions: 0,
  total: 0,
  status: 'draft',
});
const numericFields = [
  ['baseSalary', 'שכר בסיס'],
  ['workDays', 'ימי עבודה'],
  ['paidRestDays', 'ימי מנוחה בתשלום'],
  ['restDayRate', 'תעריף יום מנוחה'],
  ['paidHolidays', 'ימי חג'],
  ['holidayPay', 'דמי חג'],
  ['vacationDays', 'ימי חופשה'],
  ['vacationPay', 'דמי חופשה'],
  ['sickDays', 'ימי מחלה'],
  ['sickPay', 'דמי מחלה'],
  ['otherAbsenceDays', 'ימי היעדרות אחרים'],
  ['employerContributions', 'הפרשות מעסיק'],
  ['pocketMoney', 'דמי כיס'],
  ['deductions', 'ניכויים'],
  ['advances', 'מקדמות'],
  ['agreedDeductions', 'ניכויים מוסכמים'],
] as const;

/** The authenticated EmploymentCase is the sole authority for this canonical payroll surface. */
export function CanonicalPayrollIntelligence({ caseId }: { caseId: string }) {
  const [entries, setEntries] = useState<PayrollEntryResponse[]>();
  const [closes, setCloses] = useState<CanonicalPayrollClose[]>([]);
  const [month, setMonth] = useState(currentMonth);
  const [draft, setDraft] = useState<SavePayrollEntryRequest>(blank);
  const [state, setState] = useState<'idle' | 'loading' | 'saving' | 'saved' | 'conflict'>(
    'loading',
  );
  const [error, setError] = useState('');
  const [migrationConfirmed, setMigrationConfirmed] = useState(false);
  /** True once a legacy→canonical migration save has been confirmed by the server. */
  const [migrationSaved, setMigrationSaved] = useState(false);
  /** True once the legacy localStorage record has been explicitly purged after canonical save. */
  const [legacyPurged, setLegacyPurged] = useState(false);
  const legacy = readMvpPayroll().find((record) => record.month === month);
  const calculatedTotal = useMemo(
    () =>
      draft.baseSalary +
      draft.restDayRate * draft.paidRestDays +
      draft.holidayPay +
      draft.vacationPay +
      draft.sickPay +
      draft.employerContributions +
      draft.additionalPayments.reduce((s, p) => s + p.amount, 0) +
      draft.pocketMoney -
      draft.deductions -
      draft.advances -
      draft.agreedDeductions,
    [draft],
  );
  const refresh = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      const [payroll, closed] = await Promise.all([
        listPayrollEntries(caseId),
        listCanonicalPayrollCloses(caseId),
      ]);
      setEntries(payroll);
      setCloses(closed);
      setState('idle');
    } catch {
      setError('טעינת נתוני השכר הקנוניים נכשלה.');
      setState('idle');
    }
  }, [caseId]);
  useEffect(() => void refresh(), [refresh]);
  useEffect(() => {
    const found = entries?.find((entry) => entry.month === month);
    setDraft(found ? { ...found, version: found.version } : blank());
    setState('idle');
    setError('');
    // Reset all migration state when the selected month changes.
    setMigrationConfirmed(false);
    setMigrationSaved(false);
    setLegacyPurged(false);
  }, [entries, month]);
  const forecast = projectFutureCost({
    startMonth: month,
    expenses: [],
    actuals: closes
      .filter((c) => c.total !== null)
      .map((c) => ({ month: c.month, amount: c.total!, sourceId: c.id })),
    enteredPayroll: (entries ?? []).map((e) => ({
      month: e.month,
      amount: e.total,
      sourceId: e.id,
    })),
  });
  async function save() {
    setState('saving');
    setError('');
    // Capture before the async gap — legacy and migrationConfirmed may change after re-render.
    const isLegacyMigration = migrationConfirmed && !!legacy;
    try {
      await savePayrollEntry(
        caseId,
        month,
        { ...draft, total: calculatedTotal },
        crypto.randomUUID(),
      );
      setState('saved');
      // Canonical persistence proven — unlock the purge step for legacy records.
      if (isLegacyMigration) setMigrationSaved(true);
      await refresh();
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.status === 409) {
        setState('conflict');
        setError('הרשומה השתנתה בשרת. טענו מחדש לפני שמירה נוספת.');
      } else {
        setState('idle');
        setError('שמירת השכר נכשלה. הנתונים המקומיים לא נחשבים מקור סמכות.');
      }
    }
  }

  /**
   * Remove the legacy localStorage record for the current month.
   * Called only after canonical persistence has been proven (migrationSaved === true).
   * Constitution §16: no silent loss — user must explicitly trigger this.
   */
  function purgeLegacy() {
    saveMvpPayroll(readMvpPayroll().filter((r) => r.month !== month));
    setLegacyPurged(true);
  }
  function prepareLegacyMigration() {
    if (!legacy || !migrationConfirmed) return;
    setDraft({
      ...blank(),
      baseSalary: legacy.baseSalary,
      workDays: legacy.workDays,
      paidRestDays: legacy.paidSaturdays,
      restDayRate: legacy.saturdayRate ?? 0,
      paidHolidays: legacy.paidHolidays ?? 0,
      holidayPay: legacy.holidayPay ?? 0,
      vacationDays: legacy.vacationDays ?? 0,
      vacationPay: legacy.vacationPay ?? 0,
      sickDays: legacy.sickDays ?? 0,
      sickPay: legacy.sickPay ?? 0,
      otherAbsenceDays: legacy.absenceDays ?? 0,
      employerContributions: legacy.employerContributions ?? 0,
      additionalPayments: [
        ...(legacy.otherAddition
          ? [{ description: 'תוספת אחרת מרישום MVP', amount: legacy.otherAddition }]
          : []),
        ...(legacy.additionalPayments ?? []).map(({ description, amount }) => ({
          description,
          amount,
        })),
      ],
      pocketMoney: legacy.pocketMoney,
      deductions: (legacy.medicalInsuranceDeduction ?? 0) + (legacy.housingDeduction ?? 0),
      advances: legacy.advances,
      agreedDeductions: legacy.agreedDeduction,
    });
  }
  const setNumber = (key: (typeof numericFields)[number][0], value: string) =>
    setDraft((old) => ({ ...old, [key]: Number(value) }));
  return (
    <section className="card canonical-payroll" aria-labelledby="canonical-payroll-title">
      <p className="eyebrow">שכר קנוני בתיק</p>
      <h2 id="canonical-payroll-title">רישום שכר חודשי ועלות עתידית</h2>
      <p>הנתונים נשמרים בשרת תחת תיק ההעסקה המאומת בלבד. אין שמירת עובדות שכר בדפדפן.</p>
      {error ? <p role="alert">{error}</p> : null}
      <div className="form-grid">
        <label>
          חודש
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        {numericFields.map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft[key]}
              onChange={(e) => setNumber(key, e.target.value)}
            />
          </label>
        ))}
        <label>
          מצב
          <select
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value as 'draft' | 'final' })}
          >
            <option value="draft">טיוטה</option>
            <option value="final">סופי</option>
          </select>
        </label>
        <div className="additional-payments-editor">
          <div className="section-heading">
            <h3>תשלומים נוספים</h3>
            <button
              type="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  additionalPayments: [...draft.additionalPayments, { description: '', amount: 0 }],
                })
              }
            >
              הוספת תשלום
            </button>
          </div>
          {draft.additionalPayments.map((payment, index) => (
            <div className="additional-payment-row" key={index}>
              <label>
                תיאור
                <input
                  value={payment.description}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      additionalPayments: draft.additionalPayments.map((p, i) =>
                        i === index ? { ...p, description: e.target.value } : p,
                      ),
                    })
                  }
                />
              </label>
              <label>
                סכום
                <input
                  type="number"
                  min="0"
                  value={payment.amount}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      additionalPayments: draft.additionalPayments.map((p, i) =>
                        i === index ? { ...p, amount: Number(e.target.value) } : p,
                      ),
                    })
                  }
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    additionalPayments: draft.additionalPayments.filter((_, i) => i !== index),
                  })
                }
              >
                הסרה
              </button>
            </div>
          ))}
        </div>
      </div>
      <p className="payroll-live-total">
        סה״כ מחושב: <strong>{money.format(calculatedTotal)}</strong>
      </p>
      <button
        className="primary-button"
        type="button"
        disabled={state === 'saving' || draft.additionalPayments.some((p) => !p.description.trim())}
        onClick={() => void save()}
      >
        {state === 'saving' ? 'שומר…' : draft.version ? 'עדכון רשומה' : 'יצירת רשומה'}
      </button>{' '}
      {state === 'conflict' ? (
        <button type="button" onClick={() => void refresh()}>
          טעינה מחדש מהשרת
        </button>
      ) : null}
      {state === 'saved' ? <p role="status">השכר נשמר בהצלחה.</p> : null}
      {legacy && !entries?.some((entry) => entry.month === month) ? (
        <aside className="migration-notice" aria-labelledby="legacy-payroll-title">
          <h3 id="legacy-payroll-title">התאמת רישום MVP קיים</h3>
          <p>
            נמצא רישום מקומי לחודש הנבחר. הוא לא משויך אוטומטית. אשרו במפורש שהוא שייך לתיק הנוכחי;
            המקור הישן יישאר ללא שינוי עד ששמירת השרת תוכח.
          </p>
          <label>
            <input
              type="checkbox"
              checked={migrationConfirmed}
              onChange={(event) => setMigrationConfirmed(event.target.checked)}
            />{' '}
            בדקתי שהרישום שייך לתיק זה
          </label>{' '}
          <button type="button" disabled={!migrationConfirmed} onClick={prepareLegacyMigration}>
            הכנת נתונים להעברה
          </button>
        </aside>
      ) : null}
      {migrationSaved && !legacyPurged ? (
        <aside className="reconciliation-cleanup" aria-labelledby="cleanup-title">
          <h3 id="cleanup-title">שלב ב׳ — הסרת רישום מקומי</h3>
          <p>
            הרישום הקנוני נשמר בשרת בהצלחה. הרישום הישן עדיין קיים באחסון המקומי של הדפדפן. הסירו
            אותו כדי למנוע כפיל-כתיבה קבוע.
          </p>
          <button type="button" onClick={purgeLegacy}>
            הסרת הרישום הישן מהדפדפן
          </button>
        </aside>
      ) : null}
      {legacyPurged ? (
        <p role="status" className="reconciliation-done">
          הרישום הישן הוסר — הנתון הקנוני בשרת הוא מקור הסמכות היחיד.
        </p>
      ) : null}
      <h3>עלות עתידית — קדימות מקור סמכות</h3>
      <ul aria-label="תחזית קנונית">
        {forecast.months.slice(0, 3).map((item) => (
          <li key={item.month}>
            <strong>{item.month}</strong> · {money.format(item.total)} ·{' '}
            {closes.some((c) => c.month === item.month)
              ? 'בפועל סגור'
              : entries?.some((e) => e.month === item.month)
                ? 'שכר פתוח שהוזן'
                : 'תחזית / לא ידוע'}
          </li>
        ))}
      </ul>
      {state === 'loading' ? <p role="status">טוען…</p> : null}
    </section>
  );
}
