import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { BILLING_TERMS_VERSION, type BillingPlanResponse } from '@caredesk/schemas';
import {
  cancelBillingSubscription,
  getBillingSubscription,
  startBillingPaymentMethodSetup,
} from '../api/client.js';
import { useAuth } from '../auth/auth-context.js';

const money = (agorot: number, language: string) =>
  new Intl.NumberFormat(language, { style: 'currency', currency: 'ILS' }).format(agorot / 100);

const date = (value: string, language: string) =>
  new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00.000Z`));

export function BillingPage() {
  const { t, i18n } = useTranslation();
  const auth = useAuth();
  const authEmail = auth.user?.email ?? '';
  const [searchParams] = useSearchParams();
  const [plan, setPlan] = useState<BillingPlanResponse | null>(null);
  const [billingName, setBillingName] = useState('');
  const [billingEmail, setBillingEmail] = useState(authEmail);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [onboardingFlow] = useState(
    () =>
      searchParams.get('from') === 'onboarding' ||
      window.sessionStorage.getItem('caredesk.billing-onboarding') === '1',
  );

  const isSponsored = Boolean(plan && plan.effectivePriceAgorot === 0);
  const chargeDate = plan?.nextChargeOn ?? plan?.chargingStartsAt ?? null;

  const load = useCallback(async () => {
    try {
      const result = await getBillingSubscription();
      setPlan(result);
      setBillingName((current) => current || result.billingName || '');
      setBillingEmail((current) => current || result.billingEmail || authEmail);
      setError(false);
    } catch {
      setError(true);
    }
  }, [authEmail]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (searchParams.get('from') === 'onboarding') {
      window.sessionStorage.setItem('caredesk.billing-onboarding', '1');
    }
  }, [searchParams]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!accepted || !plan?.canManage || !plan.providerConfigured) return;
    setBusy(true);
    setError(false);
    try {
      const result = await startBillingPaymentMethodSetup({
        billingName: billingName.trim(),
        billingEmail: billingEmail.trim(),
        acceptsRecurringCharge: true,
        termsVersion: BILLING_TERMS_VERSION,
      });
      window.location.assign(result.checkoutUrl);
    } catch {
      setBusy(false);
      setError(true);
    }
  }

  async function cancelSubscription() {
    if (!window.confirm(t('billing.cancelConfirm'))) return;
    setBusy(true);
    setError(false);
    try {
      await cancelBillingSubscription();
      await load();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="billing-page" id="main-content">
      <header className="family-access-header">
        <div>
          <p className="eyebrow">{t('billing.eyebrow')}</p>
          <h1>{t('billing.title')}</h1>
          <p>{t('billing.intro')}</p>
        </div>
        <Link className="secondary-button" to="/app">
          {t('billing.back')}
        </Link>
      </header>

      {onboardingFlow ? (
        <p className="billing-onboarding-step" role="status">
          <strong>{t('billing.onboardingStep')}</strong>
          <span>{t('billing.paymentMethodBody')}</span>
        </p>
      ) : null}

      {searchParams.get('setup') === 'success' ? (
        <p className="action-notice success" role="status">
          {t('billing.setupReturned')}
        </p>
      ) : null}
      {searchParams.get('setup') === 'failed' ? (
        <p className="action-notice error" role="alert">
          {t('billing.setupCancelled')}
        </p>
      ) : null}

      {error ? (
        <section className="card" role="alert">
          <p>{t('billing.loadError')}</p>
          <button className="secondary-button" type="button" onClick={() => void load()}>
            {t('auth.retry')}
          </button>
        </section>
      ) : !plan ? (
        <p role="status">{t('billing.loading')}</p>
      ) : (
        <div className="billing-layout">
          <section className="card billing-plan-card">
            <span className="billing-plan-label">{t('billing.launchPlan')}</span>
            <div className="billing-price">
              <strong>{money(plan.priceAgorot, i18n.language)}</strong>
              <span>{t('billing.perMonth')}</span>
            </div>
            <p>{t('billing.includesVat', { rate: plan.vatRatePercent })}</p>
            <dl className="billing-breakdown">
              <div>
                <dt>{t('billing.beforeVat')}</dt>
                <dd>{money(plan.netAgorot, i18n.language)}</dd>
              </div>
              <div>
                <dt>{t('billing.vat')}</dt>
                <dd>{money(plan.vatAgorot, i18n.language)}</dd>
              </div>
              <div className="billing-discount-row">
                <dt>{t('billing.launchDiscount')}</dt>
                <dd>{plan.launchDiscountPercent}%</dd>
              </div>
              <div className="billing-effective-row">
                <dt>{t('billing.currentCharge')}</dt>
                <dd>{money(plan.effectivePriceAgorot, i18n.language)}</dd>
              </div>
            </dl>
            <div className={`billing-safety-note ${isSponsored ? '' : 'paid'}`}>
              <strong>
                {isSponsored ? t('billing.noChargeTitle') : t('billing.paidChargeTitle')}
              </strong>
              <p>
                {isSponsored
                  ? t('billing.noChargeBody')
                  : chargeDate
                    ? t('billing.paidChargeBody', {
                        amount: money(plan.effectivePriceAgorot, i18n.language),
                        date: date(chargeDate, i18n.language),
                      })
                    : t('billing.paidChargeDatePending', {
                        amount: money(plan.effectivePriceAgorot, i18n.language),
                      })}
              </p>
            </div>
          </section>

          <section className="card billing-method-card">
            <h2>{t('billing.paymentMethodTitle')}</h2>
            {plan.paymentMethod ? (
              <>
                <div className="saved-payment-method">
                  <span aria-hidden="true">💳</span>
                  <div>
                    <strong>{t('billing.cardEnding', { last4: plan.paymentMethod.last4 })}</strong>
                    <small>
                      {t('billing.cardExpiry', {
                        month: String(plan.paymentMethod.expiryMonth).padStart(2, '0'),
                        year: plan.paymentMethod.expiryYear,
                      })}
                    </small>
                  </div>
                </div>
                {plan.canManage ? (
                  <button
                    className="danger-text-button"
                    type="button"
                    disabled={busy}
                    onClick={() => void cancelSubscription()}
                  >
                    {t('billing.cancel')}
                  </button>
                ) : null}
                {onboardingFlow ? (
                  <Link
                    className="primary-button"
                    to="/app"
                    onClick={() => window.sessionStorage.removeItem('caredesk.billing-onboarding')}
                  >
                    {t('billing.completeSetup')}
                  </Link>
                ) : null}
              </>
            ) : plan.canManage ? (
              <form className="billing-setup-form" onSubmit={(event) => void submit(event)}>
                <p>{t('billing.paymentMethodBody')}</p>
                <label>
                  {t('billing.billingName')}
                  <input
                    value={billingName}
                    required
                    minLength={2}
                    maxLength={120}
                    autoComplete="name"
                    onChange={(event) => setBillingName(event.target.value)}
                  />
                </label>
                <label>
                  {t('billing.billingEmail')}
                  <input
                    dir="ltr"
                    type="email"
                    value={billingEmail}
                    required
                    maxLength={254}
                    autoComplete="email"
                    onChange={(event) => setBillingEmail(event.target.value)}
                  />
                </label>
                <label className="billing-consent">
                  <input
                    type="checkbox"
                    checked={accepted}
                    onChange={(event) => setAccepted(event.target.checked)}
                  />
                  <span>
                    {t('billing.consentPrefix')}{' '}
                    <Link to="/terms/subscription" target="_blank">
                      {t('billing.consentLink')}
                    </Link>
                  </span>
                </label>
                {!plan.providerConfigured ? (
                  <p className="billing-provider-notice" role="status">
                    {t('billing.providerPending')}
                  </p>
                ) : null}
                <button
                  className="primary-button"
                  type="submit"
                  disabled={!accepted || busy || !plan.providerConfigured}
                >
                  {busy ? t('billing.redirecting') : t('billing.connectCard')}
                </button>
              </form>
            ) : (
              <p>{t('billing.ownerOnly')}</p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
