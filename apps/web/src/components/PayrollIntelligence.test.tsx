import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import type { MvpPayrollRecord } from '../storage/mvp-storage.js';
import type { CaseLookupState } from '../sync/use-case-for-legacy-client.js';
import { PayrollIntelligence } from './PayrollIntelligence.js';

// Constitution §16: synthetic data only.
const YEAR = new Date().getUTCFullYear();
const CLOSED_MONTH = `${YEAR}-01`;
const OPEN_MONTH = `${YEAR}-02`;

const mockListCanonicalPayrollCloses = vi.fn();
const mockCloseCanonicalPayrollMonth = vi.fn();

vi.mock('../api/client.js', () => ({
  listCanonicalPayrollCloses: (...args: unknown[]) => mockListCanonicalPayrollCloses(...args),
  closeCanonicalPayrollMonth: (...args: unknown[]) => mockCloseCanonicalPayrollMonth(...args),
}));

function payrollRecord(month: string, overrides: Partial<MvpPayrollRecord> = {}): MvpPayrollRecord {
  return {
    id: `pay-${month}`,
    month,
    baseSalary: 7_000,
    workDays: 26,
    paidSaturdays: 0,
    saturdayPay: 0,
    pocketMoney: 0,
    otherAddition: 0,
    advances: 0,
    agreedDeduction: 0,
    total: 7_000,
    savedAt: `${month}-28T12:00:00.000Z`,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListCanonicalPayrollCloses.mockResolvedValue([
    {
      id: 'close-1',
      payrollReference: `pay-${CLOSED_MONTH}`,
      month: CLOSED_MONTH,
      paymentDate: `${CLOSED_MONTH}-09`,
      paymentMethod: 'bank_transfer',
      total: 7_000,
      baseSalary: 7_000,
      additions: 0,
      deductions: 0,
      closedAt: `${CLOSED_MONTH}-10T08:00:00.000Z`,
      closedBy: 'בועז בדיקה',
    },
  ]);
});

const FOUND: CaseLookupState = { status: 'found', caseId: 'case-demo-001' };

function renderIntelligence(caseLookup: CaseLookupState = FOUND) {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <PayrollIntelligence
        records={[payrollRecord(CLOSED_MONTH), payrollRecord(OPEN_MONTH)]}
        expenses={[]}
        baseSalary={7_000}
        caseLookup={caseLookup}
      />
    </I18nextProvider>,
  );
}

describe('PayrollIntelligence — R5-02 / R5-03 / R5-04', () => {
  /**
   * "Forecast אינו Actual" is a product principle, and until now the only thing
   * separating a twelve-month projection from a recorded cost on this screen
   * was an eyebrow at the top of the card — which is not attached to any of the
   * numbers and does not survive a reader who scans straight to them.
   */
  it('marks every headline forecast figure as a forecast', async () => {
    const { container } = renderIntelligence();
    await waitFor(() => expect(mockListCanonicalPayrollCloses).toHaveBeenCalled());

    const forecastCard = container.querySelector('.forecast-card')!;
    const kinds = Array.from(forecastCard.querySelectorAll('.metric-grid .value-origin')).map(
      (badge) => badge.getAttribute('data-value-origin'),
    );
    expect(kinds).toHaveLength(4);
    expect(new Set(kinds)).toEqual(new Set(['forecast']));
    expect(forecastCard.textContent).toContain('תחזית');
  });

  it('marks the year-to-date aggregates as calculated, never as paid', async () => {
    const { container } = renderIntelligence();
    await waitFor(() => expect(mockListCanonicalPayrollCloses).toHaveBeenCalled());

    const analytics = container.querySelector('.payroll-intelligence')!;
    const kinds = Array.from(analytics.querySelectorAll('.metric-grid .value-origin')).map(
      (badge) => badge.getAttribute('data-value-origin'),
    );
    expect(kinds).toEqual(['calculated', 'calculated', 'calculated']);
  });

  /**
   * R5-03. The distinction that carries the liability: a month with a canonical
   * close is a payment with a date; a month that was merely saved is not.
   */
  it('says שולם only for the month that has a canonical close, and says when', async () => {
    const { container } = renderIntelligence();
    await waitFor(() => expect(mockListCanonicalPayrollCloses).toHaveBeenCalled());

    const rows = Array.from(container.querySelectorAll('.bar-row'));
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector('.value-origin')).toHaveAttribute('data-value-origin', 'paid');
    expect(rows[1]?.querySelector('.value-origin')).toHaveAttribute(
      'data-value-origin',
      'calculated',
    );
    expect(rows[0]?.querySelector('.value-origin-provenance')?.textContent).toContain('מתי:');
    expect(rows[1]?.querySelector('.value-origin-provenance')).toBeNull();
  });

  it('marks the amount waiting to be closed as calculated, not as paid', async () => {
    const { container } = renderIntelligence();
    await waitFor(() => expect(mockListCanonicalPayrollCloses).toHaveBeenCalled());

    const close = container.querySelector('.monthly-close')!;
    const badge = close.querySelector('p .value-origin');
    expect(badge).toHaveAttribute('data-value-origin', 'calculated');
  });

  it('marks each row of the close history as paid, with its payment date', async () => {
    renderIntelligence();
    const history = await screen.findByRole('list', { name: 'היסטוריית סגירות קנונית' });

    const badge = history.querySelector('.value-origin');
    expect(badge).toHaveAttribute('data-value-origin', 'paid');
    expect(badge?.textContent).toContain('שולם');
    expect(badge?.querySelector('.value-origin-provenance')?.textContent).toContain('מתי:');
  });
});

