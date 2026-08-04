import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/auth-context.js';

export function LoginPage() {
  const { t } = useTranslation();
  const { signIn, requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);
  const [resetStatus, setResetStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(false);
    const success = await signIn(email.trim(), password);
    setSubmitting(false);
    if (!success) setError(true);
  }

  async function resetPassword() {
    if (!email.trim()) {
      setResetStatus('error');
      return;
    }
    setResetStatus('sending');
    const success = await requestPasswordReset(email.trim());
    setResetStatus(success ? 'sent' : 'error');
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="auth-brand" aria-hidden="true">
          C
        </div>
        <p className="eyebrow">CareDesk</p>
        <h1 id="login-title">{t('auth.loginTitle')}</h1>
        <p>{t('auth.loginIntro')}</p>
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="auth-email">{t('auth.email')}</label>
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="auth-password">{t('auth.password')}</label>
          <input
            id="auth-password"
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error ? (
            <p className="auth-error" role="alert">
              {t('auth.invalidCredentials')}
            </p>
          ) : null}
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? t('auth.signingIn') : t('auth.signIn')}
          </button>
          <button
            className="auth-secondary-button"
            type="button"
            disabled={resetStatus === 'sending'}
            onClick={() => void resetPassword()}
          >
            {resetStatus === 'sending' ? t('auth.sendingReset') : t('auth.forgotPassword')}
          </button>
          {resetStatus === 'sent' ? (
            <p className="auth-success" role="status">
              {t('auth.resetSent')}
            </p>
          ) : null}
          {resetStatus === 'error' ? (
            <p className="auth-error" role="alert">
              {t('auth.resetError')}
            </p>
          ) : null}
        </form>
        <small>{t('auth.closedAccess')}</small>
        <Link className="auth-secondary-button" to="/">
          חזרה לדף המידע הציבורי
        </Link>
      </section>
    </main>
  );
}

export function PasswordRecoveryPage() {
  const { t } = useTranslation();
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 12 || password !== confirmation) {
      setError(true);
      return;
    }
    setSubmitting(true);
    setError(false);
    const success = await updatePassword(password);
    setSubmitting(false);
    if (!success) setError(true);
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="password-recovery-title">
        <div className="auth-brand" aria-hidden="true">
          C
        </div>
        <h1 id="password-recovery-title">{t('auth.choosePasswordTitle')}</h1>
        <p>{t('auth.choosePasswordIntro')}</p>
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="new-password">{t('auth.newPassword')}</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <label htmlFor="confirm-password">{t('auth.confirmPassword')}</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          {error ? (
            <p className="auth-error" role="alert">
              {t('auth.passwordUpdateError')}
            </p>
          ) : null}
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? t('auth.updatingPassword') : t('auth.updatePassword')}
          </button>
        </form>
      </section>
    </main>
  );
}

export function AuthConfigurationRequiredPage() {
  const { t } = useTranslation();
  return (
    <main className="auth-page">
      <section className="auth-card" role="alert">
        <div className="auth-brand" aria-hidden="true">
          C
        </div>
        <h1>{t('auth.configurationRequiredTitle')}</h1>
        <p>{t('auth.configurationRequiredBody')}</p>
      </section>
    </main>
  );
}

export function AuthLoadingPage() {
  const { t } = useTranslation();
  return (
    <main className="auth-page" aria-busy="true">
      <section className="auth-card">
        <div className="auth-brand" aria-hidden="true">
          C
        </div>
        <p>{t('auth.checkingSession')}</p>
      </section>
    </main>
  );
}

export function StorageUnavailablePage() {
  const { t } = useTranslation();
  return (
    <main className="auth-page" dir="rtl">
      <section className="auth-card" role="alert">
        <div className="auth-brand" aria-hidden="true">
          C
        </div>
        <h1>{t('auth.storageUnavailableTitle')}</h1>
        <p>{t('auth.storageUnavailableBody')}</p>
        <button className="primary-button" type="button" onClick={() => window.location.reload()}>
          {t('auth.retry')}
        </button>
      </section>
    </main>
  );
}
