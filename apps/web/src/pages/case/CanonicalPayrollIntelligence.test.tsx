import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CanonicalPayrollIntelligence } from './CanonicalPayrollIntelligence.js';

// Constitution §16: synthetic data only.
const DEMO_CASE_ID = 'case-demo-001';
const CURRENT_MONTH = new Date().toISOString().slice(0, 7);

const LEGACY_RECORD = {
  id: 'legacy-payroll-001',
  month: CURRENT_MONTH,
  baseSalary: 5000,
  workDays: 22,
  paidSaturdays: 4,
  saturdayPay: 800,
  saturdayRate: 200,
  pocketMoney: 500,
  otherAddition: 0,
  advances: 0,
  agreedDeduction: 0,
  total: 6300,
  savedAt: '2026-08-01T10:00:00.000Z',
};

const LEGACY_EXPENSE = {
  id: 'legacy-expense-001',
  category: 'ביטוח רפואי',
  frequency: 'monthly' as const,
  amount: 250,
  dueDate: '',
  status: 'upcoming' as const,
  note: '',
  savedAt: '2026-08-01T10:00:00.000Z',
};

/**
 * A saved canonical entry with every field the worksheet renders, so the inputs
 * stay controlled. WEB-04 is about what happens to a draft on refetch, and a
 * half-populated fixture would produce React warnings that hide the assertion.
 */
const SAVED_ENTRY = {
  id: 'entry-canonical-001',
  month: CURRENT_MONTH,
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
  status: 'draft' as const,
  version: 1,
};

const SCENARIO_EXPENSE = {
  id: 'scenario-expense-001',
  label: 'ביטוח רפואי',
  amount: 250,
  kind: 'recurring' as const,
  startMonth: CURRENT_MONTH,
  endMonth: null,
  status: 'active' as const,
  version: 1,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
};

const mockListPayrollEntries = vi.fn();
const mockListCanonicalPayrollCloses = vi.fn();
const mockSavePayrollEntry = vi.fn();
const mockListScenarioExpenses = vi.fn();
const mockCreateScenarioExpense = vi.fn();
const mockDeleteScenarioExpense = vi.fn();
const mockReadMvpPayroll = vi.fn();
const mockSaveMvpPayroll = vi.fn();
const mockReadMvpEmploymentExpenses = vi.fn();
const mockSaveMvpEmploymentExpenses = vi.fn();
const mockProjectFutureCost = vi.fn();

vi.mock('../../api/client.js', () => {
  class ApiRequestError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiRequestError,
    listPayrollEntries: (...args: unknown[]) => mockListPayrollEntries(...args),
    listCanonicalPayrollCloses: (...args: unknown[]) => mockListCanonicalPayrollCloses(...args),
    savePayrollEntry: (...args: unknown[]) => mockSavePayrollEntry(...args),
    listScenarioExpenses: (...args: unknown[]) => mockListScenarioExpenses(...args),
    createScenarioExpense: (...args: unknown[]) => mockCreateScenarioExpense(...args),
    deleteScenarioExpense: (...args: unknown[]) => mockDeleteScenarioExpense(...args),
  };
});

vi.mock('../../storage/mvp-storage.js', () => ({
  readMvpPayroll: (...args: unknown[]) => mockReadMvpPayroll(...args),
  saveMvpPayroll: (...args: unknown[]) => mockSaveMvpPayroll(...args),
  readMvpEmploymentExpenses: (...args: unknown[]) => mockReadMvpEmploymentExpenses(...args),
  saveMvpEmploymentExpenses: (...args: unknown[]) => mockSaveMvpEmploymentExpenses(...args),
}));

