/* eslint-disable no-restricted-syntax -- Hebrew-first pilot surface; i18n extraction follows canonical cutover */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { projectFutureCost } from '@caredesk/application';
import { calculateMonthlyPayroll } from '@caredesk/domain';
import {
  ApiRequestError,
  createScenarioExpense,
  deleteScenarioExpense,
  listCanonicalPayrollCloses,
  listPayrollEntries,
  listScenarioExpenses,
  savePayrollEntry,
  type CanonicalPayrollClose,
  type PayrollEntryResponse,
  type SavePayrollEntryRequest,
  type SaveScenarioExpenseRequest,
  type ScenarioExpenseResponse,
} from '../../api/client.js';
import {
  readMvpEmploymentExpenses,
  readMvpPayroll,
  saveMvpEmploymentExpenses,
  saveMvpPayroll,
  type MvpEmploymentExpense,
} from '../../storage/mvp-storage.js';

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

const blankExpense = (): SaveScenarioExpenseRequest => ({
  label: '',
  amount: 0,
  kind: 'recurring',
  startMonth: currentMonth,
  endMonth: null,
});
/** One-time migration read: map a legacy MVP expense onto a canonical scenario expense. */
function legacyExpenseToScenario(expense: MvpEmploymentExpense): SaveScenarioExpenseRequest {
  const dueMonth = /^\d{4}-(0[1-9]|1[0-2])/.test(expense.dueDate)
    ? expense.dueDate.slice(0, 7)
    : currentMonth;
  return expense.frequency === 'monthly'
    ? {
        label: expense.category,
        amount: expense.amount,
        kind: 'recurring',
        startMonth: currentMonth,
        endMonth: null,
      }
    : {
        label: expense.category,
        amount: expense.amount,
        kind: 'one_time',
        startMonth: dueMonth,
        endMonth: null,
      };
}

