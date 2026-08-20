import { useTranslation } from 'react-i18next';
import {
  createUpcomingPayments,
  formatDisplayDate,
  type UpcomingPayment,
} from '../upcoming-payments.js';

/**
 * Always-visible card with the two recurring payment obligations of a
 * household employer: the next salary payment (due by the 9th of the month)
 * and the next quarterly National Insurance payment (due by the 15th of
 * April / July / October / January), including the official payment link.
 */
export function UpcomingPaymentsCard({ today }: { today?: Date } = {}) {
  const { t, i18n } = useTranslation();
  const payments = createUpcomingPayments(today);

  const dueMonthName = (payment: UpcomingPayment) =>
    new Intl.DateTimeFormat(i18n.language, { month: 'long' }).format(
      new Date(`${payment.dueDate}T12:00:00`),
    );

  return (
    <section className="card" aria-labelledby="upcoming-payments-title">
      <div className="section-heading">
        <h2 id="upcoming-payments-title">{t('payments.upcomingTitle')}</h2>
      </div>
      <p>{t('payments.upcomingSummary')}</p>
      <div className="attention-list">
        {payments.map((payment) => (
          <article className="attention-item" key={payment.id}>
            <div>
              <strong>{t(`payments.${payment.id}Title`)}</strong>
              <p>
                {t('payments.dueDate', { date: formatDisplayDate(payment.dueDate) })}
                {' · '}
                {payment.daysRemaining === 0
                  ? t('payments.dueToday')
                  : t('payments.daysRemaining', { count: payment.daysRemaining })}
              </p>
              <small>
                {payment.id === 'salary'
                  ? t('payments.salaryNote')
                  : t('payments.nationalInsuranceNote', { month: dueMonthName(payment) })}
              </small>
            </div>
            {payment.externalUrl ? (
              <a
                className="secondary-button"
                href={payment.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('payments.payOnline')}
              </a>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
