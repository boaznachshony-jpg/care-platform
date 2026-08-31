import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import {
  emptyMvpProfile,
  readMvpPayroll,
  saveMvpPayroll,
  saveMvpProfile,
  type MvpPayrollRecord,
} from '../storage/mvp-storage.js';
import { formDraftKey, readFormDraft } from '../storage/form-draft-store.js';
import { PayrollPage, PAYROLL_WIZARD_DRAFT, type PayrollWizardDraft } from './PayrollPage.js';

/**
 * WEB-02. The five-step wizard held ~20 typed fields in `useState` and
 * persisted nothing until the final "אישור ושמירה". Tapping "משימות" in the
 * fixed mobile bottom nav unmounted the page and destroyed a month of entry,
 * silently. Every test here fails without the draft.
 */

const CURRENT_MONTH = new Date().toISOString().slice(0, 7);

function draft() {
  return readFormDraft<PayrollWizardDraft>(PAYROLL_WIZARD_DRAFT);
}

describe('PayrollPage wizard draft', () => {
  beforeEach(() => {
    initI18n();
    localStorage.clear();
    sessionStorage.clear();
    history.replaceState({}, '', '/');
    saveMvpProfile({
      ...emptyMvpProfile,
      // Constitution §16: synthetic data only.
      baseSalary: 7_000,
      salaryEffectiveDate: '2025-01-01',
      saturdayRate: 400,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function enterBaseSalary(value: string) {
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.change(screen.getByLabelText('שכר בסיס'), { target: { value } });
  }

  it('does not write a draft while the form still matches the stored record', async () => {
    render(<PayrollPage />);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(draft()).toBeNull();
  });

  it('autosaves typed values to the caredesk.draft.* namespace', async () => {
    render(<PayrollPage />);
    enterBaseSalary('8500');

    await waitFor(() => expect(draft()).not.toBeNull());
    expect(draft()!.value.values.baseSalary).toBe('8500');
    expect(Object.keys(localStorage).some((key) => key.startsWith('caredesk.draft.'))).toBe(true);
    // ADR-006 clause 5: the frozen MVP workspace payload gains no new key.
    expect(localStorage.getItem(formDraftKey(PAYROLL_WIZARD_DRAFT))).not.toBeNull();
    expect(Object.keys(localStorage).some((key) => key.includes('payroll-wizard.v1'))).toBe(true);
    expect(
      Object.keys(localStorage).filter((key) => key.startsWith('caredesk.mvp.')).length,
    ).toBeGreaterThan(0);
    expect(Object.keys(localStorage).some((key) => key === 'caredesk.mvp.payroll-draft.v1')).toBe(
      false,
    );
  });

  it('restores the typed month after the page is unmounted and mounted again', async () => {
    const first = render(<PayrollPage />);
    enterBaseSalary('8500');
    fireEvent.change(screen.getByLabelText('ימי עבודה'), { target: { value: '22' } });
    await waitFor(() => expect(draft()?.value.values.workDays).toBe('22'));
    first.unmount();

    render(<PayrollPage />);

    // The wizard comes back on the step the user left, with the values intact.
    expect(screen.getByLabelText('שכר בסיס')).toHaveValue(8500);
    expect(screen.getByLabelText('ימי עבודה')).toHaveValue(22);
    expect(screen.getByText(/שוחזרה טיוטה שנשמרה אוטומטית/)).toBeInTheDocument();
  });

  it('discards the draft once the month is committed', async () => {
    render(<PayrollPage />);
    enterBaseSalary('8500');
    fireEvent.change(screen.getByLabelText('ימי עבודה'), { target: { value: '22' } });
    await waitFor(() => expect(draft()).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.click(screen.getByRole('button', { name: 'אישור ושמירה' }));

    expect(readMvpPayroll().some((record) => record.month === CURRENT_MONTH)).toBe(true);
    await waitFor(() => expect(draft()).toBeNull());
  });

  /**
   * WEB-02(b): `onChange={(event) => loadMonth(event.target.value)}` reset
   * every value to the stored/blank record with no confirmation at all.
   */
  it('asks before a month change discards unsaved values, and keeps them on refusal', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<PayrollPage />);
    enterBaseSalary('8500');
    await waitFor(() => expect(draft()).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'חזרה' }));
    fireEvent.change(screen.getByLabelText('חודש שכר'), { target: { value: '2026-02' } });

    expect(confirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    expect(screen.getByLabelText('שכר בסיס')).toHaveValue(8500);
  });

  it('lets the month change through once the user confirms', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PayrollPage />);
    enterBaseSalary('8500');
    await waitFor(() => expect(draft()).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'חזרה' }));
    fireEvent.change(screen.getByLabelText('חודש שכר'), { target: { value: '2026-02' } });

    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    expect(screen.getByLabelText('שכר בסיס')).toHaveValue(7000);
  });

  /**
   * WEB-06: an unguarded `localStorage.setItem` throw inside a React event
   * handler unmounted the whole tree. A full device must produce a message
   * next to the form instead.
   */
  it('reports a refused draft write instead of crashing the page', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      if (key.startsWith('caredesk.draft.')) {
        throw new DOMException('quota', 'QuotaExceededError');
      }
    });
    render(<PayrollPage />);
    enterBaseSalary('8500');

    await waitFor(() => expect(screen.getByText(/לא ניתן לשמור טיוטה במכשיר/)).toBeInTheDocument());
    // The typed value is still on screen — the page did not go blank.
    expect(screen.getByLabelText('שכר בסיס')).toHaveValue(8500);
    setItem.mockRestore();
  });
});

/** WEB-23: the optimistic-lock version was declared, documented and dropped. */
describe('PayrollPage canonical version', () => {
  beforeEach(() => {
    initI18n();
    localStorage.clear();
    sessionStorage.clear();
    history.replaceState({}, '', '/');
    saveMvpProfile({
      ...emptyMvpProfile,
      baseSalary: 7_000,
      salaryEffectiveDate: '2025-01-01',
      saturdayRate: 400,
    });
  });

  it('carries canonicalVersion forward on a re-save', () => {
    // Seed a record that already carries a server optimistic-lock version.
    const seeded: MvpPayrollRecord = {
      id: 'pay-current',
      month: CURRENT_MONTH,
      baseSalary: 7_000,
      workDays: 26,
      paidSaturdays: 0,
      saturdayPay: 0,
      pocketMoney: 0,
      otherAddition: 0,
      medicalInsuranceDeduction: 0,
      housingDeduction: 0,
      advances: 0,
      agreedDeduction: 0,
      total: 7_000,
      canonicalVersion: 4,
      savedAt: '2026-08-01T10:00:00.000Z',
    };
    saveMvpPayroll([seeded]);

    render(<PayrollPage />);
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.change(screen.getByLabelText('שכר בסיס'), { target: { value: '7500' } });
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.click(screen.getByRole('button', { name: 'אישור ושמירה' }));

    expect(
      readMvpPayroll().find((record) => record.month === CURRENT_MONTH)?.canonicalVersion,
    ).toBe(4);
  });
});
