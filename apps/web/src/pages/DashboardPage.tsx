import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useClientPath } from '../hooks/use-client-path.js';
import { useMvpProfile } from '../hooks/use-mvp-profile.js';

export function DashboardPage() {
  const path = useClientPath();
  const { t } = useTranslation();
  const [profile] = useMvpProfile();
  const required = [
    profile.employerName,
    profile.recipientName,
    profile.caregiverName,
    profile.employmentStartDate,
    profile.representativeName,
  ];
  const missingCount = required.filter((value) => !value.trim()).length;
  const status = missingCount > 0 ? 'missing' : 'attention';

  return (
    <div className="page-stack">
      <section className="hero-row">
        <div>
          <p className="eyebrow">{t('dashboard.eyebrow')}</p>
          <h1>{t('dashboard.greeting', { name: profile.employerName })}</h1>
          <p>{t('dashboard.summary')}</p>
        </div>
        <span className={`status-chip ${status}`}>
          {t(status === 'missing' ? 'dashboard.statusMissing' : 'dashboard.statusAttention')}
        </span>
      </section>
      <section className={`status-card ${status === 'missing' ? 'warning' : 'attention'}`}>
        <div className="status-icon" aria-hidden="true">
          {status === 'missing' ? '!' : 'i'}
        </div>
        <div>
          <span>{t('dashboard.overallStatus')}</span>
          <h2>
            {status === 'missing'
              ? t('dashboard.missingTitle', { count: missingCount })
              : t('dashboard.attentionTitle')}
          </h2>
          <p>{status === 'missing' ? t('dashboard.missingBody') : t('dashboard.attentionBody')}</p>
        </div>
        <Link className="text-link" to={path('/settings')}>
          {t('dashboard.reviewDetails')}
        </Link>
      </section>
      <div className="dashboard-grid">
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
    </div>
  );
}
