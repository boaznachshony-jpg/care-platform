import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { emptyMvpProfile, readMvpProfile, saveMvpProfile } from '../storage/mvp-storage.js';
import { SettingsPage } from './SettingsPage.js';

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

describe('SettingsPage complete client profile', () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, '', '/clients/client-1/settings');
    saveMvpProfile({
      ...emptyMvpProfile,
      recipientName: 'Sample Recipient',
      employerName: 'Sample Employer',
      employerIdNumber: '038852562',
      employerPhone: '050-0000000',
    });
  });

  it('edits and persists recipient, employer, and representative details', async () => {
    await renderPage();

    fireEvent.change(screen.getAllByLabelText('City or locality')[0]!, {
      target: { value: 'Haifa' },
    });
    fireEvent.change(screen.getByLabelText('Health fund'), {
      target: { value: 'Sample Health Fund' },
    });
    fireEvent.change(screen.getAllByLabelText('Email')[0]!, {
      target: { value: 'recipient@example.test' },
    });
    fireEvent.change(screen.getAllByLabelText('Relationship to care recipient')[0]!, {
      target: { value: 'Family member' },
    });
    fireEvent.change(screen.getByLabelText(/^Caregiver passport number/), {
      target: { value: 'ab-123 456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(readMvpProfile()).toMatchObject({
      recipientCity: 'Haifa',
      recipientHealthFund: 'Sample Health Fund',
      recipientEmail: 'recipient@example.test',
      employerRelationship: 'Family member',
      caregiverPassportNumber: 'AB123456',
    });
    expect(screen.getByText('Changes saved successfully')).toBeVisible();
  });

  it('blocks saving an invalid client profile', async () => {
    await renderPage();

    fireEvent.change(screen.getAllByLabelText('Email')[0]!, {
      target: { value: 'not-an-email' },
    });

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('keeps Israeli IDs numeric and caregiver passports alphanumeric', async () => {
    await renderPage();

    fireEvent.change(screen.getByLabelText('Care recipient ID number'), {
      target: { value: 'AB-038 852 562' },
    });
    fireEvent.change(screen.getByLabelText(/^Caregiver passport number/), {
      target: { value: 'ab-123 456!' },
    });

    expect(screen.getByLabelText('Care recipient ID number')).toHaveValue('038852562');
    expect(screen.getByLabelText(/^Caregiver passport number/)).toHaveValue('AB123456');
  });

  it('shows the data security notice', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { name: 'Data security' })).toBeVisible();
    expect(screen.getByText(/stored encrypted on your device/)).toBeVisible();
    expect(readMvpProfile().recipientName).toBe('Sample Recipient');
  });
});

describe('SettingsPage prefills details captured during client setup', () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, '', '/clients/client-1/settings');
  });

  it('renders the recipient section from the stored setup profile', async () => {
    saveMvpProfile({
      ...emptyMvpProfile,
      recipientName: 'Sample Recipient',
      recipientIdNumber: '038852562',
      recipientBirthDate: '1940-05-03',
      recipientPhone: '050-1111111',
      recipientEmail: 'recipient@example.test',
      recipientHealthFund: 'Sample Health Fund',
      employerName: 'Sample Employer',
      employerIdNumber: '000000018',
      employerPhone: '050-2222222',
    });

    await renderPage();

    expect(screen.getByLabelText('Care recipient name')).toHaveValue('Sample Recipient');
    expect(screen.getByLabelText('Care recipient ID number')).toHaveValue('038852562');
    expect(screen.getByLabelText('Health fund')).toHaveValue('Sample Health Fund');
  });

  it('mirrors the identity details onto the recipient when setup recorded one person', async () => {
    // Onboarding asks for the ID and phone only once, on the employer step.
    saveMvpProfile({
      ...emptyMvpProfile,
      recipientName: 'Sample Person',
      employerName: 'Sample Person',
      employerIdNumber: '038852562',
      employerPhone: '050-1111111',
      employerEmail: 'person@example.test',
      onboardingCompleted: true,
    });

    await renderPage();

    expect(screen.getByLabelText('Care recipient ID number')).toHaveValue('038852562');
    expect(screen.getAllByLabelText('Phone number')[0]).toHaveValue('050-1111111');
    expect(screen.getAllByLabelText('Email')[0]).toHaveValue('person@example.test');
  });

  it('does not cross-fill the recipient when the employer is a different person', async () => {
    saveMvpProfile({
      ...emptyMvpProfile,
      recipientName: 'Sample Recipient',
      employerName: 'Sample Employer',
      employerIdNumber: '038852562',
      employerPhone: '050-1111111',
      onboardingCompleted: true,
    });

    await renderPage();

    expect(screen.getByLabelText('Care recipient ID number')).toHaveValue('');
    expect(screen.getAllByLabelText('Phone number')[0]).toHaveValue('');
  });

  it('picks up a profile that arrives after the first render while the form is untouched', async () => {
    await renderPage();
    expect(screen.getByLabelText('Care recipient name')).toHaveValue('');

    await act(async () => {
      saveMvpProfile({
        ...emptyMvpProfile,
        recipientName: 'Late Recipient',
        recipientHealthFund: 'Late Health Fund',
        employerName: 'Late Employer',
        employerIdNumber: '038852562',
        employerPhone: '050-1111111',
      });
    });

    expect(screen.getByLabelText('Care recipient name')).toHaveValue('Late Recipient');
    expect(screen.getByLabelText('Health fund')).toHaveValue('Late Health Fund');
  });

  it('keeps values the user is editing when a later profile arrives', async () => {
    saveMvpProfile({
      ...emptyMvpProfile,
      recipientName: 'Sample Recipient',
      employerName: 'Sample Employer',
      employerIdNumber: '038852562',
      employerPhone: '050-1111111',
    });
    await renderPage();

    fireEvent.change(screen.getByLabelText('Health fund'), {
      target: { value: 'Typed Health Fund' },
    });

    await act(async () => {
      saveMvpProfile({
        ...emptyMvpProfile,
        recipientName: 'Sample Recipient',
        recipientHealthFund: 'Remote Health Fund',
        employerName: 'Sample Employer',
        employerIdNumber: '038852562',
        employerPhone: '050-1111111',
      });
    });

    expect(screen.getByLabelText('Health fund')).toHaveValue('Typed Health Fund');
  });
});
