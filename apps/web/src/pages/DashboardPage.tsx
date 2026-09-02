import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useClientPath } from '../hooks/use-client-path.js';
import { useMvpProfile } from '../hooks/use-mvp-profile.js';
import { getCaseHealth, type CaseHealthResponse } from '../api/client.js';
import { UpcomingPaymentsCard } from '../components/UpcomingPaymentsCard.js';
import { createUpcomingPayments, formatDisplayDate } from '../upcoming-payments.js';
import { readMvpDocuments, readMvpTasks } from '../storage/mvp-storage.js';
import { missingProfileFieldCount } from '../profile-completeness.js';
import {
  healthFactorAction,
  healthFactorExplanation,
  healthFactorTitle,
} from '../health-factors.js';

type DashboardTabId = 'overview' | 'payments' | 'case';

const dashboardTabs = [
  ['overview', 'dashboard.tabOverview'],
  ['payments', 'dashboard.tabPayments'],
  ['case', 'dashboard.tabCase'],
] as const;

/* Shared gold→royal-blue gradient for the launcher tile icons ("Gold on Night" brand).
   userSpaceOnUse keeps the gradient visible on straight strokes (zero-area bbox).
   Default stops are the deeper light-theme pair (legible on white tiles); the dark theme
   swaps them to the brighter approved stops via `stop-color` CSS on the stop classes
   (see the [data-theme='dark'] block in global.css). */
const TILE_GRADIENT_ID = 'cd-tile-grad';

function TileGradientDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient
          id={TILE_GRADIENT_ID}
          x1="0"
          y1="0"
          x2="24"
          y2="24"
          gradientUnits="userSpaceOnUse"
        >
          <stop className="cd-tile-grad-stop-a" offset="0" stopColor="#b98b2e" />
          <stop className="cd-tile-grad-stop-b" offset="1" stopColor="#4c6fd1" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function tileSvgProps() {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: `url(#${TILE_GRADIENT_ID})`,
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  } as const;
}

