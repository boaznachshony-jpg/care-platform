import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { BILLING_TERMS_VERSION, type BillingPlanResponse } from '@caredesk/schemas';
import { PRIVACY_DOCUMENT_VERSION, TERMS_DOCUMENT_VERSION } from '@caredesk/i18n';
import {
  cancelBillingSubscription,
  getBillingSubscription,
  recordLegalAcceptance,
  startBillingPaymentMethodSetup,
} from '../api/client.js';
import { useAuth } from '../auth/auth-context.js';
import { readMvpRecipientContact } from '../storage/mvp-storage.js';

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
  const [recipientContact] = useState(readMvpRecipientContact);
  // The invoice is almost always issued to the care recipient, and the name is
  // already on file from the case setup. Starting empty made the customer
  // retype something the system already knew; it stays fully editable for the
  // cases where the payer is someone else.
  const [billingName, setBillingName] = useState(recipientContact.name);
  const [billingEmail, setBillingEmail] = useState(authEmail);
  const [sameAsRecipient, setSameAsRecipient] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  /**
   * Distinct from `error`: this one means "your acceptance was not recorded, so
   * nothing was started", which is a different fact from "the payment provider
   * failed" and needs its own sentence.
   */
  const [consentError, setConsentError] = useState(false);
  const [onboardingFlow] = useState(
    () =>
      searchParams.get('from') === 'onboarding' ||
      window.sessionStorage.getItem('caredesk.billing-onboarding') === '1',
  );

  const isSponsored = Boolean(plan && plan.effectivePriceAgorot === 0);
  // A failed recurring charge must never present as an active subscription:
  // 'past_due' replaces the green "subscription active" note with a warning
  // and a direct path back into the hosted card-setup flow.
  const isPastDue = plan?.status === 'past_due';
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

  /**
   * The documents this screen's checkbox covers, each at the version the user
   * was shown. Both constants come from `@caredesk/i18n`, which is also what
   * renders the version line at the top of /terms and /privacy, so the version
   * recorded in `terms_acceptance` cannot be a version nobody displayed.
   *
   * The billing terms at /terms/subscription are linked from the same sentence
   * and are recorded separately, as `product_subscription.terms_version`, by
   * the setup call below. They keep their own version (2026-08-04) because
   * existing subscriptions already point at it.
   */
  const acceptedDocuments = [
    { document: 'terms', version: TERMS_DOCUMENT_VERSION },
    { document: 'privacy', version: PRIVACY_DOCUMENT_VERSION },
  ] as const;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!accepted || !plan?.canManage || !plan.providerConfigured) return;
    setBusy(true);
    setError(false);
    setConsentError(false);
    // The acceptance is recorded BEFORE the subscription is created, and the
    // failure path is a refusal rather than a warning.
    //
    // Recording it afterwards would be the easier change and it is the wrong
    // one: the user is redirected to Cardcom's hosted page on the next line and
    // does not come back to this component, so an "afterwards" that fails has
    // nowhere to run and nothing to retry. The result would be a live paid
    // subscription with no record that its terms were ever accepted - which is
    // exactly the state this whole change exists to make impossible. If the
    // acceptance cannot be stored, no subscription is started.
    try {
      await recordLegalAcceptance({ documents: [...acceptedDocuments], context: 'billing' });
    } catch {
      setBusy(false);
      setConsentError(true);
      return;
    }
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

  /**
   * One-time copy of the care recipient's details into the payer fields —
   * the fields stay fully editable afterwards (no live binding).
   */
  function toggleSameAsRecipient(checked: boolean) {
    setSameAsRecipient(checked);
    if (!checked) return;
    if (recipientContact.name) setBillingName(recipientContact.name);
    if (recipientContact.email) setBillingEmail(recipientContact.email);
  }

  /**
   * Past-due recovery: re-enter the existing hosted card-setup (connectCard)
   * flow with the payer details already on file. Completing it stores a fresh
   * verified token, after which the next collection run retries the charge.
   *
   * No acceptance is recorded here, deliberately. This screen shows no consent
   * checkbox and no document: the subscription already exists and its
   * acceptance was recorded when it was created. Writing a row from here would
   * record an acceptance the customer did not give on this screen, which is a
   * worse defect than the missing record this change set out to fix.
   */
  async function reconnectCard() {
    if (!plan?.canManage || !plan.providerConfigured) return;
    setBusy(true);
    setError(false);
    try {
      const result = await startBillingPaymentMethodSetup({
        billingName: (plan.billingName ?? billingName).trim(),
        billingEmail: (plan.billingEmail ?? billingEmail).trim(),
        acceptsRecurringCharge: true,
        termsVersion: BILLING_TERMS_VERSION,
      });
      window.location.assign(result.checkoutUrl);
    } catch {
      setBusy(false);
      setError(true);
    }
  }

  /**
   * Cancelling removes the stored card, and losing the card is what eventually
   * freezes the account. The dialog therefore has to name that consequence and
   * the deadline — the old wording only mentioned stopping future charges, so
   * the lockout arrived as a surprise.
   */
  async function cancelSubscription() {
    if (!window.confirm(t('billing.cancelConfirm', { days: plan?.graceDays ?? 0 }))) return;
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
            {isPastDue ? (
              <div className="billing-safety-note past-due" role="alert">
                <strong>{t('billing.pastDueTitle')}</strong>
                <p>{t('billing.pastDueBody')}</p>
                {plan.canManage && plan.providerConfigured ? (
                  <button
                    className="primary-button billing-past-due-button"
                    type="button"
                    disabled={busy}
                    onClick={() => void reconnectCard()}
                  >
                    {busy ? t('billing.redirecting') : t('billing.pastDueCta')}
                  </button>
                ) : null}
              </div>
            ) : (
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
            )}
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
                {recipientContact.name || recipientContact.email ? (
                  <label className="billing-consent billing-same-as-recipient">
                    <input
                      type="checkbox"
                      checked={sameAsRecipient}
                      onChange={(event) => toggleSameAsRecipient(event.target.checked)}
                    />
                    <span>{t('billing.sameAsRecipient')}</span>
                  </label>
                ) : null}
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
                    <Link to="/terms" target="_blank">
                      {t('billing.consentTermsLink')}
                    </Link>
                    {', '}
                    <Link to="/privacy" target="_blank">
                      {t('billing.consentPrivacyLink')}
                    </Link>{' '}
                    <Link to="/terms/subscription" target="_blank">
                      {t('billing.consentLink')}
                    </Link>
                  </span>
                </label>
                {consentError ? (
                  <p className="action-notice error" role="alert">
                    {t('billing.consentRecordFailed')}
                  </p>
                ) : null}
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
