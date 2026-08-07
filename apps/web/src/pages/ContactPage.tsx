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
      <p className="form-note">{t('contact.response')}</p>
    </div>
  );
}
