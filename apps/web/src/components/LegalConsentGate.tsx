import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { PRIVACY_DOCUMENT_VERSION, TERMS_DOCUMENT_VERSION } from '@caredesk/i18n';
import type { AcceptedDocument, LegalAcceptanceRecord } from '@caredesk/schemas';
import { listLegalAcceptances, recordLegalAcceptance } from '../api/client.js';
import { useAuth } from '../auth/auth-context.js';

/**
 * The documents every signed-in user must have accepted, at the versions the
 * public pages currently display. Both constants come from `@caredesk/i18n`,
 * which is also what renders the version line on /terms and /privacy, so the
 * recorded string is by construction the string the user was shown.
 */
const REQUIRED_DOCUMENTS: readonly AcceptedDocument[] = [
  { document: 'terms', version: TERMS_DOCUMENT_VERSION },
  { document: 'privacy', version: PRIVACY_DOCUMENT_VERSION },
];

/**
 * Routes the gate never covers.
 *
 * /terms and /privacy are the documents themselves - a user cannot be asked to
 * read what they are locked out of (they are public routes today, but the
 * exemption is kept here so moving them behind sign-in later cannot create
 * that deadlock). /worker is the caregiver's portal: the caregiver is the
 * data subject the privacy policy is about, not a party who accepts it, and
 * a worker session may not even be allowed to read /legal/acceptances.
 */
const EXEMPT_PATHS = new Set(['/terms', '/privacy', '/worker']);

export function hasCurrentLegalAcceptance(records: readonly LegalAcceptanceRecord[]): boolean {
  return REQUIRED_DOCUMENTS.every((required) =>
    records.some(
      (record) => record.document === required.document && record.version === required.version,
    ),
  );
}

/**
 * Once a user's acceptance has been confirmed in this browser session there is
 * nothing left to ask; the check is not repeated on every remount. Keyed by
 * user id so signing out and back in as somebody else is checked afresh. A
 * failed or missing check is never cached: the next mount asks again.
 */
let acceptedForUserId: string | null = null;

/** Test-only: forgets the per-session "already accepted" memo. */
export function resetLegalConsentGateCache(): void {
  acceptedForUserId = null;
}

type GateStatus = 'checking' | 'accepted' | 'required';

/**
 * Asks any signed-in user who has no acceptance on record at the current
 * document versions to accept the terms of service and the privacy policy
 * before the product renders.
 *
 * WHY THIS EXISTS (GAP-5-01)
 * --------------------------
 * The two screens that collected an acceptance - the end of onboarding and
 * the billing form - are screens only the account owner ever reaches. An
 * invited manager or viewer signs in through the family-access invitation and
 * lands on the dashboard. The privacy policy tells them their acceptance is
 * recorded; until this gate, nothing recorded it.
 *
 * Deliberate decisions, following AccountFrozenGate:
 * - Fail open on a network error: an unknown answer renders the app. A gate
 *   that locks a family out because the API blinked would be a worse defect
 *   than the one it fixes. The check is repeated on the next mount.
 * - Fail CLOSED on a failed submit: if the acceptance cannot be recorded the
 *   gate stays and says so (role="alert"), exactly like BillingPage. Letting
 *   the user through on a failed write would recreate the original gap with a
 *   checkbox as decoration.
 * - The acceptance is a record, not a toggle: one affirmative checkbox, both
 *   documents in one request (one outcome, never terms-without-privacy), and
 *   context 'first-visit' so the row can be traced back to this screen.
 */
export function LegalConsentGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const { pathname } = useLocation();
  const userId = auth.user?.id ?? null;
  const exempt = EXEMPT_PATHS.has(pathname);
  const [status, setStatus] = useState<GateStatus>(() =>
    userId && acceptedForUserId === userId ? 'accepted' : 'checking',
  );
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recordFailed, setRecordFailed] = useState(false);

  useEffect(() => {
    if (exempt || status !== 'checking') return;
    let cancelled = false;
    listLegalAcceptances()
      .then((response) => {
        if (cancelled) return;
        if (hasCurrentLegalAcceptance(response.acceptances)) {
          if (userId) acceptedForUserId = userId;
          setStatus('accepted');
        } else {
          setStatus('required');
        }
      })
      .catch(() => {
        // Fail open by design: an unknown answer renders the app, and the
        // question is asked again on the next mount.
        if (!cancelled) setStatus('accepted');
      });
    return () => {
      cancelled = true;
    };
    // The check runs once per mount; `status` is only read to skip it after
    // the constructor found a session memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exempt, userId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!accepted || busy) return;
    setBusy(true);
    setRecordFailed(false);
    try {
      await recordLegalAcceptance({ documents: [...REQUIRED_DOCUMENTS], context: 'first-visit' });
    } catch {
      setBusy(false);
      setRecordFailed(true);
      return;
    }
    if (userId) acceptedForUserId = userId;
    setBusy(false);
    setStatus('accepted');
  }

  if (exempt || status !== 'required') return <>{children}</>;

  return (
    <main className="billing-page account-frozen-screen legal-consent-screen" id="main-content">
      <section className="card" aria-labelledby="legal-consent-title">
        <h1 id="legal-consent-title">{t('consent.gateTitle')}</h1>
        <p>{t('consent.gateBody')}</p>
        <form onSubmit={submit} aria-busy={busy}>
          <label className="billing-consent">
            <input
              type="checkbox"
              required
              checked={accepted}
              disabled={busy}
              onChange={(event) => setAccepted(event.target.checked)}
            />
            <span>
              {t('consent.gateCheckboxPrefix')}{' '}
              <Link to="/terms" target="_blank">
                {t('consent.gateTermsLink')}
              </Link>{' '}
              {t('consent.gateAnd')}{' '}
              <Link to="/privacy" target="_blank">
                {t('consent.gatePrivacyLink')}
              </Link>
            </span>
          </label>
          {recordFailed ? (
            <p className="action-notice error" role="alert">
              {t('consent.gateRecordFailed')}
            </p>
          ) : null}
          <button className="primary-button" type="submit" disabled={!accepted || busy}>
            {busy ? t('consent.gateSubmitting') : t('consent.gateSubmit')}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => void auth.signOut()}
          >
            {t('consent.gateSignOut')}
          </button>
        </form>
      </section>
    </main>
  );
}
