import { useTranslation } from 'react-i18next';
import {
  createUpcomingPayments,
  formatDisplayDate,
  type UpcomingPayment,
} from '../upcoming-payments.js';
import {
  earlierQuartersNote,
  overdueDaysLabel,
  type QuarterlyInsuranceContext,
} from '../national-insurance-presenter.js';
import { readMvpEmploymentExpenses, readMvpProfile } from '../storage/mvp-storage.js';

/**
 * Always-visible card with the two recurring payment obligations of a
 * household employer: the next salary payment (due by the 9th of the month)
 * and the quarterly National Insurance payment (due by the 15th of
 * April / July / October / January), including the official payment link.
 *
 * D: a passed National Insurance deadline that is not marked paid stays on
 * this card as overdue, and older unpaid quarters are counted under it. The
 * marks come from the payroll screen's periodic payments; without a
 * `nationalInsurance` prop they are read from this device's workspace.
 */
export function UpcomingPaymentsCard({
  today,
  nationalInsurance,
}: { today?: Date; nationalInsurance?: QuarterlyInsuranceContext } = {}) {
  const { t, i18n } = useTranslation();
  const payments = createUpcomingPayments(
    today,
    nationalInsurance ?? {
      expenses: readMvpEmploymentExpenses(),
      employmentStartDate: readMvpProfile().employmentStartDate,
    },
  );

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
      {/* Placed above the dates, not after them: the reader must see the caveat
          while looking at the due dates, not once they have already acted. */}
      <p className="legal-note">{t('liability.reminder')}</p>
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
                  : payment.daysRemaining < 0
                    ? overdueDaysLabel(payment.daysRemaining)
                    : t('payments.daysRemaining', { count: payment.daysRemaining })}
              </p>
              <small>
                {payment.id === 'salary'
                  ? t('payments.salaryNote')
                  : t('payments.nationalInsuranceNote', { month: dueMonthName(payment) })}
              </small>
              {payment.earlierOutstanding ? (
                <p className="form-note">{earlierQuartersNote(payment.earlierOutstanding)}</p>
              ) : null}
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
