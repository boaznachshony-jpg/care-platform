import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { directionFor } from '@caredesk/i18n';
import { apiRequest, getWorkerPreferences, type WorkerPreferencesResponse } from '../api/client.js';
import { newIdempotencyKey } from '../api/idempotency.js';
import { formatDateOnly, formatDateTime, toIsoAttribute } from '../format-timestamp.js';

type Portal = {
  payments: Array<{
    closeId: string;
    month: string;
    amountPaid: number | null;
    paymentDate: string;
    acknowledgement: 'pending' | 'acknowledged';
    acknowledgedAt?: string;
  }>;
  leave: { availableBalance: number | null; used: number; planned: number };
  requests: Array<{
    id: string;
    request_type: string;
    message: string;
    status: string;
    // The API has always returned these; the client type simply dropped them,
    // so a request thread showed no sense of when anything happened.
    created_at?: string;
    updated_at?: string;
  }>;
  documents: Array<{ id: string; document_type: string }>;
};

type WorkerLocale = 'he' | 'en';
type WriteState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * One idempotency key per logical attempt (the VisaRenewalSection pattern):
 * the same payload keeps the same key, so a lost response plus a second press
 * is replayed by the server rather than duplicated, and a changed payload is a
 * new attempt with a new key. Cleared after success so a later, deliberate
 * repeat of the same text is not swallowed as a replay.
 */
type WriteAttempt = { signature: string; key: string } | null;
function keyForAttempt(ref: { current: WriteAttempt }, signature: string): string {
  if (ref.current?.signature !== signature) {
    ref.current = { signature, key: newIdempotencyKey() };
  }
  return ref.current.key;
}

/**
 * UI-WRITE-07 / UI-STATES-03 / UI-NAV-04. Every write on this page used to be
 * a bare `await apiRequest(...)` in an event handler: no saving state, no
 * catch, no double-submit lock. A failed acknowledgement, request or
 * preference save produced nothing on screen at all, and a second tap while
 * the first was in flight sent the request again. This is the one place the
 * caregiver herself writes to CareDesk, so silence here is a broken promise
 * to her, not just to the family.
 */
