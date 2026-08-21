import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/auth-context.js';

export type RegistrationValidationError = 'email' | 'password' | 'confirmation' | null;

function LandingPageLink() {
  return (
    <Link className="auth-secondary-button" to="/">
      חזרה לדף הנחיתה
    </Link>
  );
}

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

function useDelayedStatus(active: boolean, delay = 3000) {
  const [takingLonger, setTakingLonger] = useState(false);

  useEffect(() => {
    setTakingLonger(false);
    if (!active) return undefined;

    const timer = window.setTimeout(() => setTakingLonger(true), delay);
    return () => window.clearTimeout(timer);
  }, [active, delay]);

  return takingLonger;
}

export function LoginPage() {
  const { t } = useTranslation();
  const { signIn, signUp, resendSignUpConfirmation, requestMagicLink, requestPasswordReset } =
    useAuth();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<'login' | 'register'>(() =>
    searchParams.get('mode') === 'register' ? 'register' : 'login',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);
  const [registrationError, setRegistrationError] = useState<RegistrationValidationError>(null);
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [resetStatus, setResetStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [magicStatus, setMagicStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const submittingRef = useRef(false);
  const takingLonger = useDelayedStatus(submitting);

  function changeMode(nextMode: 'login' | 'register') {
    setMode(nextMode);
    setError(false);
    setRegistrationError(null);
    setConfirmationRequired(false);
    setResendStatus('idle');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submittingRef.current) return;

    submittingRef.current = true;
    setSubmitting(true);
    setError(false);
    setRegistrationError(null);
    setConfirmationRequired(false);

    try {
      if (mode === 'register') {
        const validationError = validateRegistration(email, password, confirmation);
        if (validationError) {
          setRegistrationError(validationError);
          return;
        }
        const result = await signUp(email.trim(), password);
        if (result === 'signed-in') window.location.assign('/app?firstRun=1');
        else if (result === 'confirmation-required') setConfirmationRequired(true);
        else setError(true);
        return;
      }

      const success = await signIn(email.trim(), password);
      if (!success) setError(true);
    } catch {
      setError(true);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
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

  async function resendConfirmation() {
    if (!email.trim()) {
      setResendStatus('error');
      return;
    }
    setResendStatus('sending');
    const success = await resendSignUpConfirmation(email.trim());
    setResendStatus(success ? 'sent' : 'error');
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
            disabled={submitting}
            onClick={() => changeMode('login')}
          >
            {t('auth.existingAccount')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={mode === 'register' ? 'active' : ''}
            disabled={submitting}
            onClick={() => changeMode('register')}
          >
            {t('auth.newAccount')}
          </button>
        </div>

        <form aria-busy={submitting} onSubmit={(event) => void submit(event)}>
          <label htmlFor="auth-email">
            {t(mode === 'register' ? 'auth.emailAsUsername' : 'auth.email')}
          </label>
          <input
            id="auth-email"
            type="email"
            autoComplete={mode === 'register' ? 'username' : 'email'}
            inputMode="email"
            required
            disabled={submitting}
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
            disabled={submitting}
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
                disabled={submitting}
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
            <div className="auth-confirmation-panel">
              <p className="auth-success" role="status">
                {t('auth.registrationConfirmationRequired')}
              </p>
              <p className="auth-field-help">{t('auth.registrationConfirmationHelp')}</p>
              <button
                className="auth-secondary-button"
                type="button"
                disabled={submitting || resendStatus === 'sending'}
                onClick={() => void resendConfirmation()}
              >
                {t(
                  resendStatus === 'sending'
                    ? 'auth.resendingConfirmation'
                    : 'auth.resendConfirmation',
                )}
              </button>
              {resendStatus === 'sent' ? (
                <p className="auth-success" role="status">
                  {t('auth.confirmationResent')}
                </p>
              ) : null}
              {resendStatus === 'error' ? (
                <p className="auth-error" role="alert">
                  {t('auth.confirmationResendError')}
                </p>
              ) : null}
            </div>
          ) : null}

          <button
            className={`primary-button${submitting ? ' auth-submit-loading' : ''}`}
            type="submit"
            disabled={submitting}
          >
            {submitting ? <span className="auth-spinner" aria-hidden="true" /> : null}
            {submitting
              ? t(mode === 'login' ? 'auth.signingIn' : 'auth.registering')
              : t(mode === 'login' ? 'auth.signIn' : 'auth.createAccount')}
          </button>

          {submitting ? (
            <div className="auth-progress" role="status" aria-live="polite" aria-atomic="true">
              <strong>
                {t(mode === 'login' ? 'auth.authenticationProgress' : 'auth.registrationProgress')}
              </strong>
              <span>{t(takingLonger ? 'auth.authenticationTakingLonger' : 'auth.pleaseWait')}</span>
            </div>
          ) : null}

          {mode === 'login' ? (
            <>
              <div className="auth-divider" role="separator">
                <span>{t('auth.or')}</span>
              </div>
              <button
                className="auth-magic-button"
                type="button"
                disabled={submitting || magicStatus === 'sending'}
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
                disabled={submitting || resetStatus === 'sending'}
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

        <LandingPageLink />
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
        <LandingPageLink />
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
        <LandingPageLink />
      </section>
    </main>
  );
}

export function AuthLoadingPage() {
  const { t } = useTranslation();
  const takingLonger = useDelayedStatus(true);
  return (
    <main className="auth-page" aria-busy="true">
      <section className="auth-card auth-loading-card" role="status" aria-live="polite">
        <div className="auth-brand" aria-hidden="true">
          C
        </div>
        <div className="auth-loading-heading">
          <span className="auth-spinner auth-spinner-large" aria-hidden="true" />
          <h1>{t('auth.checkingSession')}</h1>
        </div>
        <p>{t(takingLonger ? 'auth.sessionTakingLonger' : 'auth.loadingSecureWorkspace')}</p>
        <small className="auth-loading-help">{t('auth.doNotRefresh')}</small>
        <LandingPageLink />
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
        <LandingPageLink />
      </section>
    </main>
  );
}
