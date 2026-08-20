import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export type OpenIssueSeverity = 'urgent' | 'soon' | 'ok';

export interface OpenIssue {
  id: string;
  severity: OpenIssueSeverity;
  title: string;
  explanation: string;
  actionLabel?: string;
  /** Already-resolved router destination; never an arbitrary browser URL. */
  actionTo?: string;
}

const SEVERITY_ORDER: readonly OpenIssueSeverity[] = ['urgent', 'soon', 'ok'];

/**
 * Shared presentation for "open issues at a glance". Pure view: receives
 * pre-aggregated issues so the authenticated page (profile + case health) and
 * the public demo page (hardcoded fictional data) render the exact same layout.
 */
export function OpenIssuesGlance({ issues, score }: { issues: OpenIssue[]; score?: number }) {
  const { t } = useTranslation();
  const counts: Record<OpenIssueSeverity, number> = { urgent: 0, soon: 0, ok: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  const overall: OpenIssueSeverity = counts.urgent > 0 ? 'urgent' : counts.soon > 0 ? 'soon' : 'ok';

  return (
    <>
      <section className="hero-row">
        <div>
          <p className="eyebrow">{t('openIssues.eyebrow')}</p>
          <h1>{t('openIssues.title')}</h1>
          <p>{t('openIssues.summary')}</p>
        </div>
        <span className={`status-chip ${overall}`}>{t(`openIssues.status.${overall}`)}</span>
      </section>
      <section className="card" aria-labelledby="open-issues-counts-title">
        <div className="section-heading">
          <h2 id="open-issues-counts-title">{t('openIssues.countsTitle')}</h2>
        </div>
        <div className="metric-grid">
          {SEVERITY_ORDER.map((severity) => (
            <div className={`issues-count-${severity}`} key={severity}>
              <span>{t(`openIssues.buckets.${severity}`)}</span>
              <strong>{counts[severity]}</strong>
            </div>
          ))}
        </div>
      </section>
      <section className="card health-card" aria-labelledby="open-issues-health-title">
        <div className="score-ring" aria-label={t('openIssues.scoreLabel', { score: score ?? 0 })}>
          <strong>{score ?? '…'}</strong>
          <span>/100</span>
        </div>
        <div>
          <h2 id="open-issues-health-title">{t('openIssues.healthTitle')}</h2>
          <p>{t('openIssues.healthDisclaimer')}</p>
        </div>
      </section>
      {SEVERITY_ORDER.map((severity) => {
        const bucket = issues.filter((issue) => issue.severity === severity);
        return (
          <section
            className="card"
            key={severity}
            aria-labelledby={`open-issues-${severity}-title`}
          >
            <div className="section-heading">
              <h2 id={`open-issues-${severity}-title`}>{t(`openIssues.buckets.${severity}`)}</h2>
            </div>
            {bucket.length > 0 ? (
              <div className="attention-list">
                {bucket.map((issue) => (
                  <article
                    className={`attention-item ${severity === 'urgent' ? 'high' : severity}`}
                    key={issue.id}
                  >
                    <div>
                      <strong>{issue.title}</strong>
                      <p>{issue.explanation}</p>
                    </div>
                    {issue.actionTo && issue.actionLabel ? (
                      <Link className="primary-button" to={issue.actionTo}>
                        {issue.actionLabel}
                      </Link>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <p className="success-box">{t(`openIssues.empty.${severity}`)}</p>
            )}
          </section>
        );
      })}
    </>
  );
}
