import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ContactOptions } from '../components/ContactOptions.js';
import { ContactPage } from './ContactPage.js';

const DEFAULT_SITE_URL = 'https://care-platform-web.vercel.app';

function publicSiteUrl() {
  return import.meta.env.VITE_PUBLIC_SITE_URL?.trim() || DEFAULT_SITE_URL;
}

function upsertMeta(selector: string, attributes: Record<string, string>) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement('meta');
    document.head.append(element);
  }
  Object.entries(attributes).forEach(([name, value]) => element?.setAttribute(name, value));
}

function usePublicMetadata({
  title,
  description,
  path,
  structuredData,
}: {
  title: string;
  description: string;
  path: string;
  structuredData: Record<string, unknown>;
}) {
  useEffect(() => {
    const canonicalUrl = new URL(path, `${publicSiteUrl().replace(/\/$/, '')}/`).toString();
    const previousTitle = document.title;
    document.title = title;
    upsertMeta('meta[name="description"]', { name: 'description', content: description });
    upsertMeta('meta[name="robots"]', {
      name: 'robots',
      content: 'index, follow, max-image-preview:large',
    });
    upsertMeta('meta[property="og:title"]', { property: 'og:title', content: title });
    upsertMeta('meta[property="og:description"]', {
      property: 'og:description',
      content: description,
    });
    upsertMeta('meta[property="og:type"]', { property: 'og:type', content: 'website' });
    upsertMeta('meta[property="og:locale"]', { property: 'og:locale', content: 'he_IL' });
    upsertMeta('meta[property="og:url"]', { property: 'og:url', content: canonicalUrl });

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.append(canonical);
    }
    canonical.href = canonicalUrl;

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.dataset.caredeskStructuredData = 'true';
    script.text = JSON.stringify(structuredData);
    document.head.append(script);

    return () => {
      document.title = previousTitle;
      script.remove();
    };
  }, [description, path, structuredData, title]);
}

function PublicHeader() {
  const { t } = useTranslation();
  return (
    <header className="public-header">
      <Link className="public-brand" to="/" aria-label={t('public.common.brandAria')}>
        <span aria-hidden="true">C</span>
        <strong>CareDesk</strong>
      </Link>
      <nav aria-label={t('public.common.navAria')}>
        <a href="/#capabilities">{t('public.common.capabilities')}</a>
        <Link to="/guide/direct-caregiver-employment">{t('public.common.guide')}</Link>
        <a href="/#questions">{t('public.common.questions')}</a>
        <Link to="/contact-us">{t('public.common.contact')}</Link>
      </nav>
      <Link className="public-login-link" to="/app">
        {t('public.common.login')}
      </Link>
    </header>
  );
}

function PublicFooter() {
  const { t } = useTranslation();
  return (
    <footer className="public-footer">
      <div>
        <strong>CareDesk</strong>
        <span>{t('public.common.footerTagline')}</span>
      </div>
      <p>{t('public.common.footerDisclaimer')}</p>
      <div className="public-footer-links">
        <Link to="/terms/subscription">{t('public.common.subscriptionTerms')}</Link>
        <Link to="/contact-us">{t('public.common.contact')}</Link>
      </div>
    </footer>
  );
}

