import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import {
  readMvpMedications,
  saveMvpMedications,
  type MvpMedication,
} from '../storage/mvp-storage.js';

/**
 * Sync-specific coverage for MedicationsPage, kept separate from
 * MedicationsPage.test.tsx for the same reason as TasksPage.sync.test.tsx —
 * the plain local-storage behaviour tests there must never be affected by
 * mocking `../api/client.js` and `../canonical-case.js` here.
 */
const mocks = vi.hoisted(() => ({
  findCanonicalCase: vi.fn(),
  importCaseMedication: vi.fn(),
  listCaseMedications: vi.fn(),
  archiveCaseMedication: vi.fn(),
  updateCaseMedication: vi.fn(),
  listEmploymentCases: vi.fn(),
}));

vi.mock('../canonical-case.js', () => ({
  findCanonicalCase: mocks.findCanonicalCase,
  LEGACY_UNSCOPED_CLIENT_ID: 'legacy:unscoped',
}));

vi.mock('../api/client.js', () => ({
  importCaseMedication: mocks.importCaseMedication,
  listCaseMedications: mocks.listCaseMedications,
  archiveCaseMedication: mocks.archiveCaseMedication,
  updateCaseMedication: mocks.updateCaseMedication,
  // Defect 4: see the matching comment in TasksPage.sync.test.tsx.
  listEmploymentCases: mocks.listEmploymentCases,
}));

import { MedicationsPage } from './MedicationsPage.js';

const DEMO_CASE = { id: 'case-demo-001' };

function renderPage() {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <MedicationsPage />
    </I18nextProvider>,
  );
}

function localMedicationFixture(): MvpMedication {
  return {
    id: 'local-1',
    name: 'אלטרוקסין',
    dosage: 'כדור אחד',
    timesOfDay: ['morning'],
    daily: true,
    daysOfWeek: undefined,
    prescribingDoctor: 'ד"ר לוי',
    notes: '',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

function serverMedicationFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'server-1',
    name: 'אלטרוקסין',
    dosage: 'כדור אחד',
    timesOfDay: ['morning'],
    daily: true,
    daysOfWeek: null,
    prescribingDoctor: 'ד"ר לוי',
    notes: '',
    status: 'active',
    legacyLocalId: 'local-1',
    ...overrides,
  };
}

describe('MedicationsPage sync', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.findCanonicalCase.mockReset();
    mocks.importCaseMedication.mockReset();
    mocks.listCaseMedications.mockReset();
    mocks.archiveCaseMedication.mockReset();
    mocks.updateCaseMedication.mockReset();
    mocks.listEmploymentCases.mockReset();
    mocks.findCanonicalCase.mockResolvedValue(DEMO_CASE);
    mocks.listCaseMedications.mockResolvedValue([]);
    mocks.listEmploymentCases.mockResolvedValue([DEMO_CASE]);
  });

  // Defect 1 (the worst one, and the most dangerous here — this screen feeds
  // the emergency binder): an edit to an already-synced medication must
  // survive the next sync and be pushed via updateCaseMedication.
  it('an edit to an already-synced medication is pushed via updateCaseMedication and survives the merge', async () => {
    saveMvpMedications([localMedicationFixture()]);
    const serverMedication = serverMedicationFixture();
    mocks.importCaseMedication.mockResolvedValue(serverMedication);
    // Deliberately keeps returning the *old* dosage on every list call, as if
    // the read-back landed before an update — proves the merge does not fall
    // back to it.
    mocks.listCaseMedications.mockResolvedValue([serverMedication]);

    renderPage();
    await waitFor(() => expect(mocks.importCaseMedication).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('אלטרוקסין')).toBeInTheDocument());

    mocks.updateCaseMedication.mockResolvedValue({ ...serverMedication, dosage: 'שני כדורים' });
    fireEvent.click(screen.getByRole('button', { name: 'עריכה' }));
    fireEvent.change(screen.getByLabelText('מינון'), { target: { value: 'שני כדורים' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

    await waitFor(() => expect(mocks.updateCaseMedication).toHaveBeenCalledTimes(1));
    expect(mocks.updateCaseMedication).toHaveBeenCalledWith(
      'case-demo-001',
      'server-1',
      expect.objectContaining({ dosage: 'שני כדורים' }),
    );
    // Never reverted to the server's (still-old) copy.
    const row = screen.getByText('אלטרוקסין').closest('li');
    expect(row).toHaveTextContent('שני כדורים');
    expect(readMvpMedications()[0]?.dosage).toBe('שני כדורים');
  });

  // Defect 5: removing (archiving) a medication must be retryable through the
  // sync pass, not a one-shot fire-and-forget lost on the first failure —
  // this is the record a stand-in caregiver's emergency binder is read from.
  it('retries a failed medication archive on the next sync pass instead of losing it', async () => {
    saveMvpMedications([localMedicationFixture()]);
    const serverMedication = serverMedicationFixture();
    mocks.importCaseMedication.mockResolvedValue(serverMedication);
    mocks.listCaseMedications.mockResolvedValue([serverMedication]);
    mocks.archiveCaseMedication.mockRejectedValueOnce(new Error('network error'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderPage();
    await waitFor(() => expect(mocks.importCaseMedication).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'מחיקה' }));
    await waitFor(() => expect(mocks.archiveCaseMedication).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /נסו שוב|נסה שוב/ })).toBeInTheDocument(),
    );

    mocks.archiveCaseMedication.mockResolvedValueOnce({ ...serverMedication, status: 'archived' });
    fireEvent.click(screen.getByRole('button', { name: /נסו שוב|נסה שוב/ }));

    await waitFor(() => expect(mocks.archiveCaseMedication).toHaveBeenCalledTimes(2));
    expect(mocks.archiveCaseMedication).toHaveBeenNthCalledWith(2, 'case-demo-001', 'server-1');
  });

  // Defect 4: an unscoped route must never guess which of an account's
  // multiple clients its records belong to.
  it('refuses to sync at all on the unscoped route when the account has more than one client', async () => {
    mocks.listEmploymentCases.mockResolvedValue([DEMO_CASE, { id: 'case-other-002' }]);
    saveMvpMedications([localMedicationFixture()]);

    renderPage();

    await waitFor(() => expect(mocks.listEmploymentCases).toHaveBeenCalled());
    expect(mocks.findCanonicalCase).not.toHaveBeenCalled();
    expect(mocks.importCaseMedication).not.toHaveBeenCalled();
    expect(screen.getByText('אלטרוקסין')).toBeInTheDocument();
  });
});
