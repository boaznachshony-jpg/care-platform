import { useTranslation } from 'react-i18next';
import { OpenIssuesGlance, type OpenIssue } from '../components/OpenIssuesGlance.js';

/**
 * Public, no-auth demo of the "open issues at a glance" layout.
 * Constitution §16: fictional demo data only — no real PII, no storage reads,
 * no API calls. All action links stay inside the demo route.
 */
const DEMO_ROUTE = '/demo/overview';
const DEMO_SCORE = 72;

/* eslint-disable no-restricted-syntax -- Synthetic demo fixture data (fictional names and sample issue text) for the public demo route; this is data fed into the glance layout, not user-facing UI copy — all UI copy below comes from the i18n resources. */
const DEMO_RECIPIENT_NAME = 'רות כהן';
const DEMO_CAREGIVER_NAME = 'מריה סנטוס';
const DEMO_AGREEMENT_TITLE = `הסכם העסקה חתום עם ${DEMO_CAREGIVER_NAME}`;
const DEMO_AGREEMENT_EXPLANATION = 'טרם הועלה לתיק עותק חתום של הסכם ההעסקה.';
const DEMO_PAYROLL_TITLE = 'תשלומי שכר מתועדים';
const DEMO_PAYROLL_EXPLANATION = 'תלושי השכר של שלושת החודשים האחרונים שמורים בתיק.';
/* eslint-enable no-restricted-syntax */

export function DemoOverviewPage() {
  const { t } = useTranslation();

  const demoIssues: OpenIssue[] = [
    {
      id: 'demo-visa',
      severity: 'urgent',
      title: t('openIssues.dates.visa'),
      explanation: t('openIssues.expiresInDays', { count: 9 }),
      actionLabel: t('openIssues.reviewDates'),
      actionTo: DEMO_ROUTE,
    },
    {
      id: 'demo-agreement',
      severity: 'urgent',
      title: DEMO_AGREEMENT_TITLE,
      explanation: DEMO_AGREEMENT_EXPLANATION,
      actionLabel: t('openIssues.completeInSettings'),
      actionTo: DEMO_ROUTE,
    },
    {
      id: 'demo-insurance',
      severity: 'soon',
      title: t('openIssues.dates.insurance'),
      explanation: t('openIssues.expiresInDays', { count: 21 }),
      actionLabel: t('openIssues.reviewDates'),
      actionTo: DEMO_ROUTE,
    },
    {
      id: 'demo-missing-fields',
      severity: 'soon',
      title: t('openIssues.missingTitle', { count: 2 }),
      explanation: [t('openIssues.fields.saturdayRate'), t('openIssues.fields.baseSalary')].join(
        ', ',
      ),
      actionLabel: t('openIssues.completeInSettings'),
      actionTo: DEMO_ROUTE,
    },
    {
      id: 'demo-license',
      severity: 'ok',
      title: t('openIssues.dates.license'),
      explanation: t('openIssues.expiresInDays', { count: 238 }),
    },
    {
      id: 'demo-payroll',
      severity: 'ok',
      title: DEMO_PAYROLL_TITLE,
      explanation: DEMO_PAYROLL_EXPLANATION,
    },
  ];

  return (
    <div className="page-stack demo-overview">
      <div className="demo-banner" role="note">
        {t('openIssues.demoBanner')}
      </div>
      <section className="card" aria-labelledby="demo-details-title">
        <div className="section-heading">
          <h2 id="demo-details-title">{t('openIssues.demoDetailsTitle')}</h2>
        </div>
        <div className="detail-list">
          <div>
            <span>{t('openIssues.demoRecipient')}</span>
            <strong>{DEMO_RECIPIENT_NAME}</strong>
          </div>
          <div>
            <span>{t('openIssues.demoCaregiver')}</span>
            <strong>{DEMO_CAREGIVER_NAME}</strong>
          </div>
        </div>
      </section>
      <OpenIssuesGlance issues={demoIssues} score={DEMO_SCORE} />
    </div>
  );
}
