/**
 * The application's failure model.
 *
 * Code review WEB-06: `grep -rn "ErrorBoundary\|componentDidCatch"` over
 * apps/web/src and packages/ui returned nothing. React 18 unmounts the entire
 * tree on an uncaught render or event-handler error, so a single throw — a
 * QuotaExceededError from an unguarded `localStorage.setItem`, a malformed
 * cached record, anything — replaced the whole product with a blank white
 * page at the exact moment the user pressed "save", with no explanation and
 * no way forward.
 *
 * Two levels, deliberately:
 *
 *   AppErrorBoundary     — last resort. Keeps the page alive and offers
 *                          recovery (retry, reload, return to the employer
 *                          list) instead of a blank document.
 *   SectionErrorBoundary — one panel failing must not take the page. A
 *                          failing collaboration panel leaves the payroll
 *                          figures above it on screen and readable.
 *
 * WHAT THE FALLBACK MUST NOT SHOW
 * -------------------------------
 * No stack trace and no customer data. `error.message` in this app can carry
 * a record id, a storage key or an interpolated value, so it is never
 * rendered — it goes to the browser console only, where it is already local
 * to the device. The screen shows what happened, that nothing typed was sent
 * anywhere, and what to do next.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface BoundaryProps {
  children: ReactNode;
  /** Rendered instead of `children` after a caught error. */
  fallback: (retry: () => void) => ReactNode;
  /** Test/telemetry seam. Receives the raw error; must not render it. */
  onError?: (error: unknown, info: ErrorInfo) => void;
  /**
   * Changing this value clears a caught error. Route changes pass the
   * pathname, so navigating away from a broken screen recovers on its own.
   */
  resetKey?: string;
}

interface BoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override componentDidUpdate(previous: BoundaryProps): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Console only — see the file header on why this never reaches the screen.
    console.error('[caredesk] Unhandled UI error', error, info.componentStack);
    this.props.onError?.(error, info);
  }

  private readonly retry = (): void => {
    this.setState({ failed: false });
  };

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback(this.retry) : this.props.children;
  }
}

/**
 * Whole-application boundary. Rendered inside the i18n provider so the
 * recovery screen is in the interface language; the strings live in
 * `errors.*` in packages/i18n (WEB-21 — no hardcoded literals here either).
 */
export function AppErrorBoundary({
  children,
  onError,
}: {
  children: ReactNode;
  onError?: (error: unknown, info: ErrorInfo) => void;
}) {
  const { t } = useTranslation();
  return (
    <ErrorBoundary
      onError={onError}
      fallback={(retry) => (
        <div className="app-error-screen" role="alert">
          <div className="app-error-card">
            <h1>{t('errors.app.title')}</h1>
            <p>{t('errors.app.body')}</p>
            <p className="app-error-reassurance">{t('errors.app.dataSafe')}</p>
            <div className="app-error-actions">
              <button className="primary-button" type="button" onClick={retry}>
                {t('errors.app.retry')}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => window.location.reload()}
              >
                {t('errors.app.reload')}
              </button>
              {/* A plain anchor, not a router Link: the router itself may be
                  the thing that threw. */}
              <a className="secondary-button" href="/app">
                {t('errors.app.home')}
              </a>
            </div>
            <p className="app-error-support">{t('errors.app.support')}</p>
          </div>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

/**
 * One panel's boundary. `title` names the panel that failed so the user can
 * tell which part of the page is missing rather than wondering what vanished.
 */
export function SectionErrorBoundary({
  children,
  title,
  resetKey,
  onError,
}: {
  children: ReactNode;
  title?: string;
  resetKey?: string;
  onError?: (error: unknown, info: ErrorInfo) => void;
}) {
  const { t } = useTranslation();
  return (
    <ErrorBoundary
      resetKey={resetKey}
      onError={onError}
      fallback={(retry) => (
        <section className="card section-error" role="alert">
          <h2>{title ?? t('errors.section.title')}</h2>
          <p>{t('errors.section.body')}</p>
          <button className="secondary-button" type="button" onClick={retry}>
            {t('errors.section.retry')}
          </button>
        </section>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
