import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth, type SignOutResult } from '../auth/auth-context.js';

export interface SignOutButtonProps {
  className?: string;
  /** Button content; defaults to the translated "sign out" label. */
  children?: ReactNode;
  /** Runs before the sign-out starts (for example, closing a mobile menu). */
  onBeforeSignOut?: () => void;
  /**
   * Skip the cloud flush on the first press. Only for screens where there is
   * nothing left to save, such as the access-revoked page.
   */
  discardUnsaved?: boolean;
}

/**
 * SEC-WEB-01: the one sign-out control for every screen. A refused sign-out
 * is never silent - it renders an alert with the two honest options: try to
 * save again, or leave and lose the unsaved edits.
 */
export function SignOutButton({
  className = 'sign-out-button',
  children,
  onBeforeSignOut,
  discardUnsaved = false,
}: SignOutButtonProps) {
  const { t } = useTranslation();
  const auth = useAuth();
  const [outcome, setOutcome] = useState<Exclude<SignOutResult, 'ok'> | null>(null);
  const [busy, setBusy] = useState(false);

  async function attempt(options: { discardUnsaved: boolean }) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await auth.signOut(options);
      setOutcome(result === 'ok' ? null : result);
    } catch {
      setOutcome('error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className={className}
        type="button"
        disabled={busy}
        onClick={() => {
          onBeforeSignOut?.();
          void attempt({ discardUnsaved });
        }}
      >
        {children ?? t('auth.signOut')}
      </button>
      {outcome ? (
        <span className="sync-status sync-status-error" role="alert">
          {t(outcome === 'unsaved-changes' ? 'auth.signOutBlocked' : 'auth.signOutFailed')}
          <button
            className="sync-retry-button"
            type="button"
            disabled={busy}
            onClick={() => void attempt({ discardUnsaved: false })}
          >
            {t('auth.signOutRetry')}
          </button>
          {outcome === 'unsaved-changes' ? (
            <button
              className="sync-retry-button"
              type="button"
              disabled={busy}
              onClick={() => void attempt({ discardUnsaved: true })}
            >
              {t('auth.signOutDiscard')}
            </button>
          ) : null}
        </span>
      ) : null}
    </>
  );
}