function WriteNotice({
  state,
  savedText,
  onRetry,
}: {
  state: WriteState;
  savedText: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (state === 'saving') return <p role="status">{t('worker.saving')}</p>;
  if (state === 'saved') return <p role="status">{savedText}</p>;
  if (state === 'error')
    return (
      <p role="alert" className="action-notice error">
        {t('worker.saveFailed')}{' '}
        <button type="button" onClick={onRetry}>
          {t('worker.retry')}
        </button>
      </p>
    );
  return null;
}

export function WorkerPortalPage() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<Portal | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState('home');
  const [message, setMessage] = useState('');
  const [locale, setLocale] = useState<WorkerLocale>('he');
  // Defect fix: the save on the profile tab used to hardcode
  // `whatsappConsent: 'unknown'` on every submit because nothing here ever
  // read the stored preference first — so saving a language change could
  // silently reset a caregiver's earlier, explicit WhatsApp/SMS opt-out back
  // to 'unknown'. Loading it is what makes the save able to echo a value the
  // worker actually holds instead of a hardcoded blank. The server
  // (Wave5Service.updatePreference) is still the real guarantee: it never
  // trusts this echo to be right and never lets an 'unknown' overwrite a
  // stored 'revoked' (or 'granted') — this is only the client-side half.
  const [preferences, setPreferences] = useState<WorkerPreferencesResponse | null>(null);
  // Per-write state. The refs are the locks: two taps in the same tick both
  // see the old state because React has not re-rendered yet, so a state flag
  // alone cannot stop the second request.
  const [ack, setAck] = useState<{ closeId: string; state: WriteState } | null>(null);
  const ackInFlight = useRef<string | null>(null);
  const [requestState, setRequestState] = useState<WriteState>('idle');
  const requestInFlight = useRef(false);
  const requestAttempt = useRef<WriteAttempt>(null);
  const [prefsState, setPrefsState] = useState<WriteState>('idle');
  const prefsInFlight = useRef(false);
  const prefsAttempt = useRef<WriteAttempt>(null);
  const load = () =>
    apiRequest<Portal>('/worker/portal')
      .then(setData)
      .catch(() => setError(true));
  /**
   * UI-STATES-03: the saved language used to be written to the server and then
   * ignored — the portal kept rendering in the default locale, so a caregiver
   * who chose English saw the confirmation of her choice in Hebrew. Applying
   * it is what makes the preference a preference. `dir` follows the locale
   * because this page is the one surface in the product that is legitimately
   * LTR for some of its readers.
   */
  const applyLocale = (next: WorkerLocale) => {
    setLocale(next);
    void i18n.changeLanguage(next);
    document.documentElement.lang = next;
    document.documentElement.dir = directionFor(next);
  };
  useEffect(() => {
    void apiRequest<Portal>('/worker/portal')
      .then(setData)
      .catch(() => setError(true));
  }, []);
  useEffect(() => {
    void getWorkerPreferences()
      .then((prefs) => {
        setPreferences(prefs);
        if (prefs.preferred_locale === 'he' || prefs.preferred_locale === 'en') {
          applyLocale(prefs.preferred_locale);
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount; applyLocale only reads stable i18n/document handles.
  }, []);
  async function acknowledge(closeId: string) {
    if (ackInFlight.current) return;
    ackInFlight.current = closeId;
    setAck({ closeId, state: 'saving' });
    try {
      // No idempotency key: the server upserts with ON CONFLICT, so a replay
      // of this POST is already a no-op. The lock above is what stops the
      // double tap from ever leaving the device.
      await apiRequest(`/worker/payments/${closeId}/acknowledgements`, { method: 'POST' });
      setAck({ closeId, state: 'saved' });
      await load();
    } catch {
      setAck({ closeId, state: 'error' });
    } finally {
      ackInFlight.current = null;
    }
  }
  async function submitRequest() {
    if (requestInFlight.current) return;
    const body = { type: 'general', message };
    requestInFlight.current = true;
    setRequestState('saving');
    try {
      await apiRequest('/worker/requests', {
        method: 'POST',
        headers: { 'idempotency-key': keyForAttempt(requestAttempt, JSON.stringify(body)) },
        body: JSON.stringify(body),
      });
      requestAttempt.current = null;
      setMessage('');
      setRequestState('saved');
      await load();
    } catch {
      // The typed message is kept: a failed send must not also lose the text.
      setRequestState('error');
    } finally {
      requestInFlight.current = false;
    }
  }
  async function savePreferences() {
    if (prefsInFlight.current) return;
    const body = {
      locale,
      channel: 'email',
      // Echo the one consent state this portal is ever allowed to write: an
      // explicit prior revoke. Anything else (unknown, granted, or a
      // preference we failed to load) sends 'unknown' — read server-side as
      // "this request has no opinion about consent" and never allowed to
      // overwrite whatever is actually stored. See getWorkerPreferences and
      // Wave5Service.updatePreference.
      whatsappConsent: preferences?.whatsapp_consent === 'revoked' ? 'revoked' : 'unknown',
      smsConsent: preferences?.sms_consent === 'revoked' ? 'revoked' : 'unknown',
    };
    prefsInFlight.current = true;
    setPrefsState('saving');
    try {
      await apiRequest('/worker/preferences', {
        method: 'PUT',
        headers: { 'idempotency-key': keyForAttempt(prefsAttempt, JSON.stringify(body)) },
        body: JSON.stringify(body),
      });
      prefsAttempt.current = null;
      setPrefsState('saved');
      // Only a confirmed save changes the language the page speaks — a failed
      // PUT must not leave the screen claiming a preference the server never
      // recorded.
      applyLocale(locale);
    } catch {
      setPrefsState('error');
    } finally {
      prefsInFlight.current = false;
    }
  }
  if (error)
    return (
      <main className="worker-portal">
        <h1>{t('worker.title')}</h1>
        <p role="alert">{t('worker.accessError')}</p>
      </main>
    );
  if (!data)
    return (
      <main className="worker-portal" aria-busy="true">
        {t('worker.loading')}
      </main>
    );
  const latest = data.payments[0];
  return (
    <main className="worker-portal">
      <header>
        <span className="worker-brand">CareDesk</span>
        <h1>{t('worker.title')}</h1>
      </header>
      <nav aria-label={t('worker.navigation')}>
        {['home', 'payments', 'vacation', 'documents', 'requests', 'profile'].map((key) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            {t(`worker.nav.${key}`)}
          </button>
        ))}
      </nav>
      {tab === 'home' && (
        <section>
          <h2>{t('worker.hello')}</h2>
          <div className="worker-grid">
            <article>
              <h3>{t('worker.latestPayment')}</h3>
              <p>
                {latest
                  ? `${latest.month} — ${latest.amountPaid === null ? t('worker.amountUnavailable') : `₪${latest.amountPaid}`}`
                  : t('worker.noPayments')}
              </p>
            </article>
            <article>
              <h3>{t('worker.vacation')}</h3>
              <p>
                {data.leave.availableBalance === null
                  ? t('worker.balanceUnavailable')
                  : data.leave.availableBalance}
              </p>
            </article>
            <article>
              <h3>{t('worker.requests')}</h3>
              <p>
                {data.requests.filter((r) => !['resolved', 'cancelled'].includes(r.status)).length}
              </p>
            </article>
            <article>
              <h3>{t('worker.documents')}</h3>
              <p>{data.documents.length}</p>
            </article>
          </div>
        </section>
      )}
      {tab === 'payments' && (
        <section>
          <h2>{t('worker.payments')}</h2>
          {/* The worker sees amounts the employer entered and the system summed;
              the caveat precedes the list so it covers every row. */}
          <p className="legal-note">{t('liability.calculation')}</p>
          {data.payments.length === 0 ? (
            <p>{t('worker.noPayments')}</p>
          ) : (
            data.payments.map((p) => {
              const rowState: WriteState = ack?.closeId === p.closeId ? ack.state : 'idle';
              return (
                <article key={p.closeId} className="worker-card">
                  <strong>{p.month}</strong>
                  <p>
                    {p.amountPaid === null ? t('worker.amountUnavailable') : `₪${p.amountPaid}`} ·{' '}
                    <time dateTime={toIsoAttribute(p.paymentDate) ?? undefined}>
                      {formatDateOnly(p.paymentDate) ?? p.paymentDate}
                    </time>
                  </p>
                  {p.acknowledgement === 'pending' ? (
                    <>
                      <p className="legal-note">{t('worker.ackDisclaimer')}</p>
                      <button
                        type="button"
                        disabled={rowState === 'saving'}
                        aria-busy={rowState === 'saving' || undefined}
                        onClick={() => void acknowledge(p.closeId)}
                      >
                        {t('worker.acknowledge')}
                      </button>
                    </>
                  ) : (
                    <p>
                      {t('worker.acknowledged')}{' '}
                      <time dateTime={toIsoAttribute(p.acknowledgedAt) ?? undefined}>
                        {formatDateTime(p.acknowledgedAt) ?? p.acknowledgedAt}
                      </time>
                    </p>
                  )}
                  <WriteNotice
                    state={rowState}
                    savedText={t('worker.saved')}
                    onRetry={() => void acknowledge(p.closeId)}
                  />
                </article>
              );
            })
          )}
        </section>
      )}
      {tab === 'vacation' && (
        <section>
          <h2>{t('worker.vacation')}</h2>
          <p>
            {data.leave.availableBalance === null
              ? t('worker.balanceUnavailable')
              : `${data.leave.availableBalance}`}
          </p>
          <p>
            {t('worker.used')}: {data.leave.used} · {t('worker.planned')}: {data.leave.planned}
          </p>
        </section>
      )}
      {tab === 'documents' && (
        <section>
          <h2>{t('worker.documents')}</h2>
          {data.documents.length ? (
            data.documents.map((d) => (
              <article className="worker-card" key={d.id}>
                {d.document_type}
                <button
                  onClick={async () => {
                    const link = await apiRequest<{ url: string }>(
                      `/worker/documents/${d.id}/download`,
                    );
                    window.location.assign(link.url);
                  }}
                >
                  {t('worker.download')}
                </button>
              </article>
            ))
          ) : (
            <p>{t('worker.noDocuments')}</p>
          )}
        </section>
      )}
      {tab === 'requests' && (
        <section>
          <h2>{t('worker.requests')}</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitRequest();
            }}
          >
            <label>
              {t('worker.requestMessage')}
              <textarea
                required
                maxLength={1000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={requestState === 'saving'}
              aria-busy={requestState === 'saving' || undefined}
            >
              {t('worker.submitRequest')}
            </button>
            <WriteNotice
              state={requestState}
              savedText={t('worker.requestSent')}
              onRetry={() => void submitRequest()}
            />
          </form>
          {data.requests.map((r) => (
            <article className="worker-card" key={r.id}>
              <strong>{r.request_type}</strong>
              <p className="thread-author">{t('worker.sentByYou')}</p>
              <p>{r.message}</p>
              <small>{r.status}</small>
              <small className="record-timestamp">
                {toIsoAttribute(r.created_at) ? (
                  <>
                    {t('worker.sentAt')}{' '}
                    <time dateTime={toIsoAttribute(r.created_at) ?? undefined}>
                      {formatDateTime(r.created_at)}
                    </time>
                  </>
                ) : null}
                {/* Only worth showing when the status actually moved after the
                    request was filed - that is the reply the worker waits for. */}
                {toIsoAttribute(r.updated_at) && r.updated_at !== r.created_at ? (
                  <>
                    {' · '}
                    {t('worker.answeredAt')}{' '}
                    <time dateTime={toIsoAttribute(r.updated_at) ?? undefined}>
                      {formatDateTime(r.updated_at)}
                    </time>
                  </>
                ) : null}
              </small>
            </article>
          ))}
        </section>
      )}
      {tab === 'profile' && (
        <section>
          <h2>{t('worker.preferences')}</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void savePreferences();
            }}
          >
            <label>
              {t('worker.language')}
              <select
                value={locale}
                onChange={(event) => {
                  setLocale(event.target.value as WorkerLocale);
                  // A new choice is a new save, not a repeat of the last one.
                  setPrefsState('idle');
                }}
              >
                <option value="he">עברית</option>
                <option value="en">English</option>
              </select>
            </label>
            <p>{t('worker.emailAvailable')}</p>
            <button
              type="submit"
              disabled={prefsState === 'saving'}
              aria-busy={prefsState === 'saving' || undefined}
            >
              {t('worker.savePreferences')}
            </button>
            <WriteNotice
              state={prefsState}
              savedText={t('worker.saved')}
              onRetry={() => void savePreferences()}
            />
          </form>
          <p>{t('worker.phoneUnavailable')}</p>
        </section>
      )}
    </main>
  );
}
