import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emptyMvpProfile,
  readMvpEmploymentExpenses,
  readMvpPayroll,
  saveMvpProfile,
} from '../storage/mvp-storage.js';
import type { CaseLookupState } from '../sync/use-case-for-legacy-client.js';
import { PayrollPage } from './PayrollPage.js';

/**
 * Silent saves (17.10.2026), place 1: the payroll wizard's "אישור ושמירה".
 *
 * Both of its writes were unguarded. When the device refused the record, the
 * exception left the click handler, the screen said nothing, and the employer
 * could not tell whether the month existed. When only the quarter's National
 * Insurance tracking row was refused, the screen still said tracking had
 * started.
 */
const mockUseCaseForLegacyClient = vi.fn<(legacyClientId: string) => CaseLookupState>();
vi.mock('../sync/use-case-for-legacy-client.js', () => ({
  useCaseForLegacyClient: (legacyClientId: string) => mockUseCaseForLegacyClient(legacyClientId),
}));
vi.mock('../api/client.js', () => ({
  listCanonicalPayrollCloses: () => Promise.resolve([]),
  closeCanonicalPayrollMonth: () => Promise.reject(new Error('not used here')),
}));

const originalSetItem = Storage.prototype.setItem;

/** From now on the device refuses writes to the given workspace keys. */
function refuseWrites(keyPrefix: string) {
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (key.startsWith(keyPrefix)) throw new DOMException('refused', 'QuotaExceededError');
    originalSetItem.call(this, key, value);
  });
}

function fillAndSave() {
  fireEvent.change(screen.getByLabelText('חודש שכר'), { target: { value: '2026-07' } });
  for (let step = 0; step < 4; step += 1) {
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
  }
  fireEvent.click(screen.getByRole('button', { name: 'אישור ושמירה' }));
}

beforeEach(() => {
  localStorage.clear();
  mockUseCaseForLegacyClient.mockReturnValue({ status: 'found', caseId: 'case-default-001' });
  saveMvpProfile({ ...emptyMvpProfile, baseSalary: 7_000, salaryEffectiveDate: '2025-01-01' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PayrollPage wizard save', () => {
  it('shows a refused month and never says it was saved', () => {
    render(<PayrollPage />);
    refuseWrites('caredesk.mvp.payroll.');

    fillAndSave();

    expect(screen.getByRole('alert')).toHaveTextContent(
      /השמירה נכשלה והשינוי לא נשמר: אין מספיק מקום פנוי/,
    );
    expect(screen.queryByText('השכר נשמר בהצלחה')).not.toBeInTheDocument();
    expect(screen.queryByText(/רישום השכר החודשי נשמר/)).not.toBeInTheDocument();
    // The button still offers the first save, so the click can be retried.
    expect(screen.getByRole('button', { name: 'אישור ושמירה' })).toBeInTheDocument();
    expect(readMvpPayroll()).toEqual([]);
    expect(readMvpEmploymentExpenses()).toEqual([]);
  });

  it('says exactly which half was kept when only the tracking row is refused', () => {
    render(<PayrollPage />);
    refuseWrites('caredesk.mvp.employment-expenses.');

    fillAndSave();

    expect(screen.getByText('השכר נשמר בהצלחה')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      /רישום השכר החודשי נשמר, אבל מעקב התשלום לביטוח לאומי לרבעון לא נשמר/,
    );
    expect(screen.queryByText(/מעקב התשלום לביטוח לאומי הופעל/)).not.toBeInTheDocument();
    expect(readMvpPayroll().map((record) => record.month)).toEqual(['2026-07']);
    expect(readMvpEmploymentExpenses()).toEqual([]);
  });

  it('clears the failure once a save lands', () => {
    render(<PayrollPage />);
    const refusal = refuseWrites('caredesk.mvp.payroll.');
    fillAndSave();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    refusal.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'אישור ושמירה' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('השכר נשמר בהצלחה')).toBeInTheDocument();
    expect(readMvpPayroll().map((record) => record.month)).toEqual(['2026-07']);
  });
});
