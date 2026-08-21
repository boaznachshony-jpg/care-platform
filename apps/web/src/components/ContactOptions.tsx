import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/auth-context.js';
import {
  SUPPORT_MESSAGE_MAX_LENGTH,
  SUPPORT_MESSAGE_MIN_LENGTH,
  submitSupportRequest,
  type SupportRequestKind,
} from '../contact.js';

type SubmissionState = 'idle' | 'submitting' | 'success' | 'error';

export function ContactOptions() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [kind, setKind] = useState<SupportRequestKind | null>(null);
  const [replyEmail, setReplyEmail] = useState(user?.email ?? '');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [submission, setSubmission] = useState<SubmissionState>('idle');
  const dialogRef = useRef<HTMLElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const launchButtonRef = useRef<HTMLButtonElement | null>(null);

  const closeDialog = useCallback(() => {
    setKind(null);
    setSubmission('idle');
    window.setTimeout(() => launchButtonRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!kind) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && submission !== 'submitting') {
        closeDialog();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), textarea:not([disabled])',
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeDialog, kind, submission]);

  function openDialog(nextKind: SupportRequestKind, button: HTMLButtonElement) {
    launchButtonRef.current = button;
    setKind(nextKind);
    setReplyEmail(user?.email ?? '');
    setMessage('');
    setWebsite('');
    setSubmission('idle');
    window.setTimeout(() => (user?.email ? messageRef.current : emailRef.current)?.focus(), 0);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!kind || message.trim().length < SUPPORT_MESSAGE_MIN_LENGTH) return;

    setSubmission('submitting');
    try {
      await submitSupportRequest({
        kind,
        replyEmail: replyEmail.trim(),
        message: message.trim(),
        website,
      });
      setSubmission('success');
    } catch {
      setSubmission('error');
    }
  }

  const remainingCharacters = SUPPORT_MESSAGE_MAX_LENGTH - message.length;

  return (
    <div className="contact-options">
      <article className="contact-option-card">
        <span className="contact-option-icon" aria-hidden="true">
          ?
        </span>
        <div>
          <h2>{t('contact.helpTitle')}</h2>
          <p>{t('contact.helpBody')}</p>
        </div>
        <button
          className="contact-option-action contact-option-action-primary"
          type="button"
          onClick={(event) => openDialog('help', event.currentTarget)}
        >
          {t('contact.helpAction')}
        </button>
      </article>

      <article className="contact-option-card">
        <span className="contact-option-icon contact-option-icon-feedback" aria-hidden="true">
          +
        </span>
        <div>
          <h2>{t('contact.feedbackTitle')}</h2>
          <p>{t('contact.feedbackBody')}</p>
        </div>
        <button
          className="contact-option-action contact-option-action-secondary"
          type="button"
          onClick={(event) => openDialog('feedback', event.currentTarget)}
        >
          {t('contact.feedbackAction')}
        </button>
      </article>

      <p className="contact-privacy-note">{t('contact.privacy')}</p>

      {kind ? (
        <div className="contact-dialog-backdrop" role="presentation">
          <section
            ref={dialogRef}
            className="contact-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="contact-dialog-title"
            aria-describedby={submission === 'success' ? undefined : 'contact-dialog-description'}
          >
            <div className="contact-dialog-heading">
              <div>
                <p className="eyebrow">{t(`contact.${kind}DialogEyebrow`)}</p>
                <h2 id="contact-dialog-title">{t(`contact.${kind}DialogTitle`)}</h2>
              </div>
              <button
                className="contact-dialog-close"
                type="button"
                onClick={closeDialog}
                disabled={submission === 'submitting'}
                aria-label={t('contact.close')}
              >
                ×
              </button>
            </div>

            {submission === 'success' ? (
              <div className="contact-success" role="status">
                <strong>{t('contact.successTitle')}</strong>
                <p>{t('contact.successBody')}</p>
                <button className="primary-button" type="button" onClick={closeDialog}>
                  {t('contact.done')}
                </button>
              </div>
            ) : (
              <form className="contact-request-form" onSubmit={handleSubmit}>
                <p id="contact-dialog-description">{t('contact.formIntro')}</p>

                <label htmlFor={`contact-email-${kind}`}>{t('contact.replyEmail')}</label>
                <input
                  ref={emailRef}
                  id={`contact-email-${kind}`}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={replyEmail}
                  onChange={(event) => setReplyEmail(event.target.value)}
                  required
                  maxLength={254}
                  disabled={submission === 'submitting'}
                />
                <small>{t('contact.replyEmailHint')}</small>

                <label htmlFor={`contact-message-${kind}`}>{t('contact.messageLabel')}</label>
                <textarea
                  ref={messageRef}
                  id={`contact-message-${kind}`}
                  rows={6}
                  value={message}
                  onChange={(event) =>
                    setMessage(event.target.value.slice(0, SUPPORT_MESSAGE_MAX_LENGTH))
                  }
                  required
                  minLength={SUPPORT_MESSAGE_MIN_LENGTH}
                  maxLength={SUPPORT_MESSAGE_MAX_LENGTH}
                  placeholder={t(`contact.${kind}Placeholder`)}
                  disabled={submission === 'submitting'}
                />
                {message.trim().length > 0 && message.trim().length < SUPPORT_MESSAGE_MIN_LENGTH ? (
                  <small className="contact-min-length-hint">{t('contact.minLength')}</small>
                ) : null}
                <div className="contact-character-count" aria-live="polite">
                  {t('contact.charactersRemaining', { count: Math.max(0, remainingCharacters) })}
                </div>

                <div className="contact-honeypot" aria-hidden="true">
                  <label htmlFor={`contact-website-${kind}`}>Website</label>
                  <input
                    id={`contact-website-${kind}`}
                    name="website"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={(event) => setWebsite(event.target.value)}
                  />
                </div>

                {submission === 'error' ? (
                  <p className="contact-form-error" role="alert">
                    {t('contact.error')}
                  </p>
                ) : null}

                <div className="contact-dialog-actions">
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={
                      submission === 'submitting' ||
                      !replyEmail.trim() ||
                      message.trim().length < SUPPORT_MESSAGE_MIN_LENGTH
                    }
                  >
                    {submission === 'submitting' ? t('contact.sending') : t('contact.send')}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={closeDialog}
                    disabled={submission === 'submitting'}
                  >
                    {t('contact.cancel')}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
