import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/auth-context.js';

export type RegistrationValidationError = 'email' | 'password' | 'confirmation' | null;

export function validateRegistration(
  email: string,
  password: string,
  confirmation: string,
): RegistrationValidationError {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'email';
  if (password.length < 12) return 'password';
  if (password !== confirmation) return 'confirmation';
  return null;
}

export function LoginPage() {
  const { t } = useTranslation();
  const { signIn, signUp, requestMagicLink, requestPasswordReset } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);
  const [registrationError, setRegistrationError] = useState<RegistrationValidationError>(null);
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [resetStatus, setResetStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [magicStatus, setMagicStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  function changeMode(nextMode: 'login' | 'register') {
    setMode(nextMode);
    setError(false);
    setRegistrationError(null);
    setConfirmationRequired(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(false);
    setRegistrationError(null);
    setConfirmationRequired(false);

    if (mode === 'register') {
      const validationError = validateRegistration(email, password, confirmation);
      if (validationError) {
        setRegistrationError(validationError);
        setSubmitting(false);
        return;
      }
      const result = await signUp(email.trim(), password);
      setSubmitting(false);
      if (result === 'signed-in') window.location.assign('/app?firstRun=1');
      else if (result === 'confirmation-required') setConfirmationRequired(true);
      else setError(true);
      return;
    }

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

  async function sendMagicLink() {
    if (!email.trim()) {
      setMagicStatus('error');
      return;
    }
    setMagicStatus('sending');
    const success = await requestMagicLink(email.trim());
    setMagicStatus(success ? 'sent' : 'error');
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="auth-brand" aria-hidden="true">
          C
        </div>
        <p className="eyebrow">CareDesk</p>
        <h1 id="login-title">{t(mode === 'login' ? 'auth.loginTitle' : 'auth.registerTitle')}</h1>
        <p>{t(mode === 'login' ? 'auth.loginIntro' : 'auth.registerIntro')}</p>

        <div className="auth-mode-switch" role="tablist" aria-label={t('auth.accountAccess')}>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={mode === 'login' ? 'active' : ''}
            onClick={() => changeMode('login')}
          >
            {t('auth.existingAccount')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={mode === 'register' ? 'active' : ''}
            onClick={() => changeMode('register')}
          >
            {t('auth.newAccount')}
          </button>
        </div>

        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="auth-email">
            {t(mode === 'register' ? 'auth.emailAsUsername' : 'auth.email')}
          </label>
          <input
            id="auth-email"
            type="email"
            autoComplete={mode === 'register' ? 'username' : 'email'}
            inputMode="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <label htmlFor="auth-password">{t('auth.password')}</label>
          <input
            id="auth-password"
            type="password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            required
            minLength={mode === 'register' ? 12 : 8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          {mode === 'register' ? (
            <>
              <small className="auth-field-help">{t('auth.passwordRequirements')}</small>
              <label htmlFor="auth-password-confirmation">{t('auth.confirmPassword')}</label>
              <input
                id="auth-password-confirmation"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                value={confirmation}
                aria-invalid={registrationError === 'confirmation' || undefined}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </>
          ) : null}

          {registrationError ? (
            <p className="auth-error" role="alert">
              {t(`auth.registrationErrors.${registrationError}`)}
            </p>
          ) : null}
          {error ? (
            <p className="auth-error" role="alert">
              {t(mode === 'login' ? 'auth.invalidCredentials' : 'auth.registrationFailed')}
            </p>
          ) : null}
          {confirmationRequired ? (
            <p className="auth-success" role="status">
              {t('auth.registrationConfirmationRequired')}
            </p>
          ) : null}

          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting
              ? t(mode === 'login' ? 'auth.signingIn' : 'auth.registering')
              : t(mode === 'login' ? 'auth.signIn' : 'auth.createAccount')}
          </button>

          {mode === 'login' ? (
            <>
              <div className="auth-divider" role="separator">
                <span>{t('auth.or')}</span>
              </div>
              <button
                className="auth-magic-button"
                type="button"
                disabled={magicStatus === 'sending'}
                onClick={() => void sendMagicLink()}
              >
                {magicStatus === 'sending' ? t('auth.sendingMagicLink') : t('auth.sendMagicLink')}
              </button>
              {magicStatus === 'sent' ? (
                <p className="auth-success" role="status">
                  {t('auth.magicLinkSent')}
                </p>
              ) : null}
              {magicStatus === 'error' ? (
                <p className="auth-error" role="alert">
                  {t('auth.magicLinkError')}
                </p>
              ) : null}
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
            </>
          ) : null}
        </form>

        <Link className="auth-secondary-button" to="/">
          {t('auth.backToPublicSite')}
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
