/* eslint-disable no-restricted-syntax -- Hebrew-first pilot surface; i18n extraction follows canonical cutover */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { projectFutureCost } from '@caredesk/application';
import { newIdempotencyKey } from '../../api/idempotency.js';
import {
  agorotFromShekels,
  calculateMonthlyPayroll,
  scaleAgorot,
  shekelsOf,
} from '@caredesk/domain';
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
  readMvpProfile,
  saveMvpEmploymentExpenses,
  saveMvpPayroll,
  type MvpEmploymentExpense,
  type MvpProfile,
} from '../../storage/mvp-storage.js';
import { ValueOrigin, ValueOriginLegend } from '../../components/ValueOrigin.js';
import { formatDateOnly } from '../../format-timestamp.js';

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

/**
 * WEB-04(b). A brand-new month started out with `baseSalary: 0,
 * restDayRate: 0` even when the customer had already told the product both
 * figures during setup (`profile.baseSalary`, `profile.saturdayRate`) — the
 * one MVP field the older `PayrollPage` DOES prefill from, via its own
 * `payrollValues()`. This screen is meant to be the canonical source of
 * truth, which made retyping numbers the customer already gave the more
 * broken of the two screens, not the less.
 *
 * This is used ONLY to seed a month that has no saved server entry: the
 * reset effect below calls it exactly where it used to call `blank()`, never
 * where a `savedEntry` exists. A saved entry always wins over the profile —
 * this function is never consulted once one exists — so prefilling can never
 * overwrite a figure that was already saved.
 */
function prefillFromProfile(profile: MvpProfile): SavePayrollEntryRequest {
  return {
    ...blank(),
    baseSalary: profile.baseSalary ?? 0,
    restDayRate: profile.saturdayRate ?? 0,
  };
}

/**
 * Rest days are asked as their own pair, not as two cells in a sixteen-cell
 * grid.
 *
 * Reported against production: `restDayRate` held 440 and `paidRestDays` held
 * 0, and the four Saturdays worked were typed as a free-text additional payment
 * of ₪440 — where 4 × 440 = ₪1,760 was owed. The month was short by ₪1,320.
 *
 * The formula was never wrong (`calculateMonthlyPayrollAgorot` multiplies the
 * two). The form was: the count sat in one row, the rate in another, nothing on
 * screen showed their product, and "תשלומים נוספים" sat below with an inviting
 * empty box and a total that moved when you typed in it. A screen that makes
 * the right field harder to find than the wrong one produces wrong pay.
 */
const leadingFields = [
  ['baseSalary', 'שכר בסיס'],
  ['workDays', 'ימי עבודה'],
] as const;

