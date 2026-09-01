import { render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import type { MvpPayrollRecord } from '../storage/mvp-storage.js';
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
    },
  ]);
});

function renderIntelligence() {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <PayrollIntelligence
        records={[payrollRecord(CLOSED_MONTH), payrollRecord(OPEN_MONTH)]}
        expenses={[]}
        baseSalary={7_000}
        caseId="case-demo-001"
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
