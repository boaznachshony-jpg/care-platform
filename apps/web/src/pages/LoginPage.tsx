import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/auth-context.js';

export function LoginPage() {
  const { t } = useTranslation();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(false);
    const success = await signIn(email.trim(), password);
    setSubmitting(false);
    if (!success) setError(true);
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
        </form>
        <small>{t('auth.closedAccess')}</small>
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
