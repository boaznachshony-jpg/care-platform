import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

/**
 * GAP-2-01: shown when the server refuses the workspace outright (401/403).
 * By the time this renders the device has already been purged by
 * stopWorkspaceSync; the only thing left to offer is a clean sign-out.
 *
 * The sign-out action arrives as a prop rather than through useAuth so this
 * module does not import auth-context, which renders it.
 */
export function AccessRevokedPage({ signOut }: { signOut: () => Promise<'ok' | 'error'> }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function leave() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      setFailed((await signOut()) !== 'ok');
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page" dir="rtl">
      <section className="auth-card" role="alert">
        <div className="auth-brand" aria-hidden="true">
          C
        </div>
        <h1>{t('auth.accessRevokedTitle')}</h1>
        <p>{t('auth.accessRevokedBody')}</p>
        <button
          className="primary-button"
          type="button"
          disabled={busy}
          onClick={() => void leave()}
        >
          {t('auth.signOut')}
        </button>
        {failed ? (
          <p className="auth-error" role="alert">
            {t('auth.signOutFailed')}
          </p>
        ) : null}
        <Link className="auth-secondary-button" to="/">
          {t('auth.backToPublicSite')}
        </Link>
      </section>
    </main>
  );
}
