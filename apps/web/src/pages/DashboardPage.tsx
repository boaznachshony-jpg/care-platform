import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useClientPath } from '../hooks/use-client-path.js';
import { useMvpProfile } from '../hooks/use-mvp-profile.js';
import { getCaseHealth, type CaseHealthResponse } from '../api/client.js';
import { UpcomingPaymentsCard } from '../components/UpcomingPaymentsCard.js';
import { createUpcomingPayments, formatDisplayDate } from '../upcoming-payments.js';

type DashboardTabId = 'overview' | 'payments' | 'case';

const dashboardTabs = [
  ['overview', 'dashboard.tabOverview'],
  ['payments', 'dashboard.tabPayments'],
  ['case', 'dashboard.tabCase'],
] as const;

/* Simple inline glyphs (stroke only) for the gradient stat chips — no icon library. */
const chipIcons = {
  score: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  attention: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5" strokeLinecap="round" />
      <path d="M12 16.2v.1" strokeLinecap="round" />
    </svg>
  ),
  salary: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="7" width="18" height="10" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  ),
  insurance: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M4 10h16" strokeLinecap="round" />
    </svg>
  ),
} as const;

export function DashboardPage() {
  const path = useClientPath();
  const { t } = useTranslation();
  const [profile] = useMvpProfile();
  const { clientId } = useParams<{ clientId: string }>();
  const [health, setHealth] = useState<CaseHealthResponse>();
  const [activeTab, setActiveTab] = useState<DashboardTabId>('overview');
  useEffect(() => {
    if (clientId) void getCaseHealth(clientId).then(setHealth);
  }, [clientId]);
  const selectTab = (tab: DashboardTabId) => {
    setActiveTab(tab);
    document.getElementById(`dashboard-${tab}`)?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'start',
    });
  };
  const upcomingPayments = createUpcomingPayments();
  const nextSalary = upcomingPayments.find((payment) => payment.id === 'salary');
  const nextInsurance = upcomingPayments.find((payment) => payment.id === 'nationalInsurance');
  const attentionCount =
    health?.factors.filter((factor) => factor.status === 'attention').length ?? 0;
  const missingCount = [
    !profile.employerName.trim(),
    !profile.recipientName.trim(),
    !profile.caregiverName.trim(),
    !profile.employmentStartDate.trim(),
    !profile.representativeName.trim(),
    !profile.licensedBureauName.trim(),
    !profile.licensedBureauContactName.trim(),
    !profile.licensedBureauContactPhone.trim(),
    !profile.employmentAgreementConfirmed,
    !profile.medicalInsuranceConfirmed || !profile.medicalInsuranceExpiryDate,
    (profile.baseSalary ?? 0) <= 0,
    (profile.saturdayRate ?? 0) <= 0,
    !profile.licenseRenewalDate,
    !profile.visaRenewalDate,
  ].filter(Boolean).length;
  const hasAttention = health?.factors.some((factor) => factor.status === 'attention') ?? false;
  const status: 'missing' | 'attention' | 'ok' | 'loading' =
    missingCount > 0 ? 'missing' : !health ? 'loading' : hasAttention ? 'attention' : 'ok';
  const statusChipKey =
    status === 'missing'
      ? 'dashboard.statusMissing'
      : status === 'loading'
        ? 'dashboard.statusLoading'
        : status === 'attention'
          ? 'dashboard.statusAttention'
          : 'dashboard.statusOk';

  return (
    <div className="page-stack">
      <nav className="dash-tabs" aria-label={t('dashboard.tabsLabel')}>
        {dashboardTabs.map(([id, labelKey]) => (
          <button
            key={id}
            type="button"
            className={activeTab === id ? 'dash-tab active' : 'dash-tab'}
            aria-pressed={activeTab === id}
            onClick={() => selectTab(id)}
          >
            {t(labelKey)}
          </button>
        ))}
      </nav>
      <section className="hero-row" id="dashboard-overview">
        <div>
          <p className="eyebrow">{t('dashboard.eyebrow')}</p>
          <h1>{t('dashboard.greeting', { name: profile.employerName })}</h1>
          <p>{t('dashboard.summary')}</p>
        </div>
        <span
          className={`status-chip ${status === 'ok' ? 'ok' : status === 'missing' ? 'missing' : 'attention'}`}
        >
          {t(statusChipKey)}
        </span>
      </section>
      <div className="stat-grid">
        <article className="stat-tile">
          <span className="stat-chip teal-blue" aria-hidden="true">
            {chipIcons.score}
          </span>
          <span className="stat-tile-label">{t('dashboard.scoreTileLabel')}</span>
          <strong className="stat-tile-value">{health ? health.score : '—'}</strong>
        </article>
        <article className="stat-tile">
          <span className="stat-chip violet-pink" aria-hidden="true">
            {chipIcons.attention}
          </span>
          <span className="stat-tile-label">{t('dashboard.attentionTileLabel')}</span>
          <strong className="stat-tile-value">{health ? attentionCount : '—'}</strong>
        </article>
        <article className="stat-tile">
          <span className="stat-chip blue-violet" aria-hidden="true">
            {chipIcons.salary}
          </span>
          <span className="stat-tile-label">{t('dashboard.salaryTileLabel')}</span>
          <strong className="stat-tile-value">
            {nextSalary ? formatDisplayDate(nextSalary.dueDate) : '—'}
          </strong>
        </article>
        <article className="stat-tile">
          <span className="stat-chip pink-amber" aria-hidden="true">
            {chipIcons.insurance}
          </span>
          <span className="stat-tile-label">{t('dashboard.insuranceTileLabel')}</span>
          <strong className="stat-tile-value">
            {nextInsurance ? formatDisplayDate(nextInsurance.dueDate) : '—'}
          </strong>
        </article>
      </div>
      <section className="card intelligence-attention" aria-labelledby="attention-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{t('intelligence.now')}</p>
            <h2 id="attention-title">{t('intelligence.attention')}</h2>
          </div>
        </div>
        {health?.factors.some((factor) => factor.status === 'attention') ? (
          <div className="attention-list">
            {health.factors
              .filter((factor) => factor.status === 'attention')
              .slice(0, 3)
              .map((item) => (
                <article className="attention-item high" key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.explanation}</p>
                    <small>
                      {item.provenance.sourceType}: {item.provenance.sourceIds.join(', ')}
                    </small>
                  </div>
                  {item.actionTarget && item.recommendedAction ? (
                    <Link className="primary-button" to={path(item.actionTarget)}>
                      {item.recommendedAction}
                    </Link>
                  ) : null}
                </article>
              ))}
          </div>
        ) : (
          <p className="success-box">{t('intelligence.empty')}</p>
        )}
      </section>
      <section className="card health-card" aria-labelledby="health-title">
        {health ? (
          <div className="score-ring" aria-label={`${health.score} מתוך 100`}>
            <strong>{health.score}</strong>
            <span>/100</span>
          </div>
        ) : null}
        <div>
          <h2 id="health-title">{t('intelligence.health')}</h2>
          <p>{health ? t('intelligence.healthDisclaimer') : t('dashboard.scoreUnavailable')}</p>
          <ul>
            {(health?.factors ?? []).map((factor) => (
              <li key={factor.id}>
                <span aria-hidden="true">{factor.status === 'good' ? '✓' : '!'}</span>{' '}
                {factor.title}: {factor.explanation}
              </li>
            ))}
          </ul>
          {health?.actionsRemaining ? (
            <strong>
              {t('intelligence.actionsToPerfect', { count: health.actionsRemaining })}
            </strong>
          ) : null}
        </div>
      </section>
      <section
        className={`status-card ${status === 'missing' ? 'warning' : status === 'ok' ? 'ok' : 'attention'}`}
      >
        <div className="status-icon" aria-hidden="true">
          {status === 'missing' ? '!' : status === 'ok' ? '✓' : 'i'}
        </div>
        <div>
          <span>{t('dashboard.overallStatus')}</span>
          <h2>
            {status === 'missing'
              ? t('dashboard.missingTitle', { count: missingCount })
              : status === 'ok'
                ? t('dashboard.okTitle')
                : t('dashboard.attentionTitle')}
          </h2>
          <p>
            {status === 'missing'
              ? t('dashboard.missingBody')
              : status === 'ok'
                ? t('dashboard.okBody')
                : t('dashboard.attentionBody')}
          </p>
        </div>
        <Link className="text-link" to={path('/settings')}>
          {t('dashboard.reviewDetails')}
        </Link>
      </section>
      <div id="dashboard-payments">
        <UpcomingPaymentsCard />
      </div>
      <div className="dashboard-grid" id="dashboard-case">
        <section className="card">
          <div className="section-heading">
            <h2>{t('dashboard.employment')}</h2>
          </div>
          <div className="detail-list">
            <div>
              <span>{t('profile.recipientName')}</span>
              <strong>{profile.recipientName}</strong>
            </div>
            <div>
              <span>{t('profile.caregiverName')}</span>
              <strong>{profile.caregiverName}</strong>
            </div>
            <div>
              <span>{t('profile.startDate')}</span>
              <strong>{profile.employmentStartDate}</strong>
            </div>
          </div>
        </section>
        <section className="card next-action">
          <div className="section-heading">
            <h2>{t('dashboard.nextAction')}</h2>
          </div>
          <p>{t('dashboard.nextActionBody')}</p>
          <Link className="primary-button" to={path('/documents')}>
            {t('dashboard.openDocuments')}
          </Link>
        </section>
      </div>
      <section className="card">
        <div className="section-heading">
          <h2>{t('dashboard.savedContact')}</h2>
        </div>
        <p>{t('dashboard.contactDisclaimer')}</p>
        <div className="contact-summary">
          <strong>{profile.representativeName}</strong>
          <span dir="ltr">{profile.representativePhone}</span>
        </div>
      </section>
      <section className="card">
        <div className="section-heading">
          <h2>{t('settings.licensedBureau')}</h2>
        </div>
        <div className="detail-list">
          <div>
            <span>{t('profile.licensedBureauName')}</span>
            <strong>{profile.licensedBureauName || t('common.notProvided')}</strong>
          </div>
          <div>
            <span>{t('profile.licensedBureauContactName')}</span>
            <strong>{profile.licensedBureauContactName || t('common.notProvided')}</strong>
          </div>
          <div>
            <span>{t('profile.licensedBureauContactPhone')}</span>
            <strong dir="ltr">{profile.licensedBureauContactPhone || '—'}</strong>
          </div>
        </div>
      </section>
    </div>
  );
}
