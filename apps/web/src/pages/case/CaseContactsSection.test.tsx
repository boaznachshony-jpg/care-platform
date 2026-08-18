import { render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { CaseContactsSection } from './CaseContactsSection.js';

// Constitution §16: synthetic data only.
const DEMO_CASE_ID = 'case-demo-001';

const mockListCaseContacts = vi.fn();
const mockAddCaseContact = vi.fn();

vi.mock('../../api/client.js', () => ({
  listCaseContacts: (...args: unknown[]) => mockListCaseContacts(...args),
  addCaseContact: (...args: unknown[]) => mockAddCaseContact(...args),
}));

function renderSection(caseId = DEMO_CASE_ID) {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <CaseContactsSection caseId={caseId} />
    </I18nextProvider>,
  );
}

describe('CaseContactsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddCaseContact.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('empty state', () => {
    beforeEach(() => {
      mockListCaseContacts.mockResolvedValue([]);
    });

    it('shows empty state when no contacts exist', async () => {
      renderSection();
      await waitFor(() =>
        expect(screen.getByText('עדיין לא נוספו אנשי קשר לתיק.')).toBeInTheDocument(),
      );
    });

    it('shows the section heading', async () => {
      renderSection();
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'אנשי קשר' })).toBeInTheDocument(),
      );
    });
  });

  describe('with contacts', () => {
    beforeEach(() => {
      mockListCaseContacts.mockResolvedValue([
        {
          roleId: 'contact-001',
          organizationName: 'תאגיד בדיקה',
          fullName: 'איש קשר בדיקה',
          roleType: 'bureau_contact',
          isPrimary: true,
          isEmergency: false,
          caseId: DEMO_CASE_ID,
        },
      ]);
    });

    it('displays the contact organization name', async () => {
      renderSection();
      // organizationName is rendered as " · תאגיד בדיקה" inside the <li> — use regex
      await waitFor(() => expect(screen.getByText(/תאגיד בדיקה/)).toBeInTheDocument());
    });

    it('displays the primary contact badge', async () => {
      renderSection();
      await waitFor(() => expect(screen.getByText('ראשי')).toBeInTheDocument());
    });
  });
});
