import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPeriodPayrollReport } from '../payroll-report.js';
import { readMvpPayroll } from '../storage/mvp-storage.js';

const currentMonth = new Date().toISOString().slice(0, 7);

export function ReportsPage() {
  const { t, i18n } = useTranslation();
  const [records] = useState(readMvpPayroll);
  const storedMonths = records.map((record) => record.month).sort();
  const [startMonth, setStartMonth] = useState(storedMonths[0] ?? `${currentMonth.slice(0, 4)}-01`);
  const [endMonth, setEndMonth] = useState(storedMonths.at(-1) ?? currentMonth);
  const validRange = Boolean(startMonth && endMonth && startMonth <= endMonth);
  const report = useMemo(
    () => createPeriodPayrollReport(records, startMonth, endMonth),
    [records, startMonth, endMonth],
  );
  const money = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language === 'en' ? 'en-IL' : 'he-IL', {
        style: 'currency',
        currency: 'ILS',
      }),
    [i18n.language],
  );
  const additions = [
    ['reports.components.baseSalary', report.baseSalary],
    ['reports.components.saturdays', report.saturdayPay],
    ['reports.components.holidays', report.holidayPay],
    ['reports.components.vacationPay', report.vacationPay],
    ['reports.components.sickPay', report.sickPay],
    ['reports.components.employerContributions', report.employerContributions],
    ['reports.components.otherAddition', report.otherAddition],
    ['reports.components.additionalPayments', report.additionalPayments],
  ] as const;
  const deductions = [
    ['reports.components.pocketMoney', report.pocketMoney],
    ['reports.components.medicalInsurance', report.medicalInsuranceDeduction],
    ['reports.components.housing', report.housingDeduction],
    ['reports.components.advances', report.advances],
    ['reports.components.agreedDeduction', report.agreedDeduction],
  ] as const;

  return (
    <div className="page-stack reports-page" dir={i18n.dir()} lang={i18n.language}>
      <header className="page-header">
        <div>
          <p className="eyebrow">{t('reports.eyebrow')}</p>
          <h1>{t('reports.title')}</h1>
          <p>{t('reports.intro')}</p>
        </div>
      </header>

      <section className="card reports-filter" aria-labelledby="reports-filter-title">
        <h2 id="reports-filter-title">{t('reports.periodTitle')}</h2>
        <div className="form-grid">
          <label>
            {t('reports.fromMonth')}
            <input
              type="month"
              aria-label={t('reports.fromMonth')}
              value={startMonth}
              max={currentMonth}
              onChange={(event) => setStartMonth(event.target.value)}
            />
          </label>
          <label>
            {t('reports.toMonth')}
            <input
              type="month"
              aria-label={t('reports.toMonth')}
              value={endMonth}
              max={currentMonth}
              onChange={(event) => setEndMonth(event.target.value)}
            />
          </label>
        </div>
        {!validRange ? (
          <p className="info-box" role="alert">
            {t('reports.invalidRange')}
          </p>
        ) : null}
      </section>

      {validRange ? (
        <>
          <section className="reports-kpis" aria-label={t('reports.summaryAria')}>
            <article className="card">
              <span>{t('reports.monthsWithData')}</span>
              <strong>{report.monthsReported}</strong>
            </article>
            <article className="card">
              <span>{t('reports.totalAdditions')}</span>
              <strong>{money.format(report.additions)}</strong>
            </article>
            <article className="card">
              <span>{t('reports.totalDeductions')}</span>
              <strong>{money.format(report.deductions)}</strong>
            </article>
            <article className="card">
              <span>{t('reports.calculatedFinal')}</span>
              <strong>{money.format(report.calculatedFinalTotal)}</strong>
            </article>
          </section>

          {report.monthsReported === 0 ? (
            <p className="info-box" role="status">
              {t('reports.empty')}
            </p>
          ) : null}
          {report.recordsWithMissingOptionalFields > 0 ? (
            <p className="info-box" role="note">
              {t('reports.legacyNote', { count: report.recordsWithMissingOptionalFields })}
            </p>
          ) : null}
          <p className="form-note">{t('reports.notPaymentProof')}</p>

          <section className="card reports-table-card">
            <h2>{t('reports.payComponentsTitle')}</h2>
            <div className="reports-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('reports.component')}</th>
                    <th scope="col">{t('reports.accumulatedAmount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {additions.map(([key, value]) => (
                    <tr key={key}>
                      <th scope="row">{t(key)}</th>
                      <td>{money.format(value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card reports-table-card">
            <h2>{t('reports.deductionsTitle')}</h2>
            <div className="reports-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('reports.component')}</th>
                    <th scope="col">{t('reports.accumulatedAmount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {deductions.map(([key, value]) => (
                    <tr key={key}>
                      <th scope="row">{t(key)}</th>
                      <td>{money.format(value)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">{t('reports.recordedDeductionBalance')}</th>
                    <td>{money.format(report.deductions)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <section className="card reports-days">
            <h2>{t('reports.daysTitle')}</h2>
            <dl>
              <div>
                <dt>{t('reports.vacationDays')}</dt>
                <dd>{report.vacationDays}</dd>
              </div>
              <div>
                <dt>{t('reports.sickDays')}</dt>
                <dd>{report.sickDays}</dd>
              </div>
              <div>
                <dt>{t('reports.holidayDays')}</dt>
                <dd>{report.paidHolidays}</dd>
              </div>
              <div>
                <dt>{t('reports.specialAdvances')}</dt>
                <dd>{money.format(report.advances)}</dd>
              </div>
            </dl>
            <small>{t('reports.noCarryBalance')}</small>
          </section>
        </>
      ) : null}
    </div>
  );
}
