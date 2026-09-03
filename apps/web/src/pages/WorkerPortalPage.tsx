import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

export function WorkerPortalPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<Portal | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState('home');
  const [message, setMessage] = useState('');
  const [locale, setLocale] = useState<'he' | 'en'>('he');
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
  const load = () =>
    apiRequest<Portal>('/worker/portal')
      .then(setData)
      .catch(() => setError(true));
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
          setLocale(prefs.preferred_locale);
        }
      })
      .catch(() => undefined);
  }, []);
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
            data.payments.map((p) => (
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
                      onClick={async () => {
                        await apiRequest(`/worker/payments/${p.closeId}/acknowledgements`, {
                          method: 'POST',
                        });
                        load();
                      }}
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
              </article>
            ))
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
            onSubmit={async (e) => {
              e.preventDefault();
              await apiRequest('/worker/requests', {
                method: 'POST',
                headers: { 'idempotency-key': newIdempotencyKey() },
                body: JSON.stringify({ type: 'general', message }),
              });
              setMessage('');
              load();
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
            <button>{t('worker.submitRequest')}</button>
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
            onSubmit={async (event) => {
              event.preventDefault();
              await apiRequest('/worker/preferences', {
                method: 'PUT',
                headers: { 'idempotency-key': newIdempotencyKey() },
                body: JSON.stringify({
                  locale,
                  channel: 'email',
                  // Echo the one consent state this portal is ever allowed to
                  // write: an explicit prior revoke. Anything else (unknown,
                  // granted, or a preference we failed to load) sends
                  // 'unknown' — read server-side as "this request has no
                  // opinion about consent" and never allowed to overwrite
                  // whatever is actually stored. See getWorkerPreferences and
                  // Wave5Service.updatePreference.
                  whatsappConsent:
                    preferences?.whatsapp_consent === 'revoked' ? 'revoked' : 'unknown',
                  smsConsent: preferences?.sms_consent === 'revoked' ? 'revoked' : 'unknown',
                }),
              });
            }}
          >
            <label>
              {t('worker.language')}
              <select
                value={locale}
                onChange={(event) => setLocale(event.target.value as 'he' | 'en')}
              >
                <option value="he">עברית</option>
                <option value="en">English</option>
              </select>
            </label>
            <p>{t('worker.emailAvailable')}</p>
            <button>{t('worker.savePreferences')}</button>
          </form>
          <p>{t('worker.phoneUnavailable')}</p>
        </section>
      )}
    </main>
  );
}