const numericFields = [
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
  /**
   * WEB-04(b): which of the two prefilled fields, if any, still hold the
   * profile's figure rather than the server's or the customer's own typing on
   * this screen. Read by the render below to show the honest `ValueOrigin`
   * badge; cleared the instant the customer edits that field, because at that
   * point the value is this screen's own input and no longer the profile's.
   */
  const [prefilledFields, setPrefilledFields] = useState({ baseSalary: false, restDayRate: false });
  const legacy = readMvpPayroll().find((record) => record.month === month);
  const legacyExpenses = readMvpEmploymentExpenses().filter(
    (expense) => expense.amountEntered !== false,
  );
  /**
   * Read the same way `legacy`/`legacyExpenses` above are: directly, once per
   * render, from the path-scoped MVP store. A ref carries the latest value
   * into the reset effect below WITHOUT the effect depending on it — the
   * effect must fire only when the saved-entry identity changes (WEB-04), not
   * on every render, or the same bug this file was already patched for comes
   * back for the profile instead of the entries array.
   */
  const profile = readMvpProfile();
  const profileRef = useRef(profile);
  profileRef.current = profile;
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
  /**
   * Shown beside the two rest-day fields.
   *
   * Root 8: this used to be plain `draft.paidRestDays * draft.restDayRate` —
   * a float multiplication living outside `@caredesk/domain`, on the exact
   * screen whose worked example (above) is a caregiver shorted ₪1,320 because
   * a count and a rate were never multiplied at all. It must still read as
   * "these two numbers, multiplied" rather than a second call into the
   * canonical total, so it stays its own small computation — but it now uses
   * `scaleAgorot`/`agorotFromShekels`, the same "one rounding step" the
   * canonical formula applies to this exact pair
   * (`calculateMonthlyPayrollAgorot`'s `restDayPay`), so the preview shown
   * here and the total the server reconciles cannot round this product
   * differently. Guarded like `calculatedTotal`: the two fields are live text
   * inputs the user may still be mid-edit, and an invalid intermediate value
   * previews as 0 rather than throwing out of render.
   */
  const restDayPay = useMemo(() => {
    if (!Number.isFinite(draft.paidRestDays) || !Number.isFinite(draft.restDayRate)) return 0;
    try {
      return shekelsOf(scaleAgorot(agorotFromShekels(draft.restDayRate), draft.paidRestDays));
    } catch {
      return 0;
    }
  }, [draft.paidRestDays, draft.restDayRate]);
  /**
   * The mistake this screen actually produced, caught rather than prevented.
   *
   * Blocking the save would be wrong — an additional payment may legitimately
   * mention a Saturday (a bonus for one, a reimbursement). So this warns, names
   * the field to use, and leaves the decision with the person, who knows which
   * of the two it is and the form does not.
   */
  const restDaysLookMisfiled =
    draft.paidRestDays === 0 &&
    draft.additionalPayments.some((payment) => /שבת|מנוחה/.test(payment.description));
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

  const savedEntry = entries?.find((entry) => entry.month === month);
  /**
   * WEB-04 (BLOCKER): the draft reset keys on the *identity* of the saved entry
   * for the selected month, never on the `entries` array reference.
   *
   * `refresh()` hands back a brand-new array every time, and `addExpense`,
   * `removeExpense` and `migrateLegacyExpenses` all call it. Depending on
   * `entries` therefore re-ran this effect after any of those; with no saved
   * server entry for the month `found` was `undefined`, the effect called
   * `blank()`, and sixteen numeric fields the user had just typed into the
   * payroll worksheet silently reset to 0 because they had scrolled down and
   * added a planning expense.
   *
   * id + version is the right key: it changes exactly when the saved entry the
   * draft was seeded from actually changes (a save, or a concurrent edit), and
   * not when an unrelated sibling mutation refetches the same data. The
   * `none:` form keeps a month with no saved entry distinct per month, so
   * switching months still resets.
   */
  const savedEntryIdentity = savedEntry
    ? `entry:${savedEntry.id}:${savedEntry.version}`
    : `none:${month}`;
  const savedEntryRef = useRef(savedEntry);
  savedEntryRef.current = savedEntry;
  /** The JSON snapshot of the draft as of the last reset — see `hasUnsavedWork` below. */
  const committedDraftSnapshotRef = useRef('');
  useEffect(() => {
    const found = savedEntryRef.current;
    // WEB-04(b): a saved server entry always wins over the profile — this
    // branch only ever reaches `prefillFromProfile` when there is NO saved
    // entry for the month, i.e. exactly the case `blank()` used to handle.
    const next = found
      ? { ...found, version: found.version }
      : prefillFromProfile(profileRef.current);
    setDraft(next);
    // What "unsaved" means below: the draft this effect just produced, before
    // any keystroke. Recorded as a snapshot rather than compared field-by-field
    // so a future field added to the request shape is covered automatically.
    committedDraftSnapshotRef.current = JSON.stringify(next);
    setPrefilledFields(
      found
        ? { baseSalary: false, restDayRate: false }
        : {
            baseSalary: profileRef.current.baseSalary !== null,
            restDayRate: profileRef.current.saturdayRate !== null,
          },
    );
    setState('idle');
    setError('');
    // Reset all migration state when the selected month changes.
    setMigrationConfirmed(false);
    setMigrationSaved(false);
    setLegacyPurged(false);
  }, [savedEntryIdentity]);
  /**
   * WEB-04(c) / Constitution §13: a screen never destroys a user's input.
   *
   * `PayrollPage.loadMonth` already solved this for the MVP worksheet by
   * comparing a live snapshot of the form against the snapshot it was last
   * reset from; this is the same pattern applied to this screen's sixteen
   * numeric fields. `hasUnsavedWork` is false immediately after the reset
   * effect above runs (the two snapshots are identical) and turns true the
   * moment the customer changes anything, independent of `calculatedTotal`
   * or any other derived value.
   */
  const hasUnsavedWork = useMemo(
    () => JSON.stringify(draft) !== committedDraftSnapshotRef.current,
    [draft],
  );
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
        newIdempotencyKey(),
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
    // These figures now come from the legacy MVP record, not the profile —
    // the "prefilled from setup" badge would be actively misleading here.
    setPrefilledFields({ baseSalary: false, restDayRate: false });
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
        newIdempotencyKey(),
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
      await deleteScenarioExpense(caseId, expense.id, expense.version, newIdempotencyKey());
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
        await createScenarioExpense(caseId, legacyExpenseToScenario(expense), newIdempotencyKey());
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

  // Every numeric component the form writes: the two leading fields, the two
  // rest-day fields, and the rest of the grid. Typed as the union rather than
  // one array's element so no caller can pass a key the draft does not hold.
  type NumericKey =
    | (typeof leadingFields)[number][0]
    | (typeof numericFields)[number][0]
    | 'paidRestDays'
    | 'restDayRate';
  const setNumber = (key: NumericKey, value: string) => {
    setDraft((old) => ({ ...old, [key]: Number(value) }));
    // The field is now the customer's own typing on this screen, not the
    // profile's figure — the badge below must stop claiming otherwise.
    if (key === 'baseSalary' || key === 'restDayRate') {
      setPrefilledFields((current) => ({ ...current, [key]: false }));
    }
  };
  /**
   * WEB-04(c). Changing the month `<input type="month">` used to call
   * `setMonth` directly with no guard at all: the reset effect above then ran
   * on the next render and, for a month with no saved server entry, replaced
   * every one of the sixteen numeric fields with zeros (or now, a fresh
   * profile prefill) — silently discarding whatever the customer had just
   * typed. Same protection `PayrollPage.loadMonth` already applies to the MVP
   * worksheet, applied here to the canonical screen's own month switch.
   */
  function changeMonth(nextMonth: string) {
    if (nextMonth === month) return;
    if (hasUnsavedWork && !window.confirm(t('payments.draftSwitchMonthConfirm'))) return;
    setMonth(nextMonth);
  }
  return (
    <section className="card canonical-payroll" aria-labelledby="canonical-payroll-title">
      <p className="eyebrow">שכר קנוני בתיק</p>
      <h2 id="canonical-payroll-title">רישום שכר חודשי ועלות עתידית</h2>
      <p>הנתונים נשמרים בשרת תחת תיק ההעסקה המאומת בלבד. אין שמירת עובדות שכר בדפדפן.</p>
      {/* R5-01..R5-04. This one card holds a form of typed fields, a total the
          server recomputes, a planning layer, and a twelve-month projection.
          Root 8 is what makes the "מחושב" badge honest here: the server
          recomputes the total and rejects a mismatch, so the label is a
          statement about the server's arithmetic and not about the browser's. */}
      <ValueOriginLegend kinds={['input', 'calculated', 'paid', 'forecast']} />
      {error ? <p role="alert">{error}</p> : null}
      <div className="form-grid">
        <label>
          חודש
          <input type="month" value={month} onChange={(e) => changeMonth(e.target.value)} />
        </label>
        {leadingFields.map(([key, label]) => (
          <label key={key}>
            {label}
            {/* WEB-04(b). Honest about where this figure came from: the customer
                typed it during setup (`profile.baseSalary`), not on this
                screen and not computed by it — hence `kind="input"` rather
                than "calculated", with the same source label the rest of
                this file already uses for user-entered figures. */}
            {key === 'baseSalary' && prefilledFields.baseSalary ? (
              <ValueOrigin
                kind="input"
                provenance={{ source: t('valueOrigin.source.userEntry') }}
              />
            ) : null}
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft[key]}
              onChange={(e) => setNumber(key, e.target.value)}
            />
          </label>
        ))}
        <fieldset className="payroll-rest-days">
          <legend>שבתות וימי מנוחה</legend>
          <label>
            ימי מנוחה בתשלום
            <input
              type="number"
              min="0"
              step="0.5"
              value={draft.paidRestDays}
              onChange={(e) => setNumber('paidRestDays', e.target.value)}
            />
          </label>
          <label>
            תעריף יום מנוחה
            {prefilledFields.restDayRate ? (
              <ValueOrigin
                kind="input"
                provenance={{ source: t('valueOrigin.source.userEntry') }}
              />
            ) : null}
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft.restDayRate}
              onChange={(e) => setNumber('restDayRate', e.target.value)}
            />
          </label>
          {/* The product, spelled out. It is the number the two fields exist to
              produce, and until now it appeared nowhere on the form. */}
          <p className="payroll-rest-days-total" role="status">
            {draft.paidRestDays} × {money.format(draft.restDayRate)} ={' '}
            <strong>{money.format(restDayPay)}</strong>
          </p>
        </fieldset>
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
      {restDaysLookMisfiled ? (
        <p className="payroll-misfiled-warning" role="alert">
          נראה שרשמתם שבתות או ימי מנוחה כתשלום נוסף, ו<strong>ימי מנוחה בתשלום</strong> עומד על 0.
          הזנה בשדה הייעודי מכפילה את מספר הימים בתעריף; תשלום נוסף נספר כסכום אחד בלבד. אם התשלום
          הנוסף אינו עבור ימי מנוחה — אפשר להתעלם מההודעה.
        </p>
      ) : null}
      <p className="payroll-live-total">
        סה״כ מחושב:{' '}
        <strong>{calculatedTotal === null ? '—' : money.format(calculatedTotal)}</strong>{' '}
        {/* R5-02. Every field above is typed; this is the only figure on the
            form nobody typed. */}
        <ValueOrigin kind="calculated" provenance={{ source: t('valueOrigin.source.userEntry') }} />
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
              {/* R5-01. A scenario expense amount is typed by the user and only
                  ever feeds the projection; the amount itself is not derived. */}
              <ValueOrigin
                kind="input"
                provenance={{ source: t('valueOrigin.source.scenarioLayer') }}
              />{' '}
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
        {forecast.months.slice(0, 3).map((item) => {
          /* R5-03/R5-04. The four-way authority order this list already
             implements is exactly the four kinds of number: a canonical close
             is a payment, a saved entry is a calculation, and anything else is
             a projection. The badge states which one, instead of leaving it to
             a phrase whose difference from the phrase above it is one word. */
          const close = closes.find((c) => c.month === item.month);
          return (
            <li key={item.month}>
              <ValueOrigin
                kind={
                  close
                    ? 'paid'
                    : entries?.some((e) => e.month === item.month)
                      ? 'calculated'
                      : 'forecast'
                }
                provenance={
                  close
                    ? {
                        source: t('valueOrigin.source.monthlyClose'),
                        when: formatDateOnly(close.paymentDate) ?? close.paymentDate,
                      }
                    : entries?.some((e) => e.month === item.month)
                      ? { source: t('valueOrigin.source.canonicalPayroll') }
                      : scenarioExpenses.length
                        ? { source: t('valueOrigin.source.scenarioLayer') }
                        : undefined
                }
              />{' '}
              <strong>{item.month}</strong> · {money.format(item.total)} ·{' '}
              {close
                ? 'בפועל סגור'
                : entries?.some((e) => e.month === item.month)
                  ? 'שכר פתוח שהוזן'
                  : scenarioExpenses.length
                    ? 'תחזית כולל שכבת תרחיש'
                    : 'תחזית / לא ידוע'}
            </li>
          );
        })}
      </ul>
      {state === 'loading' ? <p role="status">טוען…</p> : null}
    </section>
  );
}