vi.mock('@caredesk/application', () => ({
  projectFutureCost: (...args: unknown[]) => mockProjectFutureCost(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockListPayrollEntries.mockResolvedValue([]);
  mockListCanonicalPayrollCloses.mockResolvedValue([]);
  mockSavePayrollEntry.mockResolvedValue({ entry: {}, replayed: false });
  mockListScenarioExpenses.mockResolvedValue([]);
  mockCreateScenarioExpense.mockResolvedValue({ expense: SCENARIO_EXPENSE, replayed: false });
  mockDeleteScenarioExpense.mockResolvedValue({
    expense: { ...SCENARIO_EXPENSE, status: 'deleted' },
    replayed: false,
  });
  mockReadMvpPayroll.mockReturnValue([]);
  mockSaveMvpPayroll.mockReturnValue(undefined);
  mockReadMvpEmploymentExpenses.mockReturnValue([]);
  mockSaveMvpEmploymentExpenses.mockReturnValue(undefined);
  mockProjectFutureCost.mockReturnValue({ months: [] });
});

function renderPanel(caseId = DEMO_CASE_ID) {
  return render(<CanonicalPayrollIntelligence caseId={caseId} />);
}

describe('CanonicalPayrollIntelligence — reconciliation', () => {
  it('renders the canonical payroll section', async () => {
    renderPanel();
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /רישום שכר חודשי/ })).toBeInTheDocument(),
    );
  });

  it('shows no migration notice when there is no legacy record', async () => {
    mockReadMvpPayroll.mockReturnValue([]);
    renderPanel();
    await waitFor(() => screen.getByRole('region', { name: /רישום שכר חודשי/ }));
    expect(screen.queryByText(/התאמת רישום MVP קיים/)).not.toBeInTheDocument();
  });

  it('shows migration notice when a legacy record exists for the selected month', async () => {
    mockReadMvpPayroll.mockReturnValue([LEGACY_RECORD]);
    renderPanel();
    await waitFor(() => expect(screen.getByText(/התאמת רישום MVP קיים/)).toBeInTheDocument());
  });

  it('prepare button is disabled until migration checkbox is checked', async () => {
    mockReadMvpPayroll.mockReturnValue([LEGACY_RECORD]);
    renderPanel();
    await waitFor(() => screen.getByText(/התאמת רישום MVP קיים/));
    expect(screen.getByRole('button', { name: /הכנת נתונים להעברה/ })).toBeDisabled();
  });

  it('prepare button enables after checkbox is checked', async () => {
    mockReadMvpPayroll.mockReturnValue([LEGACY_RECORD]);
    renderPanel();
    await waitFor(() => screen.getByText(/התאמת רישום MVP קיים/));
    fireEvent.click(screen.getByRole('checkbox', { name: /בדקתי שהרישום שייך לתיק זה/ }));
    expect(screen.getByRole('button', { name: /הכנת נתונים להעברה/ })).not.toBeDisabled();
  });

  it('cleanup button appears after successful canonical save of a migration', async () => {
    mockReadMvpPayroll.mockReturnValue([LEGACY_RECORD]);
    renderPanel();
    await waitFor(() => screen.getByText(/התאמת רישום MVP קיים/));

    fireEvent.click(screen.getByRole('checkbox', { name: /בדקתי שהרישום שייך לתיק זה/ }));
    fireEvent.click(screen.getByRole('button', { name: /הכנת נתונים להעברה/ }));
    fireEvent.click(screen.getByRole('button', { name: /יצירת רשומה/ }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /הסרת הרישום הישן מהדפדפן/ })).toBeInTheDocument(),
    );
  });

  it('cleanup button does NOT appear after a non-migration save', async () => {
    mockReadMvpPayroll.mockReturnValue([]); // no legacy record
    renderPanel();
    await waitFor(() => screen.getByRole('region', { name: /רישום שכר חודשי/ }));

    fireEvent.click(screen.getByRole('button', { name: /יצירת רשומה/ }));

    await waitFor(() => expect(mockSavePayrollEntry).toHaveBeenCalledOnce());
    expect(
      screen.queryByRole('button', { name: /הסרת הרישום הישן מהדפדפן/ }),
    ).not.toBeInTheDocument();
  });

  it('purge calls saveMvpPayroll filtering out the migrated month', async () => {
    mockReadMvpPayroll.mockReturnValue([LEGACY_RECORD]);
    renderPanel();
    await waitFor(() => screen.getByText(/התאמת רישום MVP קיים/));

    fireEvent.click(screen.getByRole('checkbox', { name: /בדקתי שהרישום שייך לתיק זה/ }));
    fireEvent.click(screen.getByRole('button', { name: /הכנת נתונים להעברה/ }));
    fireEvent.click(screen.getByRole('button', { name: /יצירת רשומה/ }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /הסרת הרישום הישן מהדפדפן/ })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /הסרת הרישום הישן מהדפדפן/ }));

    expect(mockSaveMvpPayroll).toHaveBeenCalledOnce();
    const [savedRecords] = mockSaveMvpPayroll.mock.calls[0] as [(typeof LEGACY_RECORD)[]];
    expect(savedRecords.some((r) => r.month === CURRENT_MONTH)).toBe(false);
  });

  it('shows success message after purge and hides the cleanup button', async () => {
    mockReadMvpPayroll.mockReturnValue([LEGACY_RECORD]);
    renderPanel();
    await waitFor(() => screen.getByText(/התאמת רישום MVP קיים/));

    fireEvent.click(screen.getByRole('checkbox', { name: /בדקתי שהרישום שייך לתיק זה/ }));
    fireEvent.click(screen.getByRole('button', { name: /הכנת נתונים להעברה/ }));
    fireEvent.click(screen.getByRole('button', { name: /יצירת רשומה/ }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /הסרת הרישום הישן מהדפדפן/ })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /הסרת הרישום הישן מהדפדפן/ }));

    await waitFor(() => expect(screen.getByText(/הרישום הישן הוסר/)).toBeInTheDocument());
    expect(
      screen.queryByRole('button', { name: /הסרת הרישום הישן מהדפדפן/ }),
    ).not.toBeInTheDocument();
  });

  it('rollback evidence: legacy record is preserved until purge is explicitly triggered', async () => {
    mockReadMvpPayroll.mockReturnValue([LEGACY_RECORD]);
    renderPanel();
    await waitFor(() => screen.getByText(/התאמת רישום MVP קיים/));

    fireEvent.click(screen.getByRole('checkbox', { name: /בדקתי שהרישום שייך לתיק זה/ }));
    fireEvent.click(screen.getByRole('button', { name: /הכנת נתונים להעברה/ }));
    fireEvent.click(screen.getByRole('button', { name: /יצירת רשומה/ }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /הסרת הרישום הישן מהדפדפן/ })).toBeInTheDocument(),
    );

    // saveMvpPayroll was NOT called — legacy record is still intact
    expect(mockSaveMvpPayroll).not.toHaveBeenCalled();
  });
});

