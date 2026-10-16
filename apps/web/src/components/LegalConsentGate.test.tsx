import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n, PRIVACY_DOCUMENT_VERSION, TERMS_DOCUMENT_VERSION } from '@caredesk/i18n';
import type { LegalAcceptanceRecord } from '@caredesk/schemas';

const mocks = vi.hoisted(() => ({
  listLegalAcceptances: vi.fn(),
  recordLegalAcceptance: vi.fn(),
  signOut: vi.fn(async () => true),
  userId: 'user-viewer',
}));

vi.mock('../api/client.js', async () => {
  const actual = await vi.importActual<typeof import('../api/client.js')>('../api/client.js');
  return {
    ...actual,
    listLegalAcceptances: mocks.listLegalAcceptances,
    recordLegalAcceptance: mocks.recordLegalAcceptance,
  };
});

vi.mock('../auth/auth-context.js', () => ({
  useAuth: () => ({
    user: { id: mocks.userId, email: 'viewer@example.test' },
    signOut: mocks.signOut,
  }),
}));

import { ApiRequestError } from '../api/client.js';
import {
  hasCurrentLegalAcceptance,
  LegalConsentGate,
  resetLegalConsentGateCache,
} from './LegalConsentGate.js';

function current(
  context: LegalAcceptanceRecord['context'] = 'onboarding',
): LegalAcceptanceRecord[] {
  return [
    {
      document: 'terms',
      version: TERMS_DOCUMENT_VERSION,
      acceptedAt: '2026-09-01T08:00:00Z',
      context,
    },
    {
      document: 'privacy',
      version: PRIVACY_DOCUMENT_VERSION,
      acceptedAt: '2026-09-01T08:00:00Z',
      context,
    },
  ];
}

async function renderGate(initialPath = '/app') {
  const i18n = initI18n();
  await i18n.changeLanguage('en');
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[initialPath]}>
        <LegalConsentGate>
          <p>protected content</p>
        </LegalConsentGate>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

const consentHeading = () =>
  screen.queryByRole('heading', { name: 'Accept the terms of service and the privacy policy' });

/**
 * GAP-5-01: an invited manager or viewer never reached onboarding or billing,
 * so nothing recorded their acceptance although the privacy policy says it is
 * recorded. Every "gate appears" assertion below fails against the code before
 * this component existed: the dashboard rendered unconditionally.
 */
