import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../api/client.js';
import type {
  MvpEmploymentExpense,
  MvpNationalInsuranceReportMonth,
} from '../storage/mvp-storage.js';

const sync = vi.hoisted(() => ({ hydrated: false }));
vi.mock('../storage/workspace-sync.js', () => ({
  WORKSPACE_SYNC_CHANGED: 'caredesk:workspace-sync-changed',
  hasHydratedWorkspaceThisSession: () => sync.hydrated,
}));

import {
  copyNationalInsuranceReports,
  useNationalInsuranceReportCopy,
} from './national-insurance-report-copy.js';

const CASE_ID = 'case-ni-001';

// Synthetic wages only.
const LINES: MvpNationalInsuranceReportMonth[] = [
  { month: '2026-07', employed: true, wage: 6000, ratePercent: 3.55, amount: 213 },
  { month: '2026-08', employed: true, wage: 6000, ratePercent: 3.55, amount: 213 },
  { month: '2026-09', employed: false, wage: 0, ratePercent: 3.55, amount: 0 },
];

function expense(id: string, overrides: Partial<MvpEmploymentExpense> = {}): MvpEmploymentExpense {
  return {
    id,
    category: 'ביטוח לאומי',
    frequency: 'quarterly',
    amount: 426,
    dueDate: '2026-10-15',
    status: 'upcoming',
    note: '',
    savedAt: '2026-10-17T10:00:00.000Z',
    nationalInsuranceMonths: LINES,
    ...overrides,
  };
}

const ok = () => vi.fn().mockResolvedValue({ report: {}, outcome: 'created' });

beforeEach(() => {
  localStorage.clear();
  sync.hydrated = false;
});

describe('copyNationalInsuranceReports (R5-09 stage 2)', () => {
  it('sends each payment that has report lines, one at a time, exactly as saved', async () => {
    const importOne = ok();
    const outcome = await copyNationalInsuranceReports(
      CASE_ID,
      [expense('ni-q3'), expense('manual-no-lines', { nationalInsuranceMonths: undefined })],
      importOne,
    );
    expect(outcome).toEqual({ attempted: 1, copied: 1, failed: 0 });
    expect(importOne).toHaveBeenCalledOnce();
    expect(importOne).toHaveBeenCalledWith(CASE_ID, {
      legacyExpenseId: 'ni-q3',
      dueDate: '2026-10-15',
      months: LINES,
    });
  });

  it('does not send an unchanged payment again, and sends a corrected one', async () => {
    const importOne = ok();
    await copyNationalInsuranceReports(CASE_ID, [expense('ni-q3')], importOne);
    const again = await copyNationalInsuranceReports(CASE_ID, [expense('ni-q3')], importOne);
    expect(again.attempted).toBe(0);
    expect(importOne).toHaveBeenCalledTimes(1);

    const corrected = [{ ...LINES[0]!, wage: 6400, amount: 227.2 }, LINES[1]!, LINES[2]!];
    const after = await copyNationalInsuranceReports(
      CASE_ID,
      [expense('ni-q3', { nationalInsuranceMonths: corrected })],
      importOne,
    );
    expect(after).toEqual({ attempted: 1, copied: 1, failed: 0 });
    expect(importOne).toHaveBeenLastCalledWith(
      CASE_ID,
      expect.objectContaining({ months: corrected }),
    );
  });

  it('counts a failed copy, remembers nothing, and tries it again next time', async () => {
    const importOne = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ report: {}, outcome: 'created' });
    const first = await copyNationalInsuranceReports(CASE_ID, [expense('ni-q3')], importOne);
    expect(first).toEqual({ attempted: 1, copied: 0, failed: 1 });
    const second = await copyNationalInsuranceReports(CASE_ID, [expense('ni-q3')], importOne);
    expect(second).toEqual({ attempted: 1, copied: 1, failed: 0 });
  });

  it.each([
    [403, 'MANAGER_REQUIRED'],
    [402, 'ACCOUNT_FROZEN'],
  ])(
    'treats %s %s as a gate, not a failure, and leaves it for a later session',
    async (status, code) => {
      const importOne = vi.fn().mockRejectedValue(new ApiRequestError(status, code));
      const outcome = await copyNationalInsuranceReports(CASE_ID, [expense('ni-q3')], importOne);
      expect(outcome).toEqual({ attempted: 1, copied: 0, failed: 0 });
      // Not remembered as copied: an owner's or manager's session will send it.
      const later = ok();
      await copyNationalInsuranceReports(CASE_ID, [expense('ni-q3')], later);
      expect(later).toHaveBeenCalledOnce();
    },
  );

  it('counts a server refusal (amount mismatch, dropped month) as a visible failure', async () => {
    const importOne = vi
      .fn()
      .mockRejectedValue(new ApiRequestError(409, 'INVALID_STATE_TRANSITION'));
    const outcome = await copyNationalInsuranceReports(CASE_ID, [expense('ni-q3')], importOne);
    expect(outcome.failed).toBe(1);
  });

  it('cannot send a payment without a valid due date, and says so', async () => {
    const importOne = ok();
    const outcome = await copyNationalInsuranceReports(
      CASE_ID,
      [expense('ni-q3', { dueDate: '' })],
      importOne,
    );
    expect(outcome).toEqual({ attempted: 1, copied: 0, failed: 1 });
    expect(importOne).not.toHaveBeenCalled();
  });

  it('never changes the payment it copies', async () => {
    const saved = expense('ni-q3');
    const before = JSON.stringify(saved);
    await copyNationalInsuranceReports(CASE_ID, [saved], ok());
    expect(JSON.stringify(saved)).toBe(before);
  });

  it('keeps no wage or amount in its plain-storage marker', async () => {
    await copyNationalInsuranceReports(CASE_ID, [expense('ni-q3')], ok());
    const marker = localStorage.getItem(`caredesk.sync.ni-report-copy.v1.${CASE_ID}`) ?? '';
    expect(marker).toContain('ni-q3');
    expect(marker).not.toMatch(/6000|213|3\.55/);
  });
});

