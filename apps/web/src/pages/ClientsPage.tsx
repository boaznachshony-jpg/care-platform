/* eslint-disable no-restricted-syntax */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/auth-context.js';
import { clientPath } from '../hooks/use-client-path.js';
import {
  createMvpClient,
  consumeMvpMigrationRedirect,
  deleteMvpClient,
  exportMvpClient,
  isNewEmployerLabel,
  readMvpClients,
  resetMvpClient,
  type MvpClient,
} from '../storage/mvp-storage.js';
import { RELEASE_LABEL } from '../release.js';

function downloadClient(client: MvpClient): void {
  const blob = new Blob([exportMvpClient(client.id)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `caredesk-${client.label.replace(/[^\p{L}\p{N}-]+/gu, '-') || client.id}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ClientsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const auth = useAuth();
  const [searchParams] = useSearchParams();
  const [clients, setClients] = useState(readMvpClients);
  const [migrationRedirect] = useState(consumeMvpMigrationRedirect);

  useEffect(() => {
    if (migrationRedirect) navigate(clientPath(migrationRedirect, '/'), { replace: true });
  }, [migrationRedirect, navigate]);

  useEffect(() => {
    if (migrationRedirect || searchParams.get('firstRun') !== '1') return;
    if (clients.length > 0) {
      navigate('/app', { replace: true });
      return;
    }
    const client = createMvpClient();
    navigate(clientPath(client.id, '/onboarding'), { replace: true });
  }, [clients.length, migrationRedirect, navigate, searchParams]);

  function addClient() {
    const client = createMvpClient();
    navigate(clientPath(client.id, '/onboarding'));
  }

  function removeClient(client: MvpClient) {
    if (!window.confirm(`למחוק את תיק ההעסקה “${client.label}” ואת כל הנתונים המקומיים שלו?`))
      return;
    deleteMvpClient(client.id);
    setClients(readMvpClients());
  }

  function resetClient(client: MvpClient) {
    if (!window.confirm(`להתחיל מחדש את “${client.label}”? הפעולה אינה ניתנת לביטול.`)) return;
    resetMvpClient(client.id);
    setClients(readMvpClients());
    navigate(clientPath(client.id, '/onboarding'));
  }

  return (
    <main className="clients-landing" id="main-content">
      <header className="clients-hero">
        <Link
          className="brand clients-brand brand-home-link"
          to="/"
          aria-label="CareDesk — חזרה לדף הנחיתה"
        >
          <span className="brand-mark">C</span>
          <div>
            <strong>CareDesk</strong>
            <small>{RELEASE_LABEL}</small>
            <small>ניהול העסקה ישירה, פשוט ובטוח</small>
          </div>
        </Link>
        <div>
          <p className="eyebrow">{t('clients.eyebrow')}</p>
          <h1>{t('clients.title')}</h1>
          <p>{auth.enabled ? t('clients.introCloud') : t('clients.introLocal')}</p>
        </div>
        <div className="clients-hero-actions">
          <Link className="secondary-button clients-home-link" to="/">
            ⌂ דף הנחיתה
          </Link>
          <button className="secondary-button" type="button" onClick={() => navigate('/family')}>
            👥 {t('familyAccess.eyebrow')}
          </button>
          {auth.enabled ? (
            <button className="sign-out-button" type="button" onClick={() => void auth.signOut()}>
              {t('auth.signOut')}
            </button>
          ) : null}
          <button className="primary-button clients-add-button" type="button" onClick={addClient}>
            ＋ {t('clients.add')}
          </button>
        </div>
      </header>

      {clients.length === 0 ? (
        <section className="clients-empty card">
          <span aria-hidden="true">◎</span>
          <h2>{t('clients.emptyTitle')}</h2>
          <p>{t('clients.emptyBody')}</p>
          <button className="primary-button" type="button" onClick={addClient}>
            {t('clients.first')}
          </button>
        </section>
      ) : (
        <section className="clients-grid" aria-label={t('clients.listLabel')}>
          {clients.map((client) => (
            <article className="client-card" key={client.id}>
              <div className="client-card-heading">
                <span className="client-avatar" aria-hidden="true">
                  {(isNewEmployerLabel(client.label)
                    ? t('clients.newCase')
                    : client.label || 'ת'
                  ).slice(0, 1)}
                </span>
                <div>
                  <h2>{isNewEmployerLabel(client.label) ? t('clients.newCase') : client.label}</h2>
                  <p>
                    {client.caregiverName
                      ? t('clients.caregiver', { name: client.caregiverName })
                      : t('clients.setupPending')}
                  </p>
                </div>
              </div>
              <dl>
                <div>
                  <dt>{t('clients.employer')}</dt>
                  <dd>{client.employerName || 'טרם הוזן'}</dd>
                </div>
                <div>
                  <dt>{t('clients.updated')}</dt>
                  <dd>{new Date(client.updatedAt).toLocaleDateString('he-IL')}</dd>
                </div>
              </dl>
              <div className="client-card-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() =>
                    navigate(
                      clientPath(client.id, isNewEmployerLabel(client.label) ? '/onboarding' : '/'),
                    )
                  }
                >
                  {t('clients.open')}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => downloadClient(client)}
                >
                  {t('clients.backup')}
                </button>
                <details className="client-more-actions">
                  <summary>{t('clients.more')}</summary>
                  <button type="button" onClick={() => resetClient(client)}>
                    {t('clients.reset')}
                  </button>
                  <button
                    className="danger-text-button"
                    type="button"
                    onClick={() => removeClient(client)}
                  >
                    {t('clients.delete')}
                  </button>
                </details>
              </div>
            </article>
          ))}
        </section>
      )}
      <aside className="local-data-notice">
        {auth.enabled ? (
          <>
            <strong>המידע נשמר בחשבון המאובטח ומסתנכרן לענן</strong>
            <span>נשמר גם עותק עבודה מקומי. אפשר להוריד גיבוי אישי בכל עת.</span>
          </>
        ) : (
          <>
            <strong>המידע נשמר במכשיר זה בלבד</strong>
            <span>מומלץ להוריד גיבוי לפני ניקוי נתוני הדפדפן או מעבר למכשיר אחר.</span>
          </>
        )}
      </aside>
    </main>
  );
}
