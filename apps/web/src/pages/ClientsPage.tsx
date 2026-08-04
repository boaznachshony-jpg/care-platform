/* eslint-disable no-restricted-syntax */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/auth-context.js';
import { clientPath } from '../hooks/use-client-path.js';
import {
  createMvpClient,
  consumeMvpMigrationRedirect,
  deleteMvpClient,
  exportMvpClient,
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
  const [clients, setClients] = useState(readMvpClients);
  const [migrationRedirect] = useState(consumeMvpMigrationRedirect);

  useEffect(() => {
    if (migrationRedirect) navigate(clientPath(migrationRedirect, '/'), { replace: true });
  }, [migrationRedirect, navigate]);

  function addClient() {
    const client = createMvpClient();
    navigate(clientPath(client.id, '/onboarding'));
  }

  function removeClient(client: MvpClient) {
    if (!window.confirm(`למחוק את הרשומה של “${client.label}” ואת כל הנתונים המקומיים שלה?`))
      return;
    deleteMvpClient(client.id);
    setClients(readMvpClients());
  }

  function resetClient(client: MvpClient) {
    if (!window.confirm(`לאפס את “${client.label}” ולהתחיל מחדש? הפעולה אינה ניתנת לביטול.`))
      return;
    resetMvpClient(client.id);
    setClients(readMvpClients());
    navigate(clientPath(client.id, '/onboarding'));
  }

  return (
    <main className="clients-landing" id="main-content">
      <header className="clients-hero">
        <div className="brand clients-brand">
          <span className="brand-mark">C</span>
          <div>
            <strong>CareDesk</strong>
            <small>{RELEASE_LABEL}</small>
            <small>ניהול העסקה ישירה, פשוט ובטוח</small>
          </div>
        </div>
        <div>
          <p className="eyebrow">סביבת ייצור סגורה לתרגול</p>
          <h1>הלקוחות שלי</h1>
          <p>
            {auth.enabled
              ? 'כל לקוח נשמר בנפרד בחשבון ומסתנכרן בין המכשירים המורשים.'
              : 'כל לקוח נשמר בנפרד ורק בדפדפן הזה. בחרו רשומה קיימת או התחילו חדשה.'}
          </p>
        </div>
        <div className="clients-hero-actions">
          <button className="secondary-button" type="button" onClick={() => navigate('/family')}>
            👥 {t('familyAccess.eyebrow')}
          </button>
          {auth.enabled ? (
            <button className="sign-out-button" type="button" onClick={() => void auth.signOut()}>
              {t('auth.signOut')}
            </button>
          ) : null}
          <button className="primary-button clients-add-button" type="button" onClick={addClient}>
            ＋ הוספת לקוח חדש
          </button>
        </div>
      </header>

      {clients.length === 0 ? (
        <section className="clients-empty card">
          <span aria-hidden="true">◎</span>
          <h2>עדיין אין לקוחות</h2>
          <p>הוסיפו לקוח ראשון והשלימו את פרטי המעסיק, המטופל והמטפל/ת.</p>
          <button className="primary-button" type="button" onClick={addClient}>
            התחלת לקוח ראשון
          </button>
        </section>
      ) : (
        <section className="clients-grid" aria-label="רשימת לקוחות">
          {clients.map((client) => (
            <article className="client-card" key={client.id}>
              <div className="client-card-heading">
                <span className="client-avatar" aria-hidden="true">
                  {(client.label || 'ל').slice(0, 1)}
                </span>
                <div>
                  <h2>{client.label}</h2>
                  <p>
                    {client.caregiverName ? `מטפל/ת: ${client.caregiverName}` : 'ההקמה טרם הושלמה'}
                  </p>
                </div>
              </div>
              <dl>
                <div>
                  <dt>מעסיק</dt>
                  <dd>{client.employerName || 'טרם הוזן'}</dd>
                </div>
                <div>
                  <dt>עודכן</dt>
                  <dd>{new Date(client.updatedAt).toLocaleDateString('he-IL')}</dd>
                </div>
              </dl>
              <div className="client-card-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() =>
                    navigate(
                      clientPath(client.id, client.label === 'לקוח חדש' ? '/onboarding' : '/'),
                    )
                  }
                >
                  פתיחת הרשומה
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => downloadClient(client)}
                >
                  ייצוא גיבוי
                </button>
                <details className="client-more-actions">
                  <summary>פעולות נוספות</summary>
                  <button type="button" onClick={() => resetClient(client)}>
                    איפוס הרשומה
                  </button>
                  <button
                    className="danger-text-button"
                    type="button"
                    onClick={() => removeClient(client)}
                  >
                    מחיקת הרשומה
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
