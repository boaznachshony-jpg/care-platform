import { render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initI18n,
  PRIVACY_DOCUMENT_VERSION,
  PRIVACY_SECTION_COUNT,
  TERMS_DOCUMENT_VERSION,
  TERMS_SECTION_COUNT,
} from '@caredesk/i18n';
import { App } from '../App.js';

/**
 * The site had billing terms and nothing else: no תקנון and no privacy policy,
 * in a product that holds a third party's passport scans and medication
 * records. Every assertion here fails against the code before this change,
 * because /terms and /privacy fell through to ApplicationEntry and redirected
 * to the marketing page.
 *
 * The pages are exercised through <App /> rather than by rendering the
 * components directly, because half of what is asserted is that the routes
 * exist at all.
 */
function renderRoute(path: string) {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

const sectionHeadings = () =>
  screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent ?? '');

describe('public legal pages', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true } as Response));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('/terms', () => {
    it('renders the full תקנון with every declared section', () => {
      renderRoute('/terms');
      expect(screen.getByRole('heading', { level: 1, name: /תקנון השימוש/ })).toBeInTheDocument();
      // The 14 numbered sections plus the related-documents block.
      expect(sectionHeadings()).toHaveLength(TERMS_SECTION_COUNT + 1);
      for (const section of [
        'פרטי המפעיל',
        'הגדרות',
        'כשירות להתקשר',
        'מהות השירות ומגבלותיו',
        'רישיון שימוש ואיסורים',
        'תוכן משתמש',
        'קניין רוחני',
        'חיוב מתחדש',
        'זכות ביטול',
        'השעיה והפסקת שירות',
        'הגבלת אחריות',
        'שינוי התנאים',
        'דין וסמכות שיפוט',
        'יצירת קשר',
      ]) {
        expect(
          sectionHeadings().some((heading) => heading.includes(section)),
          section,
        ).toBe(true);
      }
    });

    it('shows the version from the constant and says a lawyer has not reviewed it', () => {
      renderRoute('/terms');
      // The anti-drift property, observed on the rendered page: the version the
      // user sees is the constant the acceptance request carries.
      const note = screen.getByText(new RegExp(TERMS_DOCUMENT_VERSION));
      expect(note.textContent).toMatch(/עורך\/ת דין/);
    });

    it('carries the operator details and the marked address placeholder', () => {
      renderRoute('/terms');
      expect(screen.getByText(/056543507/)).toBeInTheDocument();
      expect(screen.getAllByText(/boaz\.nachshony@gmail\.com/).length).toBeGreaterThan(0);
      // Deliberately a placeholder: no postal address was supplied, and
      // inventing one would be a false statement in a document whose entire
      // value is that it is true.
      expect(screen.getAllByText(/\[כתובת לפניות — להשלמה\]/).length).toBeGreaterThan(0);
    });

    it('names Israeli law and the Tel Aviv-Yafo courts', () => {
      renderRoute('/terms');
      expect(screen.getByText(/תל אביב-יפו/)).toBeInTheDocument();
    });

    it('links onward to the billing terms and to the privacy policy', () => {
      const { container } = renderRoute('/terms');
      const related = container.querySelector('.public-legal-related');
      expect(related).not.toBeNull();
      expect(
        within(related as HTMLElement)
          .getAllByRole('link')
          .map((link) => link.getAttribute('href')),
      ).toEqual(['/terms/subscription', '/privacy']);
    });
  });

  describe('/privacy', () => {
    it('renders the privacy policy with every declared section', () => {
      renderRoute('/privacy');
      expect(
        screen.getByRole('heading', { level: 1, name: /מדיניות הפרטיות/ }),
      ).toBeInTheDocument();
      expect(sectionHeadings()).toHaveLength(PRIVACY_SECTION_COUNT + 1);
    });

    it('shows the version from the constant and the pending-review line', () => {
      renderRoute('/privacy');
      const note = screen.getByText(new RegExp(PRIVACY_DOCUMENT_VERSION));
      expect(note.textContent).toMatch(/עורך\/ת דין/);
    });

    it('names every sub-processor and where the data physically is', () => {
      renderRoute('/privacy');
      const processors = screen.getByText(/Supabase/);
      for (const name of ['Supabase', 'Vercel', 'Cardcom', 'Resend', 'פרנקפורט']) {
        expect(processors.textContent, name).toContain(name);
      }
    });

    it('puts the lawful basis for the caregiver data on the account holder', () => {
      renderRoute('/privacy');
      // The single most important sentence in the document: the account holder
      // enters another person's identity documents, and the obligation to have
      // a basis for holding them is theirs, not the operator's.
      const clause = screen.getByRole('heading', { level: 2, name: /אחריות בעל החשבון/ });
      expect(clause).toBeInTheDocument();
      expect(screen.getAllByText(/בסיס חוקי/).length).toBeGreaterThan(0);
    });

    it('describes encryption at rest, the right of access, and breach notification', () => {
      renderRoute('/privacy');
      expect(screen.getByText(/מוצפנים במנוחה/)).toBeInTheDocument();
      expect(screen.getByText(/חוק הגנת הפרטיות, התשמ״א-1981/)).toBeInTheDocument();
      expect(screen.getByText(/72 שעות/)).toBeInTheDocument();
    });
  });

  describe('/terms/subscription', () => {
    it('still resolves to the billing terms and is not redirected away', () => {
      // `product_subscription.terms_version` already records '2026-08-04'
      // against this URL for existing subscriptions. Redirecting it would
      // silently change what those customers are recorded as having agreed to.
      renderRoute('/terms/subscription');
      expect(
        screen.getByRole('heading', { level: 1, name: /תנאי מנוי וחיוב חודשי/ }),
      ).toBeInTheDocument();
    });
  });

  describe('public footer', () => {
    it('offers both new documents alongside the existing links', () => {
      const { container } = renderRoute('/terms');
      const footer = container.querySelector('.public-footer-links')!;
      expect(
        within(footer as HTMLElement)
          .getAllByRole('link')
          .map((link) => link.getAttribute('href')),
      ).toEqual(['/terms', '/privacy', '/terms/subscription', '/contact-us']);
    });
  });
});
