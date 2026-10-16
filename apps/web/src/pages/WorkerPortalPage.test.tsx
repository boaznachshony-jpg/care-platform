import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { ApiRequestError } from '../api/client.js';
import { WorkerPortalPage } from './WorkerPortalPage.js';

const mockApiRequest = vi.fn();

vi.mock('../api/client.js', () => {
  class ApiRequestError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
    ) {
      super(code);
    }
  }
  return {
    ApiRequestError,
    apiRequest: (...args: unknown[]) => mockApiRequest(...args),
    getWorkerPreferences: () => mockApiRequest('/worker/preferences'),
  };
});

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

  /**
   * UI-WRITE-07 / UI-STATES-03 / UI-NAV-04. The three writes on this page were
   * bare awaits in event handlers: a failure showed nothing, a second tap sent
   * the request again, and the saved language was written to the server and
   * then ignored by the page that had just saved it.
   */
  describe('write contract', () => {
    const PREFERENCES = {
      preferred_locale: 'he' as const,
      preferred_channel: 'email' as const,
      email_enabled: true,
      whatsapp_enabled: false,
      sms_enabled: false,
      whatsapp_consent: 'unknown' as const,
      sms_consent: 'unknown' as const,
    };
    const ACK_BUTTON = 'ראיתי / קיבלתי את רישום התשלום';

    function mockRoutes(
      override: (path: string, init?: RequestInit) => Promise<unknown> | undefined = () =>
        undefined,
      preferences: Record<string, unknown> = PREFERENCES,
    ) {
      mockApiRequest.mockImplementation((path: string, init?: RequestInit) => {
        const custom = override(path, init);
        if (custom) return custom;
        if (path === '/worker/portal') return Promise.resolve(DEMO_PORTAL);
        if (path === '/worker/preferences' && (!init || init.method === undefined)) {
          return Promise.resolve(preferences);
        }
        return Promise.resolve({});
      });
    }

    const callsTo = (path: string, method: string) =>
      mockApiRequest.mock.calls.filter(
        (call) => call[0] === path && (call[1] as RequestInit | undefined)?.method === method,
      );

    async function openTab(name: string) {
      renderPage();
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'האזור שלי' })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole('button', { name }));
    }

    afterEach(async () => {
      // The locale test switches the shared i18n instance; put it back so the
      // rest of the file keeps asserting Hebrew.
      await initI18n().changeLanguage('he');
      document.documentElement.lang = 'he';
      document.documentElement.dir = 'rtl';
    });

    it('shows an error and re-enables the button when acknowledging a payment fails', async () => {
      mockRoutes((path, init) =>
        path === '/worker/payments/close-001/acknowledgements' && init?.method === 'POST'
          ? Promise.reject(new ApiRequestError(500, 'REQUEST_ERROR'))
          : undefined,
      );
      await openTab('תשלומים');
      fireEvent.click(screen.getByRole('button', { name: ACK_BUTTON }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('השמירה נכשלה ולא נרשמה. בדקו את החיבור ונסו שוב.');
      expect(screen.getByRole('button', { name: ACK_BUTTON })).toBeEnabled();
      // The row still says "pending": a failed acknowledgement must not look acknowledged.
      expect(screen.queryByText(/אושר על ידך בתאריך/)).not.toBeInTheDocument();
    });

    it('posts one acknowledgement for two taps while the first is pending', async () => {
      mockRoutes((path, init) =>
        path === '/worker/payments/close-001/acknowledgements' && init?.method === 'POST'
          ? new Promise(() => undefined)
          : undefined,
      );
      await openTab('תשלומים');
      const button = screen.getByRole('button', { name: ACK_BUTTON });
      fireEvent.click(button);
      fireEvent.click(button);
      await waitFor(() =>
        expect(callsTo('/worker/payments/close-001/acknowledgements', 'POST')).toHaveLength(1),
      );
      expect(screen.getByRole('button', { name: ACK_BUTTON })).toBeDisabled();
      expect(screen.getByRole('status')).toHaveTextContent('שומרים…');
    });

    it('shows an error and keeps the text when a request cannot be sent, then retries with the same key', async () => {
      let failing = true;
      mockRoutes((path, init) => {
        if (path === '/worker/requests' && init?.method === 'POST') {
          return failing
            ? Promise.reject(new ApiRequestError(500, 'REQUEST_ERROR'))
            : Promise.resolve({});
        }
        return undefined;
      });
      await openTab('בקשות');
      fireEvent.change(screen.getByLabelText('מה ברצונך לבקש?'), {
        target: { value: 'בקשה לשלושה ימי חופשה' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'שליחת בקשה' }));
      await screen.findByRole('alert');
      expect(screen.getByLabelText('מה ברצונך לבקש?')).toHaveValue('בקשה לשלושה ימי חופשה');
      expect(screen.getByRole('button', { name: 'שליחת בקשה' })).toBeEnabled();

      failing = false;
      fireEvent.click(screen.getByRole('button', { name: 'ניסיון נוסף' }));
      await waitFor(() => expect(callsTo('/worker/requests', 'POST')).toHaveLength(2));
      const keys = callsTo('/worker/requests', 'POST').map(
        (call) => ((call[1] as RequestInit).headers as Record<string, string>)['idempotency-key'],
      );
      expect(typeof keys[0]).toBe('string');
      expect(keys[1]).toBe(keys[0]);
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('הבקשה נשלחה.'));
      expect(screen.getByLabelText('מה ברצונך לבקש?')).toHaveValue('');
    });

    it('shows saved after preferences are stored', async () => {
      mockRoutes();
      await openTab('פרופיל');
      fireEvent.click(screen.getByRole('button', { name: 'שמירת העדפות' }));
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('נשמר.'));
      expect(callsTo('/worker/preferences', 'PUT')).toHaveLength(1);
    });

    it('shows an error when saving preferences fails', async () => {
      mockRoutes((path, init) =>
        path === '/worker/preferences' && init?.method === 'PUT'
          ? Promise.reject(new ApiRequestError(503, 'REQUEST_ERROR'))
          : undefined,
      );
      await openTab('פרופיל');
      fireEvent.click(screen.getByRole('button', { name: 'שמירת העדפות' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('השמירה נכשלה');
      expect(screen.getByRole('button', { name: 'שמירת העדפות' })).toBeEnabled();
      // A failed save must not switch the page's language.
      expect(document.documentElement.dir).toBe('rtl');
    });

    it('applies the stored language to the portal and to the document direction', async () => {
      mockRoutes(() => undefined, { ...PREFERENCES, preferred_locale: 'en' });
      renderPage();
      await screen.findByRole('button', { name: 'Payments' });
      expect(document.documentElement.lang).toBe('en');
      expect(document.documentElement.dir).toBe('ltr');
    });

    it('switches the language once a new preference is saved', async () => {
      mockRoutes();
      await openTab('פרופיל');
      fireEvent.change(screen.getByLabelText('שפה'), { target: { value: 'en' } });
      // Choosing is not saving: the page stays Hebrew until the server confirms.
      expect(document.documentElement.dir).toBe('rtl');
      fireEvent.click(screen.getByRole('button', { name: 'שמירת העדפות' }));
      await screen.findByRole('button', { name: 'Save preferences' });
      expect(document.documentElement.lang).toBe('en');
      expect(document.documentElement.dir).toBe('ltr');
      const body = JSON.parse(
        (callsTo('/worker/preferences', 'PUT')[0]?.[1] as RequestInit).body as string,
      ) as { locale: string };
      expect(body.locale).toBe('en');
    });
  });
});
