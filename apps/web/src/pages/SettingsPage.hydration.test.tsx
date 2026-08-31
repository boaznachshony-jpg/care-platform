import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import {
  emptyMvpProfile,
  MVP_PROFILE_CHANGED,
  readMvpProfile,
  saveMvpProfile,
} from '../storage/mvp-storage.js';
import { SettingsPage } from './SettingsPage.js';

/**
 * WEB-03. `draft` was seeded once from `profile`; the effect that re-synced it
 * to a later-arriving profile was disabled permanently after the first
 * keystroke (`if (!edited)`), and submit wrote the WHOLE draft object.
 *
 * The lost-data sequence, on a phone with a stale device cache: the user types
 * one character, background hydration replaces the store with the fuller
 * server profile, and pressing "save" writes the stale copy of every untouched
 * field back over it — destroying another device's edits.
 *
 * The pre-existing test only asserted that the EDITED field survives
 * hydration. These assert that the untouched ones do not get clobbered.
 */

async function renderPage() {
  const i18n = initI18n();
  await i18n.changeLanguage('en');
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/clients/client-1/settings']}>
        <Routes>
          <Route path="/clients/:clientId/settings" element={<SettingsPage />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

/** "Phone number" labels both the recipient and the employer field. */
function employerPhoneField(): HTMLInputElement {
  return document.getElementById('settings-employer-phone') as HTMLInputElement;
}

/** Stands in for `replaceMvpWorkspace` landing from the server. */
function hydrateFromServer(changes: Partial<typeof emptyMvpProfile>) {
  act(() => {
    saveMvpProfile({ ...readMvpProfile(), ...changes });
    window.dispatchEvent(new CustomEvent(MVP_PROFILE_CHANGED));
  });
}

describe('SettingsPage hydration race', () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, '', '/clients/client-1/settings');
    // Constitution §16: synthetic data only.
    saveMvpProfile({
      ...emptyMvpProfile,
      recipientName: 'Sample Recipient',
      employerName: 'Sample Employer',
      employerIdNumber: '038852562',
      employerPhone: '050-0000000',
    });
  });

  it('keeps a later-arriving value for a field the user never touched', async () => {
    await renderPage();

    // One keystroke in one field — this is what used to freeze the whole form.
    fireEvent.change(employerPhoneField(), { target: { value: '050-1111111' } });

    // The spouse's device already recorded the bureau contact; it lands now.
    hydrateFromServer({ licensedBureauContactName: 'Sample Bureau Contact' });

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    const stored = readMvpProfile();
    expect(stored.employerPhone).toBe('050-1111111');
    // Without the per-field merge this reads '' — the other device's edit gone.
    expect(stored.licensedBureauContactName).toBe('Sample Bureau Contact');
  });

  it('writes only the fields this user changed, onto the profile as it stands now', async () => {
    await renderPage();

    fireEvent.change(employerPhoneField(), { target: { value: '050-2222222' } });
    hydrateFromServer({ recipientHealthFund: 'Sample Health Fund' });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    const stored = readMvpProfile();
    expect(stored.recipientHealthFund).toBe('Sample Health Fund');
    expect(stored.employerPhone).toBe('050-2222222');
  });

  /**
   * WEB-22: a draft -> in_review -> approved -> active -> retired editor for
   * regulatory content rendered unconditionally at the bottom of every family
   * employer's Settings page, and produced a permanent load-error alert there.
   */
  it('does not render the regulation-rule console on a consumer settings screen', async () => {
    await renderPage();
    expect(screen.queryByText(/regulation/i)).not.toBeInTheDocument();
  });
});
