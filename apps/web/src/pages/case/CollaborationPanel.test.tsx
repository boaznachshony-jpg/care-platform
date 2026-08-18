import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  members: [
    { id: 'mem-001', display_name: 'ישראל ישראלי', role: 'manager', status: 'active' },
  ],
  responsibilities: [
    { responsibility: 'payroll', assignee_membership_id: 'mem-001' },
  ],
  tasks: [
    { id: 'task-001', title: 'חידוש אשרה', assignee_membership_id: null },
  ],
  requests: [],
};

function renderPanel(caseId = DEMO_CASE_ID) {
  return render(<CollaborationPanel caseId={caseId} />);
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

    it('shows loading indicator while fetching', () => {
      renderPanel();
      expect(screen.getByText(/Loading collaboration/)).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    });

    it('shows error message on fetch failure', async () => {
      renderPanel();
      await waitFor(() =>
        expect(screen.getByRole('alert')).toBeInTheDocument(),
      );
      expect(screen.getByText(/could not be loaded/)).toBeInTheDocument();
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

    it('shows the Family collaboration heading', async () => {
      renderPanel();
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: /Family collaboration/ })).toBeInTheDocument(),
      );
    });

    it('renders responsibility selectors for all responsibility kinds', async () => {
      renderPanel();
      await waitFor(() =>
        expect(screen.getByRole('combobox', { name: /payroll assignee/ })).toBeInTheDocument(),
      );
    });

    it('renders task assignment selector', async () => {
      renderPanel();
      await waitFor(() =>
        expect(screen.getByRole('combobox', { name: /חידוש אשרה assignee/ })).toBeInTheDocument(),
      );
    });

    it('shows no open requests message when requests list is empty', async () => {
      renderPanel();
      await waitFor(() =>
        expect(screen.getByText('No open requests.')).toBeInTheDocument(),
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
        expect(screen.getByRole('heading', { name: /Family collaboration/ })).toBeInTheDocument(),
      );
    });
  });
});
