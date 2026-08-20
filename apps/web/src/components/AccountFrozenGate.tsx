import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import type { BillingPlanResponse } from '@caredesk/schemas';
import { getBillingSubscription } from '../api/client.js';
import { useAuth } from '../auth/auth-context.js';

/**
 * The billing status is fetched once per browser session and shared by every
 * mount of the gate; navigating between pages must not re-issue the request.
 * A failed fetch clears the cache so the next mount can try again.
 */
let sessionPlanPromise: Promise<BillingPlanResponse> | null = null;

/** Test-only: clears the once-per-session billing status cache. */
export function resetAccountFrozenGateCache(): void {
  sessionPlanPromise = null;
}

function fetchBillingStatusOncePerSession(): Promise<BillingPlanResponse> {
  if (!sessionPlanPromise) {
    sessionPlanPromise = getBillingSubscription().catch((error: unknown) => {
      sessionPlanPromise = null;
      throw error;
    });
  }
  return sessionPlanPromise;
}

/**
 * Locks the authenticated app when the account's billing accessState is
 * 'frozen' and shows a non-blocking warning during the 'grace' window.
 *
 * Deliberate decisions:
 * - Fail open: while loading, on a network error, or when the caller may not
 *   read billing (e.g. a worker session), the children render normally. A
 *   network blip must never lock users out of the product.
 * - The /billing route is never locked — it is the page that fixes the
 *   problem, so the frozen screen only points there and steps aside on it.
 */
export function AccountFrozenGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const { pathname } = useLocation();
  const [plan, setPlan] = useState<BillingPlanResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchBillingStatusOncePerSession()
      .then((result) => {
        if (!cancelled) setPlan(result);
      })
      .catch(() => {
        // Fail open by design: an unknown billing state renders the app.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onBillingPage = pathname === '/billing';

  if (plan?.accessState === 'frozen' && !onBillingPage) {
    return (
      <main className="billing-page account-frozen-screen" id="main-content">
        <section className="card" role="alert">
          <h1>{t('billing.frozenTitle')}</h1>
          <p>{t('billing.frozenBody')}</p>
          <Link className="primary-button" to="/billing">
            {t('billing.frozenCta')}
          </Link>
          <button className="secondary-button" type="button" onClick={() => void auth.signOut()}>
            {t('billing.frozenSignOut')}
          </button>
        </section>
      </main>
    );
  }

  return (
    <>
      {plan?.accessState === 'grace' && !onBillingPage ? (
        <div className="action-notice error account-grace-banner" role="status">
          <span>{t('billing.graceBanner', { days: plan.graceDaysRemaining ?? 0 })}</span>{' '}
          <Link to="/billing">{t('billing.graceCta')}</Link>
        </div>
      ) : null}
      {children}
    </>
  );
}
