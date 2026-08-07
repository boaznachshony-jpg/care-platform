import { useTranslation } from 'react-i18next';
import { createSupportMailto, SUPPORT_EMAIL } from '../contact.js';

export function ContactOptions() {
  const { t } = useTranslation();
  const helpHref = createSupportMailto(t('contact.helpSubject'), t('contact.helpTemplate'));
  const feedbackHref = createSupportMailto(
    t('contact.feedbackSubject'),
    t('contact.feedbackTemplate'),
  );

  return (
    <div className="contact-options">
      <article className="contact-option-card">
        <span className="contact-option-icon" aria-hidden="true">
          ?
        </span>
        <div>
          <h2>{t('contact.helpTitle')}</h2>
          <p>{t('contact.helpBody')}</p>
        </div>
        <a className="contact-option-action contact-option-action-primary" href={helpHref}>
          {t('contact.helpAction')}
        </a>
      </article>

      <article className="contact-option-card">
        <span className="contact-option-icon contact-option-icon-feedback" aria-hidden="true">
          +
        </span>
        <div>
          <h2>{t('contact.feedbackTitle')}</h2>
          <p>{t('contact.feedbackBody')}</p>
        </div>
        <a className="contact-option-action contact-option-action-secondary" href={feedbackHref}>
          {t('contact.feedbackAction')}
        </a>
      </article>

      <div className="contact-direct-card">
        <div>
          <strong>{t('contact.emailLabel')}</strong>
          <p>{t('contact.fallback')}</p>
        </div>
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </div>

      <p className="contact-privacy-note">{t('contact.privacy')}</p>
    </div>
  );
}
