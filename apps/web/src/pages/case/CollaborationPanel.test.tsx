import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { CollaborationPanel } from './CollaborationPanel.js';

// Constitution §16: synthetic data only.
const DEMO_CASE_ID = 'case-demo-001';

const EMPTY_COLLABORATION = {
  members: [],
  responsibilities: [],
  tasks: [],
  requests: [],
};

const LOADED_COLLABORATION = {
  members: [{ id: 'mem-001', display_name: 'ישראל ישראלי', role: 'manager', status: 'active' }],
  responsibilities: [{ responsibility: 'payroll', assignee_membership_id: 'mem-001' }],
  tasks: [{ id: 'task-001', title: 'חידוש אשרה', assignee_membership_id: null }],
  requests: [],
};

// Defect 3 fixture: the stored assignee is a member who is no longer active.
// `members` (used to build <option>s) only includes active rows, so without
// the fix the <select> would have no matching <option> for this value and
// the browser would silently render the first option instead.
const LOADED_WITH_INACTIVE_ASSIGNEE = {
  members: [
    { id: 'mem-001', display_name: 'ישראל ישראלי', role: 'manager', status: 'active' },
    { id: 'mem-002', display_name: 'רותי כהן', role: 'manager', status: 'inactive' },
  ],
  responsibilities: [{ responsibility: 'payroll', assignee_membership_id: 'mem-002' }],
  tasks: [{ id: 'task-001', title: 'חידוש אשרה', assignee_membership_id: 'mem-002' }],
  requests: [],
};

const WITH_REQUEST = {
  ...LOADED_COLLABORATION,
  requests: [
    {
      id: 'req-001',
      request_type: 'leave',
      message: 'בקשה לשלושה ימי חופשה',
      status: 'open',
      assigned_membership_id: null,
      created_at: '2026-08-01T09:00:00.000Z',
    },
  ],
};

function renderPanel(caseId = DEMO_CASE_ID) {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <CollaborationPanel caseId={caseId} />
    </I18nextProvider>,
  );
}

describe('CollaborationPanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('loading state', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => new Promise(() => undefined), // never resolves
        }),
      );
    });

    it('shows a Hebrew loading indicator while fetching', () => {
      renderPanel();
      expect(screen.getByText(/טוען את חלוקת האחריות/)).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    });

    it('shows a Hebrew error message on fetch failure', async () => {
      renderPanel();
      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
      expect(screen.getByText(/לא הצלחנו לטעון את חלוקת האחריות/)).toBeInTheDocument();
    });

    // WEB-13/WEB-16: a load failure must offer a way forward, not a dead end.
    it('offers a retry', async () => {
      renderPanel();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'ניסיון נוסף' })).toBeInTheDocument(),
      );
    });
  });

  describe('loaded state', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(LOADED_COLLABORATION),
        }),
      );
    });

    it('shows the Hebrew panel heading', async () => {
      renderPanel();
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'שיתוף פעולה משפחתי' })).toBeInTheDocument(),
      );
    });

    /**
     * WEB-13: the responsibility labels were `kind.replaceAll('_', ' ')`, so a
     * Hebrew-speaking family employer read "documents compliance" and "visa
     * authorization". This is the assertion that fails without the fix.
     */
    it('renders responsibility names in Hebrew, not raw enum keys', async () => {
      renderPanel();
      await waitFor(() => expect(screen.getByText('שכר ותשלומים')).toBeInTheDocument());
      expect(screen.getByText('מסמכים ועמידה בדרישות')).toBeInTheDocument();
      expect(screen.getByText('אשרה והיתר העסקה')).toBeInTheDocument();
      expect(screen.queryByText('documents compliance')).not.toBeInTheDocument();
      expect(screen.queryByText('visa authorization')).not.toBeInTheDocument();
    });

    it('labels each responsibility selector in Hebrew', async () => {
      renderPanel();
      await waitFor(() =>
        expect(
          screen.getByRole('combobox', { name: 'אחראי/ת על שכר ותשלומים' }),
        ).toBeInTheDocument(),
      );
    });

    it('renders the task assignment selector with a Hebrew label', async () => {
      renderPanel();
      await waitFor(() =>
        expect(screen.getByRole('combobox', { name: 'אחראי/ת על חידוש אשרה' })).toBeInTheDocument(),
      );
    });

    it('shows the empty-requests message in Hebrew', async () => {
      renderPanel();
      await waitFor(() => expect(screen.getByText('אין פניות פתוחות.')).toBeInTheDocument());
    });

    it('offers "לא שויך" rather than "Unassigned"', async () => {
      renderPanel();
      await waitFor(() => expect(screen.getAllByText('לא שויך').length).toBeGreaterThan(0));
      expect(screen.queryByText('Unassigned')).not.toBeInTheDocument();
    });
  });

  describe('assigned member no longer active', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(LOADED_WITH_INACTIVE_ASSIGNEE),
        }),
      );
    });

    it('keeps the stored (inactive) assignee selected instead of silently falling back to the first member', async () => {
      renderPanel();
      const select = await screen.findByRole('combobox', { name: 'אחראי/ת על שכר ותשלומים' });
      expect(select).toHaveValue('mem-002');
    });

    it('marks the inactive assignee visibly in the option list', async () => {
      renderPanel();
      const select = await screen.findByRole('combobox', { name: 'אחראי/ת על שכר ותשלומים' });
      expect(select).toHaveValue('mem-002');
      expect(
        screen.getAllByText(/רותי כהן/).some((el) => /לא פעיל/.test(el.textContent ?? '')),
      ).toBe(true);
    });

    it('keeps the stored (inactive) task assignee selected too', async () => {
      renderPanel();
      const select = await screen.findByRole('combobox', { name: 'אחראי/ת על חידוש אשרה' });
      expect(select).toHaveValue('mem-002');
    });
  });

  describe('worker requests', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(WITH_REQUEST),
        }),
      );
    });

    it('translates the request type and status enums', async () => {
      renderPanel();
      await waitFor(() => expect(screen.getByText('בקשת חופשה')).toBeInTheDocument());
      expect(screen.getByRole('option', { name: 'בבדיקה' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'אושרה' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'In review' })).not.toBeInTheDocument();
    });
  });

  describe('failed write', () => {
    /**
     * WEB-07/WEB-13: a rejected PUT made the <select> snap back with no
     * message, which reads as "the app ignored my click". Without the catch
     * added in this change this test also produces an unhandled rejection.
     */
    it('surfaces a failed assignment instead of failing silently', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(LOADED_COLLABORATION) })
        .mockRejectedValue(new Error('network error'));
      vi.stubGlobal('fetch', fetchMock);
      renderPanel();
      await waitFor(() =>
        expect(
          screen.getByRole('combobox', { name: 'אחראי/ת על שכר ותשלומים' }),
        ).toBeInTheDocument(),
      );
      fireEvent.change(screen.getByRole('combobox', { name: 'אחראי/ת על שכר ותשלומים' }), {
        target: { value: '' },
      });
      await waitFor(() =>
        expect(screen.getByText('העדכון לא נשמר. אפשר לנסות שוב.')).toBeInTheDocument(),
      );
    });
  });

  describe('with no active members', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(EMPTY_COLLABORATION),
        }),
      );
    });

    it('renders with empty members and responsibilities', async () => {
      renderPanel();
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'שיתוף פעולה משפחתי' })).toBeInTheDocument(),
      );
    });
  });
});