/**
 * The bug: this component used to receive `clientId` (a legacy id) straight
 * from the route and send it to `/cases/:caseId/...`, which is keyed on the
 * canonical `employment_case.id`. Every request 404'd, and with no `.catch`
 * on either the close-history GET or the close-month POST, both failures
 * were invisible — the close-history list looked like a case with nothing to
 * report, and the "אישור שהחודש מוכן וסגירה" button did nothing at all.
 */
describe('PayrollIntelligence — canonical case resolution', () => {
  it('sends the resolved canonical case id, never the legacy id, to the close APIs', async () => {
    renderIntelligence({ status: 'found', caseId: 'case-canonical-777' });
    await waitFor(() =>
      expect(mockListCanonicalPayrollCloses).toHaveBeenCalledWith('case-canonical-777'),
    );

    fireEvent.click(screen.getByRole('button', { name: 'אישור שהחודש מוכן וסגירה' }));
    await waitFor(() => expect(mockCloseCanonicalPayrollMonth).toHaveBeenCalled());
    expect(mockCloseCanonicalPayrollMonth.mock.calls[0]?.[0]).toBe('case-canonical-777');
  });

  it.each([
    ['checking', { status: 'checking' } as CaseLookupState],
    ['none', { status: 'none' } as CaseLookupState],
    ['unavailable', { status: 'unavailable' } as CaseLookupState],
  ])(
    'disables the close button with a stated reason while the case is %s',
    async (_label, lookup) => {
      renderIntelligence(lookup);
      const button = await screen.findByRole('button', { name: 'אישור שהחודש מוכן וסגירה' });
      expect(button).toBeDisabled();
      // A greyed-out button alone reads as "nothing to do here" — the reason
      // has to be visible so a case that has not opened yet is not confused
      // with one whose close silently failed.
      expect(screen.getByRole('status')).toHaveTextContent(/./);
      expect(mockListCanonicalPayrollCloses).not.toHaveBeenCalled();
      fireEvent.click(button);
      expect(mockCloseCanonicalPayrollMonth).not.toHaveBeenCalled();
    },
  );

  /**
   * Constitution §13: a failed close must not destroy what the user typed,
   * and it must not look like a close that happened — the button has to
   * re-enable so the same click can be retried.
   */
  it('reports a failed close, keeps the form intact, and re-enables the button', async () => {
    mockCloseCanonicalPayrollMonth.mockRejectedValueOnce(new Error('network down'));
    renderIntelligence();
    await waitFor(() => expect(mockListCanonicalPayrollCloses).toHaveBeenCalled());

    const dateInput = document.querySelector<HTMLInputElement>('input[type="date"]')!;
    fireEvent.change(dateInput, { target: { value: '2026-03-15' } });
    const button = screen.getByRole('button', { name: 'אישור שהחודש מוכן וסגירה' });
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'אישור שהחודש מוכן וסגירה' })).not.toBeDisabled();
    // The typed payment date must survive the failure.
    expect(dateInput).toHaveValue('2026-03-15');
  });

  /**
   * A failed close-history GET must not be indistinguishable from a real case
   * that has simply never closed a month — both would otherwise render the
   * same "עדיין לא נסגרו חודשים" text.
   */
  it('reports a failed close-history load instead of rendering a silent empty history', async () => {
    mockListCanonicalPayrollCloses.mockRejectedValueOnce(new Error('network down'));
    renderIntelligence();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  /**
   * R5-08. The person who closed the month was written to the database on
   * every close and never returned, so the receipt could say what and when
   * but not who. These two tests pin both halves of the rule: the name is
   * shown when the server resolves it, and nothing is invented when it does
   * not — in particular no raw identifier, which a family cannot read and
   * which would look like data corruption on a money screen.
   */
  it('names the person who closed the month', async () => {
    renderIntelligence();
    await waitFor(() => expect(mockListCanonicalPayrollCloses).toHaveBeenCalled());
    expect(await screen.findByText(/סגר\/ה בועז בדיקה/)).toBeInTheDocument();
  });

  it('omits the person when the server could not resolve one', async () => {
    mockListCanonicalPayrollCloses.mockResolvedValueOnce([
      {
        id: 'close-1',
        payrollReference: `pay-${CLOSED_MONTH}`,
        month: CLOSED_MONTH,
        paymentDate: `${CLOSED_MONTH}-09`,
        paymentMethod: 'bank_transfer',
        total: 7_000,
        baseSalary: 7_000,
        additions: 0,
        deductions: 0,
        closedAt: `${CLOSED_MONTH}-10T08:00:00.000Z`,
        closedBy: null,
      },
    ]);
    renderIntelligence();
    await waitFor(() => expect(mockListCanonicalPayrollCloses).toHaveBeenCalled());
    expect(await screen.findByText(new RegExp(`${CLOSED_MONTH} — הושלם`))).toBeInTheDocument();
    expect(screen.queryByText(/סגר\/ה/)).toBeNull();
  });
});