/* Hand-drawn outline glyphs (stroke only, 24 viewBox) — no icon library. */
const tileIcons = {
  shield: (
    <svg {...tileSvgProps()}>
      <path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
  alert: (
    <svg {...tileSvgProps()}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5" />
      <path d="M12 16.2v.1" />
    </svg>
  ),
  idCard: (
    <svg {...tileSvgProps()}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <circle cx="8.3" cy="11" r="2" />
      <path d="M5.4 16.4c.7-1.6 1.8-2.4 2.9-2.4s2.2.8 2.9 2.4" />
      <path d="M14 9.5h4.5M14 13h4.5" />
    </svg>
  ),
  heartPulse: (
    <svg {...tileSvgProps()}>
      <path d="M19.6 12.4L12 20l-7.6-7.6a4.9 4.9 0 1 1 7.6-6.1 4.9 4.9 0 1 1 7.6 6.1z" />
      <path d="M7.5 12h2l1-2 2.5 4.5 1-2.5h2.5" />
    </svg>
  ),
  banknote: (
    <svg {...tileSvgProps()}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 11.5v1M18 11.5v1" />
    </svg>
  ),
  buildingColumns: (
    <svg {...tileSvgProps()}>
      <path d="M12 3.5L3.5 9h17L12 3.5z" />
      <path d="M5.5 9v8M10 9v8M14 9v8M18.5 9v8" />
      <path d="M3.5 17h17" />
      <path d="M2.5 20.5h19" />
    </svg>
  ),
  file: (
    <svg {...tileSvgProps()}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
      <path d="M14 3v5h5" />
    </svg>
  ),
  checkSquare: (
    <svg {...tileSvgProps()}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M9 12.5l2.2 2.2 4.3-4.7" />
    </svg>
  ),
  clock: (
    <svg {...tileSvgProps()}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  ),
  printer: (
    <svg {...tileSvgProps()}>
      <path d="M7 8V4h10v4" />
      <rect x="4" y="8" width="16" height="8" rx="2" />
      <path d="M7 13.5h10V20H7z" />
      <path d="M17 10.8h.1" />
    </svg>
  ),
} as const;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function displayDate(value: string): string {
  return ISO_DATE_PATTERN.test(value) ? formatDisplayDate(value) : value;
}

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
  // Cheap synchronous local-storage reads, sampled once per visit (Constitution: no extra API calls).
  const [documentCount] = useState(() => readMvpDocuments().length);
  const [openTaskCount] = useState(
    () => readMvpTasks().filter((task) => task.status === 'open').length,
  );
  /* One screen, every topic as a tappable tile (launcher layout). */
  const navTiles = [
    {
      id: 'score',
      icon: tileIcons.shield,
      label: t('dashboard.tiles.score'),
      value: health ? String(health.score) : '—',
      to: path('/overview'),
    },
    {
      id: 'attention',
      icon: tileIcons.alert,
      label: t('dashboard.tiles.attention'),
      value: health ? String(attentionCount) : '—',
      to: path('/overview'),
    },
    {
      id: 'visa',
      icon: tileIcons.idCard,
      label: t('dashboard.tiles.visa'),
      value: profile.visaRenewalDate
        ? t('dashboard.tiles.untilDate', { date: displayDate(profile.visaRenewalDate) })
        : t('dashboard.tiles.missingDate'),
      to: path('/settings'),
    },
    {
      id: 'medicalInsurance',
      icon: tileIcons.heartPulse,
      label: t('dashboard.tiles.medicalInsurance'),
      value:
        profile.medicalInsuranceConfirmed && profile.medicalInsuranceExpiryDate
          ? displayDate(profile.medicalInsuranceExpiryDate)
          : t('dashboard.tiles.notConfirmed'),
      to: path('/documents'),
    },
    {
      id: 'salary',
      icon: tileIcons.banknote,
      label: t('dashboard.tiles.salary'),
      value: nextSalary ? formatDisplayDate(nextSalary.dueDate) : '—',
      to: path('/payroll'),
    },
    {
      id: 'nationalInsurance',
      icon: tileIcons.buildingColumns,
      label: t('dashboard.tiles.nationalInsurance'),
      value: nextInsurance ? formatDisplayDate(nextInsurance.dueDate) : '—',
      to: path('/tasks'),
    },
    {
      id: 'documents',
      icon: tileIcons.file,
      label: t('dashboard.tiles.documents'),
      value: String(documentCount),
      to: path('/documents'),
    },
    {
      id: 'tasks',
      icon: tileIcons.checkSquare,
      label: t('dashboard.tiles.tasks'),
      value: String(openTaskCount),
      to: path('/tasks'),
    },
    {
      id: 'timeline',
      icon: tileIcons.clock,
      label: t('dashboard.tiles.timeline'),
      value: t('dashboard.tiles.view'),
      to: path('/timeline'),
    },
    {
      id: 'binder',
      icon: tileIcons.printer,
      label: t('dashboard.tiles.binder'),
      value: t('dashboard.tiles.securePrint'),
      to: path('/binder'),
    },
  ] as const;
  // Single source of truth for "is the profile complete" — see profile-completeness.ts.
  const missingCount = missingProfileFieldCount(profile);
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
      <TileGradientDefs />
      <nav className="tile-grid" aria-label={t('dashboard.tiles.gridLabel')}>
        {navTiles.map((tile) => (
          /* Explicit accessible name: the label and the value are separate inline elements, so the
             name computed from content would run them together ("מסמכים0"). Composed from the same
             translated strings, so it keeps matching the visible text (WCAG 2.5.3 Label in Name). */
          <Link
            key={tile.id}
            className="nav-tile"
            to={tile.to}
            aria-label={`${tile.label} ${tile.value}`}
          >
            <span className="nav-tile-icon" aria-hidden="true">
              {tile.icon}
            </span>
            <span className="nav-tile-label">{tile.label}</span>
            <strong className="nav-tile-value">{tile.value}</strong>
          </Link>
        ))}
      </nav>
      <section className="card intelligence-attention" aria-labelledby="attention-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{t('intelligence.now')}</p>
            <h2 id="attention-title">{t('intelligence.attention')}</h2>
          </div>
        </div>
        {/* The attention list is derived output, not user input: the caveat sits
            above the items so it is read together with them. */}
        <p className="legal-note">{t('liability.reminder')}</p>
        {health?.factors.some((factor) => factor.status === 'attention') ? (
          <div className="attention-list">
            {health.factors
              .filter((factor) => factor.status === 'attention')
              .slice(0, 3)
              .map((item) => (
                <article className="attention-item high" key={item.id}>
                  <div>
                    <strong>{healthFactorTitle(item, t)}</strong>
                    <p>{healthFactorExplanation(item, t)}</p>
                    {/* R5-05. This line used to read "documents: doc-1" — a
                        machine token and a row id, in a place a human is asked
                        to act on. The source is now named in the interface
                        language; the ids stay because they are the evidence a
                        support call needs. There is no "who" and no "when" to
                        show: `HealthFactor.provenance` carries neither, and
                        R5-05 is a display item, not a licence to add fields. */}
                    <small>
                      {t('valueOrigin.provenance.source', {
                        // The health payload comes from the server, so an
                        // unrecognised source type must degrade to today's
                        // behaviour — the raw token — and never to a leaked
                        // translation key on a screen the customer reads.
                        source: t(`valueOrigin.source.${item.provenance.sourceType}`, {
                          defaultValue: item.provenance.sourceType,
                        }),
                      })}
                      {' · '}
                      {item.provenance.sourceIds.join(', ')}
                    </small>
                  </div>
                  {item.actionTarget && healthFactorAction(item, t) ? (
                    // actionTarget is already an app-rooted path from the health
                    // API ("/cases/{id}#..."), not one relative to the current
                    // client workspace — wrapping it in `path()` (which prefixes
                    // /clients/:clientId) produced a URL matching no route, so
                    // the router's catch-all silently sent the user to /app.
                    <Link className="primary-button" to={item.actionTarget}>
                      {healthFactorAction(item, t)}
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
        {/* dir=ltr: a score reads "82 / 100" left to right even inside an RTL
            page, where the browser would otherwise place the slash before the
            number and render it as "100/". */}
        {health ? (
          <div className="score-ring" dir="ltr" aria-label={`${health.score} מתוך 100`}>
            <strong>{health.score}</strong>
            <span>/100</span>
          </div>
        ) : null}
        <div>
          <h2 id="health-title">{t('intelligence.health')}</h2>
          <p>{health ? t('intelligence.healthDisclaimer') : t('dashboard.scoreUnavailable')}</p>
          {/* healthDisclaimer covers what the score measures; this line adds the
              part it leaves out - the score does not replace an outside check. */}
          {health ? <p className="legal-note">{t('liability.score')}</p> : null}
          <ul>
            {(health?.factors ?? []).map((factor) => (
              <li key={factor.id}>
                <span aria-hidden="true">{factor.status === 'good' ? '✓' : '!'}</span>{' '}
                {healthFactorTitle(factor, t)}: {healthFactorExplanation(factor, t)}
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
