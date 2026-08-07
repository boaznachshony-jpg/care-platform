import { useTranslation } from 'react-i18next';
import { ContactOptions } from '../components/ContactOptions.js';

export function ContactPage() {
  const { t } = useTranslation();

  return (
    <div className="page-stack contact-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t('contact.eyebrow')}</p>
          <h1>{t('contact.title')}</h1>
          <p>{t('contact.intro')}</p>
        </div>
      </header>

      <ContactOptions />
      <section className="contact-about" aria-labelledby="contact-about-title">
        <div>
          <p className="eyebrow">{t('contact.aboutEyebrow')}</p>
          <h2 id="contact-about-title">{t('contact.aboutTitle')}</h2>
          <p>{t('contact.aboutBody')}</p>
        </div>
        <dl>
          <div>
            <dt>{t('contact.initiativeLabel')}</dt>
            <dd>{t('contact.initiativeName')}</dd>
          </div>
          <div>
            <dt>{t('contact.entrepreneurLabel')}</dt>
            <dd>{t('contact.entrepreneurName')}</dd>
          </div>
          <div>
            <dt>{t('contact.copyrightLabel')}</dt>
            <dd>{t('contact.copyright')}</dd>
          </div>
        </dl>
      </section>
      <p className="form-note">{t('contact.response')}</p>
    </div>
  );
}
