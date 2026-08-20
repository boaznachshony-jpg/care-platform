import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { NATIONAL_INSURANCE_PAYMENT_URL } from '../upcoming-payments.js';
import { UpcomingPaymentsCard } from './UpcomingPaymentsCard.js';

function renderCard(today: Date) {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <UpcomingPaymentsCard today={today} />
    </I18nextProvider>,
  );
}

describe('UpcomingPaymentsCard', () => {
  it('always shows both payment obligations with due dates and day counts', () => {
    renderCard(new Date('2026-08-20T10:00:00'));

    expect(screen.getByRole('heading', { name: 'תשלומים קרובים' })).toBeInTheDocument();
    expect(screen.getByText('תשלום השכר הקרוב')).toBeInTheDocument();
    expect(screen.getByText('תאריך יעד: 09.09.2026 · בעוד 20 ימים')).toBeInTheDocument();
    expect(screen.getByText('תשלום דמי ביטוח לאומי (רבעוני)')).toBeInTheDocument();
    expect(screen.getByText('תאריך יעד: 15.10.2026 · בעוד 56 ימים')).toBeInTheDocument();
    expect(screen.getByText('עד ה-15 בחודש אוקטובר')).toBeInTheDocument();
  });

  it('links to the official Bituach Leumi payment service in a new tab', () => {
    renderCard(new Date('2026-08-20T10:00:00'));

    const link = screen.getByRole('link', { name: 'לתשלום באתר הביטוח הלאומי' });
    expect(link).toHaveAttribute('href', NATIONAL_INSURANCE_PAYMENT_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('marks an obligation that is due today', () => {
    renderCard(new Date('2026-07-09T10:00:00'));

    expect(screen.getByText('תאריך יעד: 09.07.2026 · המועד הוא היום')).toBeInTheDocument();
    expect(screen.getByText('תאריך יעד: 15.07.2026 · בעוד 6 ימים')).toBeInTheDocument();
  });

  it('rolls the quarterly deadline over the year boundary', () => {
    renderCard(new Date('2026-12-20T10:00:00'));

    expect(screen.getByText('תאריך יעד: 09.01.2027 · בעוד 20 ימים')).toBeInTheDocument();
    expect(screen.getByText('תאריך יעד: 15.01.2027 · בעוד 26 ימים')).toBeInTheDocument();
    expect(screen.getByText('עד ה-15 בחודש ינואר')).toBeInTheDocument();
  });
});
