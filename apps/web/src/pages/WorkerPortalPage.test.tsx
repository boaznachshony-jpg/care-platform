import { render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { WorkerPortalPage } from './WorkerPortalPage.js';

const mockApiRequest = vi.fn();

vi.mock('../api/client.js', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

const DEMO_PORTAL = {
  payments: [
    {
      closeId: 'close-001',
      month: '2026-08',
      amountPaid: 7000,
      paymentDate: '2026-08-01',
      acknowledgement: 'pending',
    },
  ],
  leave: { availableBalance: 12, used: 3, planned: 0 },
  requests: [],
  documents: [],
};

function renderPage() {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <WorkerPortalPage />
    </I18nextProvider>,
  );
}

describe('WorkerPortalPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('loading state', () => {
    beforeEach(() => {
      mockApiRequest.mockReturnValue(new Promise(() => undefined));
    });

    it('shows loading text while portal data is fetching', () => {
      renderPage();
      expect(screen.getByText('טוענים את האזור האישי…')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    beforeEach(() => {
      mockApiRequest.mockRejectedValue(new Error('unauthorized'));
    });

    it('shows access error message on failure', async () => {
      renderPage();
      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
      expect(
        screen.getByText('אין גישה פעילה לאזור המטפל. ייתכן שההזמנה פגה או שהגישה בוטלה.'),
      ).toBeInTheDocument();
    });
  });

  describe('loaded state', () => {
    beforeEach(() => {
      mockApiRequest.mockResolvedValue(DEMO_PORTAL);
    });

    it('shows the portal title', async () => {
      renderPage();
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'האזור שלי' })).toBeInTheDocument(),
      );
    });

    it('renders the navigation tabs', async () => {
      renderPage();
      await waitFor(() =>
        expect(screen.getByRole('navigation', { name: 'ניווט באזור המטפל' })).toBeInTheDocument(),
      );
    });
  });
});
