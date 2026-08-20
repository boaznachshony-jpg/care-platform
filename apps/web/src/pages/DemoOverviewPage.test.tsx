import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { DemoOverviewPage } from './DemoOverviewPage.js';

/**
 * Tests inject their own openIssues bundle so they stay deterministic while
 * the shared he.json/en.json files are updated in a separate change.
 */
const openIssuesHe = {
  eyebrow: 'תמונת מצב',
  title: 'נושאים פתוחים במבט אחד',
  summary: 'ריכוז של כל מה שדורש טיפול בתיק ההעסקה, לפי דחיפות.',
  status: { urgent: 'דורש טיפול מיידי', soon: 'כדאי לטפל בקרוב', ok: 'הכול תקין' },
  countsTitle: 'סיכום לפי דחיפות',
  buckets: { urgent: 'דחוף', soon: 'בקרוב', ok: 'תקין' },
  scoreLabel: 'ציון {{score}} מתוך 100',
  healthTitle: 'מדד שלמות התיק',
  healthDisclaimer: 'מדד שלמות המבוסס על המידע בתיק; אינו אישור לעמידה בדין.',
  empty: {
    urgent: 'אין נושאים דחופים לטיפול',
    soon: 'אין נושאים שממתינים לטיפול קרוב',
    ok: 'עדיין אין נושאים תקינים להצגה',
  },
  missingTitle: 'חסרים {{count}} פרטים חיוניים',
  completeInSettings: 'השלמה בהגדרות',
  reviewDates: 'בדיקת התאריכים',
  expiresInDays: 'פג תוקף בעוד {{count}} ימים',
  expiredDaysAgo: 'פג תוקף לפני {{count}} ימים',
  dates: {
    visa: 'תוקף אשרת העבודה',
    license: 'תוקף רישיון ההעסקה',
    insurance: 'תוקף הביטוח הרפואי',
  },
  fields: {
    baseSalary: 'שכר בסיס',
    saturdayRate: 'תעריף שבת',
  },
  demoBanner: 'תצוגת הדגמה — נתונים לדוגמה בלבד',
  demoDetailsTitle: 'פרטי התיק לדוגמה',
  demoRecipient: 'מקבלת הטיפול',
  demoCaregiver: 'המטפלת',
};

const fetchMock = vi.fn();
let getItemSpy: MockInstance<(key: string) => string | null>;

function renderPage() {
  const i18n = initI18n();
  i18n.addResourceBundle('he', 'translation', { openIssues: openIssuesHe }, true, true);
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/demo/overview']}>
        <Routes>
          <Route path="/demo/overview" element={<DemoOverviewPage />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('DemoOverviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    getItemSpy.mockRestore();
  });

  it('shows the demo banner', () => {
    renderPage();
    expect(screen.getByText('תצוגת הדגמה — נתונים לדוגמה בלבד')).toBeInTheDocument();
  });

  it('shows the fictional recipient and caregiver names', () => {
    renderPage();
    expect(screen.getByText('רות כהן')).toBeInTheDocument();
    expect(screen.getByText('מריה סנטוס')).toBeInTheDocument();
  });

  it('renders the same glance layout with demo issues', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'נושאים פתוחים במבט אחד' })).toBeInTheDocument();
    expect(screen.getByText('תוקף אשרת העבודה')).toBeInTheDocument();
    expect(screen.getByText('פג תוקף בעוד 9 ימים')).toBeInTheDocument();
    expect(screen.getByText('72')).toBeInTheDocument();
  });

  it('does not call the API or read persistent storage', () => {
    renderPage();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
  });
});