export function PublicLandingPage() {
  const { t } = useTranslation();
  const title = t('public.meta.homeTitle');
  const description = t('public.meta.homeDescription');
  const structuredData = useMemo(
    () => ({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'SoftwareApplication',
          name: 'CareDesk',
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'Web',
          inLanguage: 'he',
          description,
          url: publicSiteUrl(),
          offers: {
            '@type': 'Offer',
            price: '39.00',
            priceCurrency: 'ILS',
            description: t('public.pricing.offerDescription'),
          },
        },
        {
          '@type': 'FAQPage',
          mainEntity: [
            {
              '@type': 'Question',
              name: t('public.faq.audienceQuestion'),
              acceptedAnswer: { '@type': 'Answer', text: t('public.faq.audienceAnswer') },
            },
            {
              '@type': 'Question',
              name: t('public.faq.mobileQuestion'),
              acceptedAnswer: { '@type': 'Answer', text: t('public.faq.mobileAnswer') },
            },
            {
              '@type': 'Question',
              name: t('public.faq.adviceQuestion'),
              acceptedAnswer: { '@type': 'Answer', text: t('public.faq.adviceAnswer') },
            },
          ],
        },
      ],
    }),
    [description, t],
  );
  usePublicMetadata({ title, description, path: '/', structuredData });

  const signupUrl = import.meta.env.VITE_PUBLIC_SIGNUP_URL?.trim();

  return (
    <div className="public-site" dir="rtl">
      <a className="cd-skip-link" href="#public-main">
        {t('public.common.skip')}
      </a>
      <PublicHeader />
      <main id="public-main">
        <section className="public-hero" aria-labelledby="public-title">
          <div className="public-hero-copy">
            <span className="public-kicker">{t('public.hero.kicker')}</span>
            <h1 id="public-title">{t('public.hero.title')}</h1>
            <p>{t('public.hero.body')}</p>
            <div className="public-hero-actions">
              {signupUrl ? (
                <a className="public-primary-action" href={signupUrl}>
                  {t('public.hero.signup')}
                </a>
              ) : (
                <a className="public-primary-action" href="#pilot">
                  {t('public.hero.pilot')}
                </a>
              )}
              <Link className="public-secondary-action" to="/guide/direct-caregiver-employment">
                {t('public.hero.guide')}
              </Link>
            </div>
            <ul className="public-trust-points" aria-label={t('public.hero.trustLabel')}>
              <li>{t('public.hero.trust1')}</li>
              <li>{t('public.hero.trust2')}</li>
              <li>{t('public.hero.trust3')}</li>
            </ul>
          </div>
          <div className="public-hero-visual" aria-label={t('public.visual.aria')}>
            <div className="public-visual-window">
              <div className="public-visual-heading">
                <span className="public-visual-logo">C</span>
                <div>
                  <strong>{t('public.visual.title')}</strong>
                  <small>{t('public.visual.subtitle')}</small>
                </div>
              </div>
              <div className="public-visual-status">
                <span aria-hidden="true">✓</span>
                <div>
                  <strong>{t('public.visual.status')}</strong>
                  <small>{t('public.visual.statusDetail')}</small>
                </div>
              </div>
              <div className="public-visual-grid">
                <span>{t('public.visual.documents')}</span>
                <span>{t('public.visual.tasks')}</span>
                <span>{t('public.visual.payroll')}</span>
                <span>{t('public.visual.timeline')}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="public-section" id="capabilities" aria-labelledby="capabilities-title">
          <div className="public-section-heading">
            <span>{t('public.capabilities.eyebrow')}</span>
            <h2 id="capabilities-title">{t('public.capabilities.title')}</h2>
            <p>{t('public.capabilities.body')}</p>
          </div>
          <div className="public-feature-grid">
            <article>
              <span aria-hidden="true">▣</span>
              <h3>{t('public.capabilities.documentsTitle')}</h3>
              <p>{t('public.capabilities.documentsBody')}</p>
            </article>
            <article>
              <span aria-hidden="true">✚</span>
              <h3>{t('public.capabilities.insuranceTitle')}</h3>
              <p>{t('public.capabilities.insuranceBody')}</p>
            </article>
            <article>
              <span aria-hidden="true">₪</span>
              <h3>{t('public.capabilities.payrollTitle')}</h3>
              <p>{t('public.capabilities.payrollBody')}</p>
            </article>
            <article>
              <span aria-hidden="true">◷</span>
              <h3>{t('public.capabilities.periodicTitle')}</h3>
              <p>{t('public.capabilities.periodicBody')}</p>
            </article>
          </div>
        </section>

        <section className="public-process-section" aria-labelledby="process-title">
          <div className="public-section-heading">
            <span>{t('public.process.eyebrow')}</span>
            <h2 id="process-title">{t('public.process.title')}</h2>
          </div>
          <ol className="public-process">
            {[1, 2, 3].map((step) => (
              <li key={step}>
                <strong>{t(`public.process.step${step}Title`)}</strong>
                <span>{t(`public.process.step${step}Body`)}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="public-section public-faq" id="questions" aria-labelledby="faq-title">
          <div className="public-section-heading">
            <span>{t('public.faq.eyebrow')}</span>
            <h2 id="faq-title">{t('public.faq.title')}</h2>
          </div>
          <div className="public-faq-list">
            {(['audience', 'mobile', 'advice'] as const).map((item) => (
              <details key={item}>
                <summary>{t(`public.faq.${item}Question`)}</summary>
                <p>{t(`public.faq.${item}Answer`)}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="public-pricing" id="pricing" aria-labelledby="pricing-title">
          <div>
            <span>{t('public.pricing.eyebrow')}</span>
            <h2 id="pricing-title">{t('public.pricing.title')}</h2>
            <p>{t('public.pricing.body')}</p>
            <ul>
              <li>{t('public.pricing.item1')}</li>
              <li>{t('public.pricing.item2')}</li>
              <li>{t('public.pricing.item3')}</li>
            </ul>
          </div>
          <div className="public-price-card">
            <span>{t('public.pricing.plan')}</span>
            <strong>39 ₪</strong>
            <small>{t('public.pricing.perMonth')}</small>
            <b>{t('public.pricing.discount')}</b>
            <p>{t('public.pricing.noCharge')}</p>
            <Link to="/terms/subscription">{t('public.pricing.terms')}</Link>
          </div>
        </section>

        <section className="public-pilot" id="pilot" aria-labelledby="pilot-title">
          <div>
            <span>{t('public.pilot.eyebrow')}</span>
            <h2 id="pilot-title">{t('public.pilot.title')}</h2>
            <p>{t('public.pilot.body')}</p>
          </div>
          {signupUrl ? (
            <a className="public-primary-action" href={signupUrl}>
              {t('public.pilot.signup')}
            </a>
          ) : (
            <Link className="public-primary-action" to="/app">
              {t('public.pilot.existing')}
            </Link>
          )}
        </section>

        <section className="public-contact" id="contact" aria-labelledby="public-contact-title">
          <div className="public-section-heading">
            <span>{t('contact.eyebrow')}</span>
            <h2 id="public-contact-title">{t('contact.title')}</h2>
            <p>{t('contact.intro')}</p>
          </div>
          <ContactOptions />
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}

export function PublicSubscriptionTermsPage() {
  const { t } = useTranslation();
  const title = t('public.subscriptionTerms.metaTitle');
  const description = t('public.subscriptionTerms.metaDescription');
  const structuredData = useMemo(
    () => ({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: title,
      description,
      inLanguage: 'he',
      url: `${publicSiteUrl().replace(/\/$/, '')}/terms/subscription`,
    }),
    [description, title],
  );
  usePublicMetadata({
    title,
    description,
    path: '/terms/subscription',
    structuredData,
  });

  return (
    <div className="public-site" dir="rtl">
      <PublicHeader />
      <main className="public-legal-page" id="public-main">
        <header>
          <span className="public-kicker">{t('public.subscriptionTerms.eyebrow')}</span>
          <h1>{t('public.subscriptionTerms.title')}</h1>
          <p>{t('public.subscriptionTerms.updated')}</p>
        </header>
        <article>
          {[1, 2, 3, 4, 5, 6].map((section) => (
            <section key={section}>
              <h2>{t(`public.subscriptionTerms.section${section}Title`)}</h2>
              <p>{t(`public.subscriptionTerms.section${section}Body`)}</p>
            </section>
          ))}
          <aside>{t('public.subscriptionTerms.legalNotice')}</aside>
        </article>
      </main>
      <PublicFooter />
    </div>
  );
}

export function PublicContactPage() {
  const { t } = useTranslation();
  const title = `${t('contact.title')} | CareDesk`;
  const description = t('contact.intro');
  const structuredData = useMemo(
    () => ({
      '@context': 'https://schema.org',
      '@type': 'ContactPage',
      name: title,
      description,
      inLanguage: 'he',
      url: `${publicSiteUrl().replace(/\/$/, '')}/contact-us`,
    }),
    [description, title],
  );
  usePublicMetadata({ title, description, path: '/contact-us', structuredData });

  return (
    <div className="public-site" dir="rtl">
      <a className="cd-skip-link" href="#public-main">
        {t('public.common.skip')}
      </a>
      <PublicHeader />
      <main className="public-contact-page" id="public-main">
        <ContactPage />
      </main>
      <PublicFooter />
    </div>
  );
}

export function DirectEmploymentGuidePage() {
  const { t } = useTranslation();
  const title = t('public.meta.guideTitle');
  const description = t('public.meta.guideDescription');
  const structuredData = useMemo(
    () => ({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: t('public.guidePage.title'),
      inLanguage: 'he',
      description,
      publisher: { '@type': 'Organization', name: 'CareDesk' },
      mainEntityOfPage: `${publicSiteUrl().replace(/\/$/, '')}/guide/direct-caregiver-employment`,
    }),
    [description, t],
  );
  usePublicMetadata({
    title,
    description,
    path: '/guide/direct-caregiver-employment',
    structuredData,
  });

  return (
    <div className="public-site" dir="rtl">
      <a className="cd-skip-link" href="#guide-main">
        {t('public.common.skip')}
      </a>
      <PublicHeader />
      <main id="guide-main" className="public-guide">
        <header>
          <span className="public-kicker">{t('public.guidePage.kicker')}</span>
          <h1>{t('public.guidePage.title')}</h1>
          <p>{t('public.guidePage.intro')}</p>
        </header>
        <article>
          {[1, 2, 3, 4, 5].map((section) => (
            <section key={section}>
              <h2>{t(`public.guidePage.section${section}Title`)}</h2>
              <p>{t(`public.guidePage.section${section}Body`)}</p>
            </section>
          ))}
          <aside>
            <strong>{t('public.guidePage.noticeTitle')}</strong>
            <p>{t('public.guidePage.noticeBody')}</p>
          </aside>
        </article>
        <section className="public-guide-cta">
          <div>
            <h2>{t('public.guidePage.ctaTitle')}</h2>
            <p>{t('public.guidePage.ctaBody')}</p>
          </div>
          <Link className="public-primary-action" to="/app">
            {t('public.guidePage.cta')}
          </Link>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