describe('useNationalInsuranceReportCopy', () => {
  const found = { status: 'found', caseId: CASE_ID } as const;

  it('waits until the workspace has loaded from the server in this session', async () => {
    const readCurrent = vi.fn(() => [expense('ni-q3')]);
    renderHook(() => useNationalInsuranceReportCopy(found, 1, readCurrent));
    expect(readCurrent).not.toHaveBeenCalled();

    sync.hydrated = true;
    act(() => {
      window.dispatchEvent(new CustomEvent('caredesk:workspace-sync-changed'));
    });
    await waitFor(() => expect(readCurrent).toHaveBeenCalled());
  });

  it('copies nothing for a client that has no canonical case', () => {
    sync.hydrated = true;
    const readCurrent = vi.fn(() => [expense('ni-q3')]);
    renderHook(() => useNationalInsuranceReportCopy({ status: 'none' }, 1, readCurrent));
    expect(readCurrent).not.toHaveBeenCalled();
  });

  it('reads what is stored at copy time, not the list the screen opened with', async () => {
    sync.hydrated = true;
    let stored = [expense('ni-q3', { dueDate: '' })];
    const readCurrent = vi.fn(() => stored);
    const { result, rerender } = renderHook(
      ({ changed }) => useNationalInsuranceReportCopy(found, changed, readCurrent),
      { initialProps: { changed: 1 } },
    );
    await waitFor(() => expect(result.current.failedCount).toBe(1));
    stored = [];
    rerender({ changed: 2 });
    await waitFor(() => expect(result.current.failedCount).toBe(0));
  });

  it('reports failures and tries again on retry', async () => {
    sync.hydrated = true;
    const readCurrent = vi.fn(() => [expense('ni-q3', { dueDate: 'not-a-date' })]);
    const { result } = renderHook(() => useNationalInsuranceReportCopy(found, 1, readCurrent));
    await waitFor(() => expect(result.current.failedCount).toBe(1));
    const calls = readCurrent.mock.calls.length;
    act(() => result.current.retry());
    await waitFor(() => expect(readCurrent.mock.calls.length).toBeGreaterThan(calls));
  });
});
