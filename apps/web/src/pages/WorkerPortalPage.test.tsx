import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { WorkerPortalPage } from './WorkerPortalPage.js';

const mockApiRequest = vi.fn();

vi.mock('../api/client.js', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  getWorkerPreferences: () => mockApiRequest('/worker/preferences'),
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

  /**
   * Defect: this save always sent `whatsappConsent: 'unknown', smsConsent:
   * 'unknown'` regardless of what was actually stored, because nothing here
   * ever called GET /worker/preferences. That silently reset a caregiver's
   * earlier, explicit consent withdrawal the next time she only meant to
   * change her display language. The fix must load the stored preference and
   * echo the one thing this portal is actually allowed to say: a prior
   * revoke. It must never fabricate 'unknown' as an instruction to reset,
   * and it must never claim to know a state ('granted') it cannot even send.
   */
  describe('profile tab preference save', () => {
    function preferencesFixture(
      overrides: Partial<{
        whatsapp_consent: 'unknown' | 'granted' | 'revoked';
        sms_consent: 'unknown' | 'granted' | 'revoked';
      }> = {},
    ) {
      return {
        preferred_locale: 'he' as const,
        preferred_channel: 'email' as const,
        email_enabled: true,
        whatsapp_enabled: false,
        sms_enabled: false,
        whatsapp_consent: 'unknown' as const,
        sms_consent: 'unknown' as const,
        ...overrides,
      };
    }

    function mockRoutes(preferences: ReturnType<typeof preferencesFixture>) {
      mockApiRequest.mockImplementation((path: string, init?: RequestInit) => {
        if (path === '/worker/preferences' && (!init || init.method === undefined)) {
          return Promise.resolve(preferences);
        }
        if (path === '/worker/portal') return Promise.resolve(DEMO_PORTAL);
        return Promise.resolve({});
      });
    }

    async function openProfileTabAndSave() {
      renderPage();
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'האזור שלי' })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole('button', { name: 'פרופיל' }));
      fireEvent.click(screen.getByRole('button', { name: 'שמירת העדפות' }));
      await waitFor(() => {
        const putCall = mockApiRequest.mock.calls.find(
          (call) => call[0] === '/worker/preferences' && (call[1] as RequestInit)?.method === 'PUT',
        );
        expect(putCall).toBeDefined();
      });
      const putCall = mockApiRequest.mock.calls.find(
        (call) => call[0] === '/worker/preferences' && (call[1] as RequestInit)?.method === 'PUT',
      )!;
      return JSON.parse((putCall[1] as RequestInit).body as string) as {
        whatsappConsent: string;
        smsConsent: string;
      };
    }

    it('echoes a stored revoke rather than resetting it to unknown', async () => {
      mockRoutes(preferencesFixture({ whatsapp_consent: 'revoked', sms_consent: 'unknown' }));
      const body = await openProfileTabAndSave();
      expect(body.whatsappConsent).toBe('revoked');
      expect(body.smsConsent).toBe('unknown');
    });

    it('never claims a granted consent it is not allowed to send', async () => {
      mockRoutes(preferencesFixture({ whatsapp_consent: 'granted', sms_consent: 'granted' }));
      const body = await openProfileTabAndSave();
      // The wire can only carry 'unknown' | 'revoked'. Sending 'unknown' here
      // is safe precisely because the server treats it as "no opinion," never
      // as an instruction — see Wave5Service.updatePreference.
      expect(body.whatsappConsent).toBe('unknown');
      expect(body.smsConsent).toBe('unknown');
    });

    it('still sends unknown (a no-op) when the stored preference failed to load', async () => {
      mockApiRequest.mockImplementation((path: string, init?: RequestInit) => {
        if (path === '/worker/preferences' && (!init || init.method === undefined)) {
          return Promise.reject(new Error('offline'));
        }
        if (path === '/worker/portal') return Promise.resolve(DEMO_PORTAL);
        return Promise.resolve({});
      });
      const body = await openProfileTabAndSave();
      expect(body.whatsappConsent).toBe('unknown');
      expect(body.smsConsent).toBe('unknown');
    });
  });
});