describe('CanonicalPayrollIntelligence — Future Cost canonical inputs', () => {
  it('feeds the projection exclusively from canonical server sources', async () => {
    const entry = {
      id: 'entry-1',
      month: CURRENT_MONTH,
      baseSalary: 6000,
      total: 7350,
      version: 1,
      status: 'draft',
      additionalPayments: [],
    };
    const close = { id: 'close-1', month: '2026-07', total: 7100 };
    mockListPayrollEntries.mockResolvedValue([entry]);
    mockListCanonicalPayrollCloses.mockResolvedValue([close]);
    mockListScenarioExpenses.mockResolvedValue([SCENARIO_EXPENSE]);

    renderPanel();
    await waitFor(() => expect(mockListScenarioExpenses).toHaveBeenCalledWith(DEMO_CASE_ID));

    await waitFor(() => {
      const input = mockProjectFutureCost.mock.calls.at(-1)?.[0] as {
        baseSalary?: number;
        expenses: Array<Record<string, unknown>>;
        actuals: Array<Record<string, unknown>>;
        enteredPayroll: Array<Record<string, unknown>>;
      };
      // Forecast base: the latest canonical payroll worksheet salary.
      expect(input.baseSalary).toBe(6000);
      // Scenario layer: canonical scenario_expense rows, provenance-labelled.
      expect(input.expenses).toEqual([
        expect.objectContaining({
          id: SCENARIO_EXPENSE.id,
          amount: 250,
          frequency: 'monthly',
          startMonth: CURRENT_MONTH,
          source: 'planning_scenario',
        }),
      ]);
      // Actuals: canonical closed months only.
      expect(input.actuals).toEqual([{ month: '2026-07', amount: 7100, sourceId: 'close-1' }]);
      // Entered months: the canonical worksheet.
      expect(input.enteredPayroll).toEqual([
        { month: CURRENT_MONTH, amount: 7350, sourceId: 'entry-1' },
      ]);
    });
    // No compatibility expense value ever reaches the projection.
    expect(mockReadMvpEmploymentExpenses.mock.results.every((r) => r.value.length === 0)).toBe(
      true,
    );
  });

  /**
   * R5-03 / R5-04. The future-cost list already ordered its sources — a close
   * beats an entry beats a projection — but said so in three phrases that
   * differed from one another by a word. The three claims are now marked with
   * the three kinds they actually are, so a month nobody has paid can never be
   * read as one that was.
   */
  it('tells a paid month, a saved month and a projected month apart in the future-cost list', async () => {
    const entry = {
      id: 'entry-1',
      month: '2026-08',
      baseSalary: 6000,
      total: 7350,
      version: 1,
      status: 'draft',
      additionalPayments: [],
    };
    const close = { id: 'close-1', month: '2026-07', total: 7100, paymentDate: '2026-08-09' };
    mockListPayrollEntries.mockResolvedValue([entry]);
    mockListCanonicalPayrollCloses.mockResolvedValue([close]);
    mockListScenarioExpenses.mockResolvedValue([]);
    mockProjectFutureCost.mockReturnValue({
      months: [
        { month: '2026-07', total: 7100 },
        { month: '2026-08', total: 7350 },
        { month: '2026-09', total: 7000 },
      ],
    });

    renderPanel();
    const list = await screen.findByRole('list', { name: 'תחזית קנונית' });

    const kinds = Array.from(list.querySelectorAll('.value-origin')).map((badge) =>
      badge.getAttribute('data-value-origin'),
    );
    expect(kinds).toEqual(['paid', 'calculated', 'forecast']);
    // R5-05: the close record carries a payment date, so the paid row can say
    // when. The other two carry no date and claim none.
    expect(list.querySelectorAll('.value-origin-provenance')).toHaveLength(2);
  });

  it('creates a canonical scenario expense from the planning form', async () => {
    renderPanel();
    await waitFor(() => screen.getByRole('region', { name: /רישום שכר חודשי/ }));

    fireEvent.change(screen.getByLabelText('תיאור ההוצאה'), { target: { value: 'ביטוח רפואי' } });
    fireEvent.change(screen.getByLabelText('סכום חודשי'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוספת הוצאת תרחיש' }));

    await waitFor(() => expect(mockCreateScenarioExpense).toHaveBeenCalledOnce());
    const [caseId, input] = mockCreateScenarioExpense.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(caseId).toBe(DEMO_CASE_ID);
    expect(input).toMatchObject({ label: 'ביטוח רפואי', amount: 250, kind: 'recurring' });
  });

  // --- WEB-04 (BLOCKER): the worksheet is not wiped by a sibling refetch ---

  it('keeps a typed payroll worksheet when a scenario expense is added below it', async () => {
    renderPanel();
    await waitFor(() => screen.getByRole('region', { name: /רישום שכר חודשי/ }));

    // The user fills in the month's worksheet…
    fireEvent.change(screen.getByLabelText('שכר בסיס'), { target: { value: '5000' } });
    expect(screen.getByLabelText('שכר בסיס')).toHaveValue(5000);

    // …then scrolls down and adds a planning expense. addExpense calls
    // refresh(), which hands setEntries a brand-new array. Keying the draft
    // reset on that array reference called blank() and reset every number the
    // user had just typed, silently and with no message.
    fireEvent.change(screen.getByLabelText('תיאור ההוצאה'), { target: { value: 'ביטוח רפואי' } });
    fireEvent.change(screen.getByLabelText('סכום חודשי'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוספת הוצאת תרחיש' }));

    await waitFor(() => expect(mockCreateScenarioExpense).toHaveBeenCalledOnce());
    // Two refetches have now completed; the worksheet still holds the entry.
    await waitFor(() => expect(mockListPayrollEntries).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('שכר בסיס')).toHaveValue(5000);
  });

  it('still reseeds the draft when the saved entry for the month actually changes', async () => {
    // The reset must not simply be disabled: a save, or a concurrent edit,
    // changes the entry's version and the draft has to follow the server.
    const saved = { ...SAVED_ENTRY, baseSalary: 5000, version: 1 };
    mockListPayrollEntries.mockResolvedValueOnce([saved]);
    mockListPayrollEntries.mockResolvedValue([{ ...saved, baseSalary: 7000, version: 2 }]);

    renderPanel();
    await waitFor(() => expect(screen.getByLabelText('שכר בסיס')).toHaveValue(5000));

    fireEvent.change(screen.getByLabelText('תיאור ההוצאה'), { target: { value: 'ביטוח רפואי' } });
    fireEvent.change(screen.getByLabelText('סכום חודשי'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוספת הוצאת תרחיש' }));

    await waitFor(() => expect(screen.getByLabelText('שכר בסיס')).toHaveValue(7000));
  });

  it('soft deletes a scenario expense through the canonical API', async () => {
    mockListScenarioExpenses.mockResolvedValue([SCENARIO_EXPENSE]);
    renderPanel();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /הסרת הוצאת תרחיש/ })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /הסרת הוצאת תרחיש/ }));

    await waitFor(() =>
      expect(mockDeleteScenarioExpense).toHaveBeenCalledWith(
        DEMO_CASE_ID,
        SCENARIO_EXPENSE.id,
        SCENARIO_EXPENSE.version,
        expect.any(String),
      ),
    );
  });
});

describe('CanonicalPayrollIntelligence — legacy expense reconciliation', () => {
  it('shows no expense migration notice without legacy expenses', async () => {
    renderPanel();
    await waitFor(() => screen.getByRole('region', { name: /רישום שכר חודשי/ }));
    expect(screen.queryByText(/התאמת הוצאות MVP קיימות/)).not.toBeInTheDocument();
  });

  it('gates the legacy expense migration behind an explicit confirmation', async () => {
    mockReadMvpEmploymentExpenses.mockReturnValue([LEGACY_EXPENSE]);
    renderPanel();
    await waitFor(() => expect(screen.getByText(/התאמת הוצאות MVP קיימות/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /העברת ההוצאות לשרת/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: /בדקתי שההוצאות שייכות לתיק זה/ }));
    expect(screen.getByRole('button', { name: /העברת ההוצאות לשרת/ })).not.toBeDisabled();
  });

  it('unlocks the purge step only after canonical persistence is proven, then purges', async () => {
    mockReadMvpEmploymentExpenses.mockReturnValue([LEGACY_EXPENSE]);
    renderPanel();
    await waitFor(() => screen.getByText(/התאמת הוצאות MVP קיימות/));

    expect(
      screen.queryByRole('button', { name: /הסרת ההוצאות הישנות מהדפדפן/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /בדקתי שההוצאות שייכות לתיק זה/ }));
    fireEvent.click(screen.getByRole('button', { name: /העברת ההוצאות לשרת/ }));

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /הסרת ההוצאות הישנות מהדפדפן/ }),
      ).toBeInTheDocument(),
    );
    expect(mockCreateScenarioExpense).toHaveBeenCalledWith(
      DEMO_CASE_ID,
      expect.objectContaining({ label: 'ביטוח רפואי', amount: 250, kind: 'recurring' }),
      expect.any(String),
    );
    // Rollback evidence: the legacy blob is intact until the explicit purge.
    expect(mockSaveMvpEmploymentExpenses).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /הסרת ההוצאות הישנות מהדפדפן/ }));

    await waitFor(() => expect(screen.getByText(/ההוצאות הישנות הוסרו/)).toBeInTheDocument());
    expect(mockSaveMvpEmploymentExpenses).toHaveBeenCalledOnce();
    const [remaining] = mockSaveMvpEmploymentExpenses.mock.calls[0] as [Array<{ id: string }>];
    expect(remaining.some((expense) => expense.id === LEGACY_EXPENSE.id)).toBe(false);
  });

  it('keeps the legacy blob untouched when the server migration fails', async () => {
    mockReadMvpEmploymentExpenses.mockReturnValue([LEGACY_EXPENSE]);
    mockCreateScenarioExpense.mockRejectedValue(new Error('offline'));
    renderPanel();
    await waitFor(() => screen.getByText(/התאמת הוצאות MVP קיימות/));

    fireEvent.click(screen.getByRole('checkbox', { name: /בדקתי שההוצאות שייכות לתיק זה/ }));
    fireEvent.click(screen.getByRole('button', { name: /העברת ההוצאות לשרת/ }));

    await waitFor(() => expect(screen.getByText(/העברת ההוצאות לשרת נכשלה/)).toBeInTheDocument());
    expect(mockSaveMvpEmploymentExpenses).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: /הסרת ההוצאות הישנות מהדפדפן/ }),
    ).not.toBeInTheDocument();
  });
  // --- Rest days: the pair, and the mistake it used to invite --------------
  //
  // Production, September 2026: rate 440, count 0, and four Saturdays typed as
  // an additional payment of 440 — where 4 × 440 = 1,760 was owed. The formula
  // was right and the form was wrong, so these tests are about the form.

  it('prints the product of the two rest-day fields', async () => {
    renderPanel();
    await waitFor(() => screen.getByLabelText('ימי מנוחה בתשלום'));

    fireEvent.change(screen.getByLabelText('ימי מנוחה בתשלום'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('תעריף יום מנוחה'), { target: { value: '440' } });

    // The number nobody typed, shown beside the two that were.
    expect(screen.getByText(/1,760/)).toBeInTheDocument();
  });

  it('warns when Saturdays were typed as an additional payment instead', async () => {
    renderPanel();
    await waitFor(() => screen.getByLabelText('ימי מנוחה בתשלום'));

    fireEvent.click(screen.getByRole('button', { name: 'הוספת תשלום' }));
    const [description] = screen.getAllByLabelText('תיאור');
    fireEvent.change(description!, { target: { value: '4 שבתות' } });

    expect(screen.getByRole('alert')).toHaveTextContent(/ימי מנוחה בתשלום/);
  });

  it('stops warning once the rest days are recorded in their own field', async () => {
    renderPanel();
    await waitFor(() => screen.getByLabelText('ימי מנוחה בתשלום'));

    fireEvent.click(screen.getByRole('button', { name: 'הוספת תשלום' }));
    const [description] = screen.getAllByLabelText('תיאור');
    fireEvent.change(description!, { target: { value: '4 שבתות' } });
    fireEvent.change(screen.getByLabelText('ימי מנוחה בתשלום'), { target: { value: '4' } });

    // An additional payment may legitimately mention a Saturday; the warning is
    // about the count being zero, not about the word.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