/** The authenticated EmploymentCase is the sole authority for this canonical payroll surface. */
export function CanonicalPayrollIntelligence({ caseId }: { caseId: string }) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<PayrollEntryResponse[]>();
  const [closes, setCloses] = useState<CanonicalPayrollClose[]>([]);
  const [scenarioExpenses, setScenarioExpenses] = useState<ScenarioExpenseResponse[]>([]);
  const [month, setMonth] = useState(currentMonth);
  const [draft, setDraft] = useState<SavePayrollEntryRequest>(blank);
  const [expenseDraft, setExpenseDraft] = useState<SaveScenarioExpenseRequest>(blankExpense);
  const [state, setState] = useState<'idle' | 'loading' | 'saving' | 'saved' | 'conflict'>(
    'loading',
  );
  const [error, setError] = useState('');
  const [expenseError, setExpenseError] = useState('');
  const [migrationConfirmed, setMigrationConfirmed] = useState(false);
  /** True once a legacy→canonical migration save has been confirmed by the server. */
  const [migrationSaved, setMigrationSaved] = useState(false);
  /** True once the legacy localStorage record has been explicitly purged after canonical save. */
  const [legacyPurged, setLegacyPurged] = useState(false);
  const [expenseMigrationConfirmed, setExpenseMigrationConfirmed] = useState(false);
  /** Ids of legacy expenses whose canonical persistence has been confirmed by the server. */
  const [migratedExpenseIds, setMigratedExpenseIds] = useState<string[]>([]);
  const [expensesPurged, setExpensesPurged] = useState(false);
  const legacy = readMvpPayroll().find((record) => record.month === month);
  const legacyExpenses = readMvpEmploymentExpenses().filter(
    (expense) => expense.amountEntered !== false,
  );
  /**
   * Root 4 (DOM-02): the same function the server recomputes with.
   *
   * This used to be an inline sum, and it disagreed with the other client-side
   * implementation in `apps/web/src/payroll-calculation.ts` about the sign of
   * `pocketMoney` — money already handed to the caregiver during the month was
   * ADDED here and SUBTRACTED there. Neither was checked by anything. Now there
   * is one formula, in `@caredesk/domain`, and a total this screen produces is
   * a total the server will accept.
   */
  const calculatedTotal = useMemo(() => {
    try {
      return calculateMonthlyPayroll(draft).total;
    } catch {
      // A component the domain refuses (DOM-07: non-finite or negative) cannot
      // produce a total. Saving is blocked below rather than sending a number
      // the server would reject with 422.
      return null;
    }
  }, [draft]);
  const refresh = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      const [payroll, closed, expenses] = await Promise.all([
        listPayrollEntries(caseId),
        listCanonicalPayrollCloses(caseId),
        listScenarioExpenses(caseId),
      ]);
      setEntries(payroll);
      setCloses(closed);
      setScenarioExpenses(expenses);
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
  /**
   * All projection inputs are canonical: closed months (actuals), the payroll
   * worksheet (forecast base + entered months) and scenario_expense rows (the
   * planning-only FORECAST layer). No compatibility-blob value is read here.
   */
  const forecast = projectFutureCost({
    startMonth: month,
    // The latest canonical worksheet salary repeats as the forecast base.
    baseSalary: entries?.[0]?.baseSalary,
    expenses: scenarioExpenses.map((expense) => ({
      id: expense.id,
      label: expense.label,
      amount: expense.amount,
      frequency: expense.kind === 'recurring' ? ('monthly' as const) : ('one_time' as const),
      ...(expense.kind === 'one_time' ? { dueDate: `${expense.startMonth}-01` } : {}),
      startMonth: expense.startMonth,
      ...(expense.endMonth ? { endMonth: expense.endMonth } : {}),
      source: 'planning_scenario' as const,
    })),
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
    if (calculatedTotal === null) {
      setError('אחד מרכיבי השכר אינו מספר תקין. תקנו אותו לפני השמירה.');
      return;
    }
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
  async function addExpense() {
    setExpenseError('');
    if (!expenseDraft.label.trim() || expenseDraft.amount < 0) {
      setExpenseError('נדרשים תיאור וסכום תקין להוצאת תרחיש.');
      return;
    }
    try {
      await createScenarioExpense(
        caseId,
        {
          ...expenseDraft,
          label: expenseDraft.label.trim(),
          endMonth: expenseDraft.kind === 'recurring' ? expenseDraft.endMonth : null,
        },
        crypto.randomUUID(),
      );
      setExpenseDraft(blankExpense());
      await refresh();
    } catch {
      setExpenseError('שמירת הוצאת התרחיש נכשלה.');
    }
  }

  async function removeExpense(expense: ScenarioExpenseResponse) {
    setExpenseError('');
    try {
      await deleteScenarioExpense(caseId, expense.id, expense.version, crypto.randomUUID());
      await refresh();
    } catch {
      setExpenseError('הסרת הוצאת התרחיש נכשלה.');
    }
  }

  /**
   * One-time legacy→canonical expense migration (the PR #55 payroll pattern):
   * server persistence must be proven before the purge step unlocks, and the
   * legacy blob is only removed by an explicit user action (Constitution §16).
   */
  async function migrateLegacyExpenses() {
    if (!expenseMigrationConfirmed || legacyExpenses.length === 0) return;
    setExpenseError('');
    try {
      const migrated: string[] = [];
      for (const expense of legacyExpenses) {
        await createScenarioExpense(caseId, legacyExpenseToScenario(expense), crypto.randomUUID());
        migrated.push(expense.id);
      }
      setMigratedExpenseIds(migrated);
      await refresh();
    } catch {
      setExpenseError('העברת ההוצאות לשרת נכשלה. הרישום המקומי לא נמחק.');
    }
  }

  function purgeLegacyExpenses() {
    saveMvpEmploymentExpenses(
      readMvpEmploymentExpenses().filter((expense) => !migratedExpenseIds.includes(expense.id)),
    );
    setExpensesPurged(true);
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
        סה״כ מחושב:{' '}
        <strong>{calculatedTotal === null ? '—' : money.format(calculatedTotal)}</strong>
      </p>
      <p className="legal-note">{t('liability.calculation')}</p>
      <button
        className="primary-button"
        type="button"
        disabled={
          state === 'saving' ||
          calculatedTotal === null ||
          draft.additionalPayments.some((p) => !p.description.trim())
        }
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
      <h3 id="scenario-expenses-title">הוצאות תרחיש — שכבת תכנון קנונית</h3>
      <p>
        הוצאות התרחיש נשמרות בשרת תחת התיק ומוצגות בתחזית כשכבת תכנון בלבד. הן אינן משנות רשומות שכר
        קנוניות.
      </p>
      {expenseError ? <p role="alert">{expenseError}</p> : null}
      {scenarioExpenses.length ? (
        <ul aria-labelledby="scenario-expenses-title">
          {scenarioExpenses.map((expense) => (
            <li key={expense.id}>
              <strong>{expense.label}</strong> · {money.format(expense.amount)} ·{' '}
              {expense.kind === 'recurring'
                ? `חודשי מ-${expense.startMonth}${expense.endMonth ? ` עד ${expense.endMonth}` : ''}`
                : `חד-פעמי ב-${expense.startMonth}`}{' '}
              <button type="button" onClick={() => void removeExpense(expense)}>
                הסרת הוצאת תרחיש
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>לא נשמרו הוצאות תרחיש קנוניות.</p>
      )}
      <div className="form-grid scenario-expense-form">
        <label>
          תיאור ההוצאה
          <input
            value={expenseDraft.label}
            onChange={(e) => setExpenseDraft({ ...expenseDraft, label: e.target.value })}
          />
        </label>
        <label>
          סכום חודשי
          <input
            type="number"
            min="0"
            step="0.01"
            value={expenseDraft.amount}
            onChange={(e) => setExpenseDraft({ ...expenseDraft, amount: Number(e.target.value) })}
          />
        </label>
        <label>
          סוג הוצאה
          <select
            value={expenseDraft.kind}
            onChange={(e) =>
              setExpenseDraft({
                ...expenseDraft,
                kind: e.target.value as 'recurring' | 'one_time',
                endMonth: null,
              })
            }
          >
            <option value="recurring">חוזרת (חודשית)</option>
            <option value="one_time">חד-פעמית</option>
          </select>
        </label>
        <label>
          מחודש
          <input
            type="month"
            value={expenseDraft.startMonth}
            onChange={(e) => setExpenseDraft({ ...expenseDraft, startMonth: e.target.value })}
          />
        </label>
        {expenseDraft.kind === 'recurring' ? (
          <label>
            עד חודש (רשות)
            <input
              type="month"
              value={expenseDraft.endMonth ?? ''}
              onChange={(e) =>
                setExpenseDraft({ ...expenseDraft, endMonth: e.target.value || null })
              }
            />
          </label>
        ) : null}
      </div>
      <button type="button" onClick={() => void addExpense()}>
        הוספת הוצאת תרחיש
      </button>
      {legacyExpenses.length > 0 && migratedExpenseIds.length === 0 ? (
        <aside className="migration-notice" aria-labelledby="legacy-expenses-title">
          <h3 id="legacy-expenses-title">התאמת הוצאות MVP קיימות</h3>
          <p>
            נמצאו {legacyExpenses.length} הוצאות שמורות באחסון המקומי. הן לא משויכות אוטומטית. אשרו
            במפורש שהן שייכות לתיק הנוכחי; המקור הישן יישאר ללא שינוי עד ששמירת השרת תוכח.
          </p>
          <label>
            <input
              type="checkbox"
              checked={expenseMigrationConfirmed}
              onChange={(event) => setExpenseMigrationConfirmed(event.target.checked)}
            />{' '}
            בדקתי שההוצאות שייכות לתיק זה
          </label>{' '}
          <button
            type="button"
            disabled={!expenseMigrationConfirmed}
            onClick={() => void migrateLegacyExpenses()}
          >
            העברת ההוצאות לשרת
          </button>
        </aside>
      ) : null}
      {migratedExpenseIds.length > 0 && !expensesPurged ? (
        <aside className="reconciliation-cleanup" aria-labelledby="expense-cleanup-title">
          <h3 id="expense-cleanup-title">שלב ב׳ — הסרת הוצאות מקומיות</h3>
          <p>
            ההוצאות נשמרו בשרת בהצלחה. הרישום הישן עדיין קיים באחסון המקומי של הדפדפן. הסירו אותו
            כדי למנוע כפיל-כתיבה קבוע.
          </p>
          <button type="button" onClick={purgeLegacyExpenses}>
            הסרת ההוצאות הישנות מהדפדפן
          </button>
        </aside>
      ) : null}
      {expensesPurged ? (
        <p role="status" className="reconciliation-done">
          ההוצאות הישנות הוסרו — הוצאות התרחיש בשרת הן מקור הסמכות היחיד.
        </p>
      ) : null}
      <h3>עלות עתידית — קדימות מקור סמכות</h3>
      <p className="legal-note">{t('liability.forecast')}</p>
      <ul aria-label="תחזית קנונית">
        {forecast.months.slice(0, 3).map((item) => (
          <li key={item.month}>
            <strong>{item.month}</strong> · {money.format(item.total)} ·{' '}
            {closes.some((c) => c.month === item.month)
              ? 'בפועל סגור'
              : entries?.some((e) => e.month === item.month)
                ? 'שכר פתוח שהוזן'
                : scenarioExpenses.length
                  ? 'תחזית כולל שכבת תרחיש'
                  : 'תחזית / לא ידוע'}
          </li>
        ))}
      </ul>
      {state === 'loading' ? <p role="status">טוען…</p> : null}
    </section>
  );
}
