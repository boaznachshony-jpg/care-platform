import { render, screen, waitFor, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { initI18n } from '@caredesk/i18n';
import { CaseDocumentsSection } from './CaseDocumentsSection.js';

function renderSection() {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <CaseDocumentsSection caseId="case-1" />
    </I18nextProvider>,
  );
}

describe('CaseDocumentsSection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('with no documents', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }),
      );
    });

    it('shows the empty state in Hebrew from i18n', async () => {
      renderSection();
      await waitFor(() => {
        expect(screen.getByText('עדיין לא הועלו מסמכים לתיק.')).toBeInTheDocument();
      });
    });

    it('has no detectable accessibility violations', async () => {
      const { container } = renderSection();
      await waitFor(() => screen.getByText('עדיין לא הועלו מסמכים לתיק.'));
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  describe('with documents', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 'doc-1',
                documentType: 'passport',
                sensitivity: 'identity_sensitive',
                complianceStatus: 'expiring',
                expiresAt: '2026-09-01T00:00:00.000Z',
                status: 'active',
                currentVersionNumber: 1,
                verificationStatus: 'pending_verification',
                mediaType: 'application/pdf',
                sizeBytes: 1024,
                uploadedAt: '2026-03-01T09:00:00.000Z',
              },
            ]),
        }),
      );
    });

    it('renders the type, compliance and verification badges, and a plain expiry date', async () => {
      renderSection();
      const item = await screen.findByRole('listitem');

      // Scoped to the list: "דרכון" also appears as a <select> option.
      expect(within(item).getByText('דרכון')).toBeInTheDocument();
      expect(within(item).getByText('מתקרב לתפוגה')).toBeInTheDocument();
      expect(within(item).getByText('ממתין לאימות')).toBeInTheDocument();
      // Shown as the stored calendar day, not a timezone-shifted rendering.
      expect(within(item).getByText('2026-09-01')).toBeInTheDocument();
    });

    it('offers an open action rather than exposing a link to the file', async () => {
      renderSection();
      await screen.findByRole('listitem');
      expect(screen.getByRole('button', { name: 'פתיחת המסמך' })).toBeInTheDocument();
      // No signed link is ever placed in the DOM ahead of time.
      expect(document.querySelector('a[href*="signed"]')).toBeNull();
    });

    it('has no detectable accessibility violations with a populated list', async () => {
      const { container } = renderSection();
      await screen.findByRole('listitem');
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
