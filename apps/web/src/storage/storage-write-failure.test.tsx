import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { DocumentsPage } from '../pages/DocumentsPage.js';
import { MedicationsPage } from '../pages/MedicationsPage.js';
import { TasksPage } from '../pages/TasksPage.js';
import {
  readMvpDocuments,
  readMvpMedications,
  readMvpReminderRecipients,
  readMvpTasks,
  saveMvpDocuments,
  saveMvpTasks,
  type MvpDocument,
} from './mvp-storage.js';
import { StorageWriteError, storageWriteFailureMessage } from './storage-write-error.js';

/**
 * I. A write the device refuses must be visible on screen, and the screen must
 * not show the refused change as if it had been kept. Before this, the
 * medications and reminder screens put the new row on screen before the write
 * and left it there; the tasks and documents screens said nothing at all.
 */
const i18n = initI18n();
const originalSetItem = Storage.prototype.setItem;

/** From now on, the workspace (`caredesk.mvp.*`) refuses writes; nothing else does. */
function refuseWorkspaceWrites(name = 'QuotaExceededError') {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (key.startsWith('caredesk.mvp.')) throw new DOMException('refused', name);
    originalSetItem.call(this, key, value);
  });
}

const QUOTA_TEXT = /השמירה נכשלה והשינוי לא נשמר: אין מספיק מקום פנוי/;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StorageWriteError', () => {
  it('is what a refused workspace write throws, with the reason classified', () => {
    refuseWorkspaceWrites();
    let thrown: unknown;
    try {
      saveMvpTasks([]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StorageWriteError);
    expect((thrown as StorageWriteError).failure).toBe('quota');
  });

  it('tells blocked storage apart from a full one', () => {
    expect(new StorageWriteError('k', new DOMException('x', 'SecurityError')).failure).toBe(
      'blocked',
    );
    expect(new StorageWriteError('k', { code: 22 }).failure).toBe('quota');
    expect(new StorageWriteError('k', new Error('other')).failure).toBe('unknown');
  });

  it('never puts the storage key on screen', () => {
    const message = storageWriteFailureMessage(
      new StorageWriteError(
        'caredesk.mvp.tasks.v1::client-1',
        new DOMException('x', 'SecurityError'),
      ),
    );
    expect(message).toMatch(/הדפדפן חוסם שמירה/);
    expect(message).not.toMatch(/caredesk/);
  });
});

describe('TasksPage', () => {
  it('shows a refused save and keeps the form, without listing the task', () => {
    render(<TasksPage />);
    refuseWorkspaceWrites();

    fireEvent.click(screen.getByRole('button', { name: /משימה חדשה/ }));
    fireEvent.change(screen.getByLabelText('מה צריך לבצע?'), {
      target: { value: 'חידוש היתר' },
    });
    fireEvent.change(screen.getByLabelText('מועד יעד'), { target: { value: '2026-11-15' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת המשימה' }));

    expect(screen.getByRole('alert')).toHaveTextContent(QUOTA_TEXT);
    expect(screen.queryByText('המשימה נוספה ונשמרה.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('מה צריך לבצע?')).toHaveValue('חידוש היתר');
    expect(screen.queryByRole('heading', { name: 'חידוש היתר' })).not.toBeInTheDocument();
    expect(readMvpTasks()).toEqual([]);
  });

  it('keeps a task whose deletion was refused, and says so', () => {
    saveMvpTasks([
      {
        id: 'task-1',
        title: 'חידוש היתר',
        dueDate: '2026-11-15',
        priority: 'normal',
        status: 'open',
        createdAt: '2026-10-01T10:00:00.000Z',
      },
    ]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TasksPage />);
    refuseWorkspaceWrites();

    fireEvent.click(screen.getByRole('button', { name: /מחיקת המשימה|מחיקה/ }));

    expect(screen.getByRole('alert')).toHaveTextContent(QUOTA_TEXT);
    expect(screen.queryByText('המשימה נמחקה.')).not.toBeInTheDocument();
    expect(screen.getByText('חידוש היתר')).toBeVisible();
  });
});

describe('DocumentsPage', () => {
  const passport: MvpDocument = {
    id: 'doc-1',
    name: 'דרכון',
    category: 'דרכון',
    // The expiry field is `required`; with it empty the form would never submit.
    dateLabel: 'בתוקף עד 31.12.2027',
    status: 'valid',
    fileName: 'passport.pdf',
    fileType: 'application/pdf',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };

  it('shows a refused edit and keeps the form, without renaming the document', () => {
    saveMvpDocuments([passport]);
    render(<DocumentsPage />);
    refuseWorkspaceWrites();

    fireEvent.click(screen.getByRole('button', { name: 'עריכה' }));
    fireEvent.change(screen.getByLabelText('שם המסמך'), { target: { value: 'דרכון חדש' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת המסמך' }));

    return vi.waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(QUOTA_TEXT);
      expect(screen.queryByText('פרטי המסמך עודכנו ונשמרו.')).not.toBeInTheDocument();
      expect(screen.getByLabelText('שם המסמך')).toHaveValue('דרכון חדש');
      expect(readMvpDocuments()).toEqual([passport]);
    });
  });

  it('keeps a document whose deletion was refused', async () => {
    saveMvpDocuments([passport]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<DocumentsPage />);
    refuseWorkspaceWrites();

    fireEvent.click(screen.getByRole('button', { name: /מחיקה/ }));

    await vi.waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(QUOTA_TEXT));
    expect(screen.queryByText('המסמך נמחק.')).not.toBeInTheDocument();
    expect(readMvpDocuments()).toEqual([passport]);
  });
});

describe('MedicationsPage and its reminder recipients', () => {
  function renderPage() {
    return render(
      <I18nextProvider i18n={i18n}>
        <MedicationsPage />
      </I18nextProvider>,
    );
  }

  it('does not show a refused medication as saved', () => {
    renderPage();
    refuseWorkspaceWrites();

    fireEvent.change(screen.getByLabelText('שם התרופה'), { target: { value: 'אלטרוקסין' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוספה' }));

    expect(screen.getByRole('alert')).toHaveTextContent(QUOTA_TEXT);
    expect(screen.getByLabelText('שם התרופה')).toHaveValue('אלטרוקסין');
    expect(screen.queryByRole('heading', { name: 'אלטרוקסין' })).not.toBeInTheDocument();
    expect(readMvpMedications()).toEqual([]);
  });

  it('does not show a refused reminder recipient as saved', () => {
    renderPage();
    refuseWorkspaceWrites('SecurityError');

    fireEvent.change(screen.getByLabelText('שם'), { target: { value: 'רות' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוספת נמען' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/הדפדפן חוסם שמירה/);
    expect(screen.getByLabelText('שם')).toHaveValue('רות');
    expect(readMvpReminderRecipients()).toEqual([]);
  });
});
