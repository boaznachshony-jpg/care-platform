import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { initI18n } from '@caredesk/i18n';
import { MedicationsPage } from './MedicationsPage.js';
import { readMvpMedications } from '../storage/mvp-storage.js';

const i18n = initI18n();

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MedicationsPage />
    </I18nextProvider>,
  );
}

function addMedication({
  name,
  dosage = '',
  doctor = '',
  times = [] as string[],
}: {
  name: string;
  dosage?: string;
  doctor?: string;
  times?: string[];
}) {
  fireEvent.change(screen.getByLabelText('שם התרופה'), { target: { value: name } });
  if (dosage) fireEvent.change(screen.getByLabelText('מינון'), { target: { value: dosage } });
  if (doctor) {
    fireEvent.change(screen.getByLabelText('הרופא/ה שהמליץ/ה'), { target: { value: doctor } });
  }
  for (const time of times) fireEvent.click(screen.getByLabelText(time));
  fireEvent.click(screen.getByRole('button', { name: 'הוספה' }));
}

describe('MedicationsPage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('states plainly that the record is not medical advice, before any data is entered', () => {
    renderPage();
    // This is the whole reason the screen is allowed to exist: it transcribes
    // what the client already knows, it does not advise.
    expect(screen.getByRole('note')).toHaveTextContent(/אינו המלצה רפואית/);
    expect(screen.getByRole('note')).toHaveTextContent(/אינו מרשם/);
  });

  it('records a medication with its dosage, schedule and prescribing doctor', () => {
    renderPage();
    addMedication({
      name: 'אלטרוקסין',
      dosage: 'כדור אחד',
      doctor: 'ד"ר לוי',
      times: ['בוקר'],
    });

    const list = screen.getByRole('list', { name: 'התרופות הרשומות' });
    const row = within(list).getByText('אלטרוקסין').closest('li');
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent('כדור אחד');
    expect(row).toHaveTextContent('בוקר');
    expect(row).toHaveTextContent('ד"ר לוי');
    expect(row).toHaveTextContent('כל יום');
  });

  it('survives a reload, because a handover list that forgets is worse than none', () => {
    const { unmount } = renderPage();
    addMedication({ name: 'קלציום', times: ['ערב'] });
    unmount();

    expect(readMvpMedications()).toHaveLength(1);
    renderPage();
    expect(screen.getByText('קלציום')).toBeInTheDocument();
  });

  it('shows an unscheduled medication as taken as needed rather than as unknown', () => {
    renderPage();
    addMedication({ name: 'אקמול' });

    const row = screen.getByText('אקמול').closest('li');
    expect(row).toHaveTextContent('לפי הצורך');
  });

  it('supports more than one time of day', () => {
    renderPage();
    addMedication({ name: 'תרופה', times: ['בוקר', 'ערב'] });

    const row = screen.getByText('תרופה').closest('li');
    expect(row).toHaveTextContent('בוקר');
    expect(row).toHaveTextContent('ערב');
  });

  it('refuses to record a medication with no name', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('מינון'), { target: { value: 'כדור' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוספה' }));

    expect(screen.getByText('עדיין לא נרשמו תרופות.')).toBeInTheDocument();
    expect(readMvpMedications()).toHaveLength(0);
  });

  it('removes a medication only after an explicit confirmation', () => {
    renderPage();
    addMedication({ name: 'אלטרוקסין' });

    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'מחיקה' }));
    expect(readMvpMedications()).toHaveLength(1);

    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'מחיקה' }));
    expect(readMvpMedications()).toHaveLength(0);
  });

  it('edits an existing entry in place instead of adding a duplicate', () => {
    renderPage();
    addMedication({ name: 'אלטרוקסין', dosage: 'כדור אחד' });

    fireEvent.click(screen.getByRole('button', { name: 'עריכה' }));
    fireEvent.change(screen.getByLabelText('מינון'), { target: { value: 'חצי כדור' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

    const stored = readMvpMedications();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.dosage).toBe('חצי כדור');
  });
});