describe('LegalConsentGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLegalConsentGateCache();
    mocks.userId = 'user-viewer';
    mocks.recordLegalAcceptance.mockResolvedValue({ acceptances: current('first-visit') });
  });

  it('withholds the app from a user with no acceptance on record', async () => {
    mocks.listLegalAcceptances.mockResolvedValue({ acceptances: [] });
    await renderGate();

    await waitFor(() => expect(consentHeading()).toBeInTheDocument());
    expect(screen.queryByText('protected content')).toBeNull();
    expect(screen.getByRole('link', { name: 'the terms of service' })).toHaveAttribute(
      'href',
      '/terms',
    );
    expect(screen.getByRole('link', { name: 'the privacy policy' })).toHaveAttribute(
      'href',
      '/privacy',
    );
    expect(mocks.recordLegalAcceptance).not.toHaveBeenCalled();
  });

  it('requires an affirmative tick before the acceptance can be submitted', async () => {
    mocks.listLegalAcceptances.mockResolvedValue({ acceptances: [] });
    await renderGate();
    const submit = await screen.findByRole('button', { name: 'Accept and enter' });

    expect(screen.getByRole('checkbox')).toBeRequired();
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit).toBeEnabled();
  });

  it('records both documents at the displayed versions with context first-visit, then lets the user in', async () => {
    mocks.listLegalAcceptances.mockResolvedValue({ acceptances: [] });
    await renderGate();
    fireEvent.click(await screen.findByRole('checkbox'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Accept and enter' }));
    });

    expect(mocks.recordLegalAcceptance).toHaveBeenCalledTimes(1);
    expect(mocks.recordLegalAcceptance).toHaveBeenCalledWith({
      documents: [
        { document: 'terms', version: TERMS_DOCUMENT_VERSION },
        { document: 'privacy', version: PRIVACY_DOCUMENT_VERSION },
      ],
      context: 'first-visit',
    });
    expect(await screen.findByText('protected content')).toBeInTheDocument();
    expect(consentHeading()).toBeNull();
  });

  it('keeps the gate and says so when the acceptance cannot be recorded', async () => {
    mocks.listLegalAcceptances.mockResolvedValue({ acceptances: [] });
    mocks.recordLegalAcceptance.mockRejectedValue(new ApiRequestError(503, 'UNAVAILABLE'));
    await renderGate();
    fireEvent.click(await screen.findByRole('checkbox'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Accept and enter' }));
    });

    // A failed write is a refusal, not a warning: letting the user through
    // here would recreate the original gap with a checkbox as decoration.
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not record your acceptance/);
    expect(screen.queryByText('protected content')).toBeNull();
    expect(consentHeading()).toBeInTheDocument();
  });

  it('renders the app without asking when both documents are already accepted at the current versions', async () => {
    mocks.listLegalAcceptances.mockResolvedValue({ acceptances: current() });
    await renderGate();

    expect(await screen.findByText('protected content')).toBeInTheDocument();
    await waitFor(() => expect(mocks.listLegalAcceptances).toHaveBeenCalledTimes(1));
    expect(consentHeading()).toBeNull();
    expect(mocks.recordLegalAcceptance).not.toHaveBeenCalled();
  });

  it('asks again when the acceptance on record is for a superseded version', async () => {
    mocks.listLegalAcceptances.mockResolvedValue({
      acceptances: [
        {
          document: 'terms',
          version: '2020-01-01',
          acceptedAt: '2020-01-02T00:00:00Z',
          context: 'billing',
        },
        {
          document: 'privacy',
          version: PRIVACY_DOCUMENT_VERSION,
          acceptedAt: '2026-09-01T08:00:00Z',
          context: 'billing',
        },
      ],
    });
    await renderGate();

    await waitFor(() => expect(consentHeading()).toBeInTheDocument());
    expect(screen.queryByText('protected content')).toBeNull();
  });

  it('fails open when the acceptance list cannot be fetched, and re-checks on the next mount', async () => {
    mocks.listLegalAcceptances.mockRejectedValue(new Error('network down'));
    const first = await renderGate();

    expect(await screen.findByText('protected content')).toBeInTheDocument();
    await waitFor(() => expect(mocks.listLegalAcceptances).toHaveBeenCalledTimes(1));
    expect(consentHeading()).toBeNull();
    first.unmount();

    mocks.listLegalAcceptances.mockResolvedValue({ acceptances: [] });
    await renderGate();
    await waitFor(() => expect(consentHeading()).toBeInTheDocument());
    expect(mocks.listLegalAcceptances).toHaveBeenCalledTimes(2);
  });

  it('does not ask twice in one session once the acceptance has been confirmed for this user', async () => {
    mocks.listLegalAcceptances.mockResolvedValue({ acceptances: current() });
    const first = await renderGate();
    expect(await screen.findByText('protected content')).toBeInTheDocument();
    await waitFor(() => expect(mocks.listLegalAcceptances).toHaveBeenCalledTimes(1));
    first.unmount();

    await renderGate();
    expect(screen.getByText('protected content')).toBeInTheDocument();
    expect(mocks.listLegalAcceptances).toHaveBeenCalledTimes(1);

    // A different account in the same tab is a different question.
    mocks.userId = 'user-other';
    mocks.listLegalAcceptances.mockResolvedValue({ acceptances: [] });
    await renderGate();
    await waitFor(() => expect(consentHeading()).toBeInTheDocument());
    expect(mocks.listLegalAcceptances).toHaveBeenCalledTimes(2);
  });

  it('never covers the worker portal and does not query acceptances there', async () => {
    mocks.listLegalAcceptances.mockResolvedValue({ acceptances: [] });
    await renderGate('/worker');

    expect(screen.getByText('protected content')).toBeInTheDocument();
    expect(mocks.listLegalAcceptances).not.toHaveBeenCalled();
  });

  it('offers a way out for a user who does not want to accept', async () => {
    mocks.listLegalAcceptances.mockResolvedValue({ acceptances: [] });
    await renderGate();

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out without accepting' }));
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });
});

describe('hasCurrentLegalAcceptance', () => {
  it('needs both documents at exactly the displayed versions', () => {
    expect(hasCurrentLegalAcceptance([])).toBe(false);
    expect(hasCurrentLegalAcceptance(current().slice(0, 1))).toBe(false);
    expect(hasCurrentLegalAcceptance(current())).toBe(true);
    expect(
      hasCurrentLegalAcceptance([
        ...current().slice(1),
        {
          document: 'terms',
          version: '2000-01-01',
          acceptedAt: '2000-01-01T00:00:00Z',
          context: 'billing',
        },
      ]),
    ).toBe(false);
  });
});
