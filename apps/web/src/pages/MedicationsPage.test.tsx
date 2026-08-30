import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { initI18n } from '@caredesk/i18n';
import { MedicationsPage } from './MedicationsPage.js';
import { readMvpMedications, saveMvpMedications } from '../storage/mvp-storage.js';
import type { MvpMedication } from '../storage/mvp-storage.js';

const DAILY_LABEL = 'נלקחת כל יום';
const NO_DAYS_NOTICE =
  'לא סומן אף יום, ולכן לא תישלח תזכורת על התרופה הזו. סמנו לפחות יום אחד כדי שתזכורות יתחילו להישלח.';

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

  it('asks which days only once the medication is not taken every day', () => {
    renderPage();
    // Nothing to answer while it is daily, so nothing is asked.
    expect(screen.queryByLabelText('ראשון')).not.toBeInTheDocument();
    expect(screen.queryByText(NO_DAYS_NOTICE)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(DAILY_LABEL));
    expect(screen.getByLabelText('ראשון')).toBeInTheDocument();
    expect(screen.getByLabelText('שבת')).toBeInTheDocument();

    // Ticking the box again puts the question away.
    fireEvent.click(screen.getByLabelText(DAILY_LABEL));
    expect(screen.queryByLabelText('ראשון')).not.toBeInTheDocument();
  });

  it('says plainly that no reminder goes out while no day is chosen', () => {
    renderPage();
    fireEvent.click(screen.getByLabelText(DAILY_LABEL));
    expect(screen.getByText(NO_DAYS_NOTICE)).toBeInTheDocument();

    // The medical disclaimer keeps sole ownership of role="note"; a second one
    // would make neither of them findable.
    expect(screen.getAllByRole('note')).toHaveLength(1);

    fireEvent.click(screen.getByLabelText('שני'));
    expect(screen.queryByText(NO_DAYS_NOTICE)).not.toBeInTheDocument();
  });

  it('records the chosen days in Sunday-first order, whatever order they were ticked', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('שם התרופה'), { target: { value: 'קומדין' } });
    fireEvent.click(screen.getByLabelText('בוקר'));
    fireEvent.click(screen.getByLabelText(DAILY_LABEL));
    fireEvent.click(screen.getByLabelText('חמישי'));
    fireEvent.click(screen.getByLabelText('ראשון'));
    fireEvent.click(screen.getByRole('button', { name: 'הוספה' }));

    const stored = readMvpMedications();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.daily).toBe(false);
    expect(stored[0]!.daysOfWeek).toEqual(['sunday', 'thursday']);

    const row = screen.getByText('קומדין').closest('li');
    expect(row).toHaveTextContent('לא כל יום');
    expect(row).toHaveTextContent('ראשון');
    expect(row).toHaveTextContent('חמישי');
  });

  it('saves a non-daily medication with no days as an empty list, not as a guess', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('שם התרופה'), { target: { value: 'אלטרוקסין' } });
    fireEvent.click(screen.getByLabelText('בוקר'));
    fireEvent.click(screen.getByLabelText(DAILY_LABEL));
    fireEvent.click(screen.getByRole('button', { name: 'הוספה' }));

    const stored = readMvpMedications();
    expect(stored[0]!.daily).toBe(false);
    expect(stored[0]!.daysOfWeek).toEqual([]);
  });

  it('opens a record saved before the day field existed without inventing days', () => {
    // Exactly what is on disk for an entry written by the previous version:
    // no `daysOfWeek` key at all.
    const legacy = {
      id: 'legacy-1',
      name: 'ותיקה',
      dosage: '',
      timesOfDay: ['morning'],
      daily: false,
      prescribingDoctor: '',
      notes: '',
      updatedAt: '2026-08-01T09:00:00.000Z',
    } as MvpMedication;
    expect('daysOfWeek' in legacy).toBe(false);
    saveMvpMedications([legacy]);

    renderPage();
    expect(screen.getByText('ותיקה')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'עריכה' }));
    // Nothing is pre-ticked, and the screen states the consequence rather than
    // letting the entry sit silently unreminded as it did before.
    for (const day of ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']) {
      expect(screen.getByLabelText(day)).not.toBeChecked();
    }
    expect(screen.getByText(NO_DAYS_NOTICE)).toBeInTheDocument();

    // Saving without touching the days leaves the meaning unchanged.
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    const stored = readMvpMedications();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.daily).toBe(false);
    expect(stored[0]!.daysOfWeek).toEqual([]);
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
