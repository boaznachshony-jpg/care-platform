import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useClientPath } from '../hooks/use-client-path.js';

const terms = [
  { key: 'employer', icon: '⌂', hasNote: false },
  { key: 'caregiver', icon: '♙', hasNote: false },
  { key: 'representative', icon: '◎', hasNote: true },
  { key: 'additionalRepresentative', icon: '＋', hasNote: true },
] as const;

export function GlossaryPage() {
  const path = useClientPath();
  const { t } = useTranslation();

  return (
    <div className="page-stack glossary-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t('glossary.eyebrow')}</p>
          <h1>{t('glossary.title')}</h1>
          <p>{t('glossary.intro')}</p>
        </div>
        <Link className="secondary-button" to={path('/trust')}>
          {t('glossary.toTips')}
        </Link>
      </header>

      <section className="glossary-grid" aria-label={t('glossary.listLabel')}>
        {terms.map((term) => (
          <article className="card glossary-card" key={term.key}>
            <div className="glossary-card-heading">
              <span className="glossary-icon" aria-hidden="true">
                {term.icon}
              </span>
              <div>
                <h2>{t(`glossary.terms.${term.key}.title`)}</h2>
                <p className="glossary-summary">{t(`glossary.terms.${term.key}.summary`)}</p>
              </div>
            </div>
            <p>{t(`glossary.terms.${term.key}.details`)}</p>
            {term.hasNote ? (
              <p className="glossary-note">
                {t('glossary.important')}: {t(`glossary.terms.${term.key}.note`)}
              </p>
            ) : null}
          </article>
        ))}
      </section>

      <p className="form-note">{t('glossary.disclaimer')}</p>
    </div>
  );
}
