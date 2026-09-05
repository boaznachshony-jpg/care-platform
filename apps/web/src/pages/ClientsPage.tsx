/* eslint-disable no-restricted-syntax */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/auth-context.js';
import { SignOutButton } from '../components/SignOutButton.js';
import { formatDateOnly } from '../format-timestamp.js';
import { clientPath } from '../hooks/use-client-path.js';
import {
  captureMvpWorkspace,
  createMvpClient,
  consumeMvpMigrationRedirect,
  deleteMvpClient,
  exportMvpClient,
  isNewEmployerLabel,
  MVP_PROFILE_CHANGED,
  readMvpClients,
  replaceMvpWorkspace,
  resetMvpClient,
  type MvpClient,
  type MvpWorkspaceSnapshot,
} from '../storage/mvp-storage.js';
import { RELEASE_LABEL } from '../release.js';

/** How long "בטל מחיקה" stays available after an employer is deleted. */
export const CLIENT_DELETE_UNDO_MS = 10_000;

interface PendingUndo {
  label: string;
  /** The whole workspace as it was the instant before the delete. */
  previous: MvpWorkspaceSnapshot;
}

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
  const [pendingUndo, setPendingUndo] = useState<PendingUndo | null>(null);
  const undoTimerRef = useRef<number | undefined>(undefined);

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

  // UI-NAV-01: this list is read once on mount. When the page mounts against
  // an empty device cache and hydration fills it a moment later, the cards
  // must appear without a reload.
  useEffect(() => {
    const refresh = () => setClients(readMvpClients());
    window.addEventListener(MVP_PROFILE_CHANGED, refresh);
    return () => window.removeEventListener(MVP_PROFILE_CHANGED, refresh);
  }, []);

  useEffect(
    () => () => {
      if (undoTimerRef.current !== undefined) window.clearTimeout(undoTimerRef.current);
    },
    [],
  );

  function addClient() {
    const client = createMvpClient();
    navigate(clientPath(client.id, '/onboarding'));
  }

  function removeClient(client: MvpClient) {
    // UI-WRITE-05: the old text said "local data". The delete is pushed to
    // the family workspace within a quarter of a second and reaches every
    // device, so the confirmation says so - twice - and an undo follows.
    if (
      !window.confirm(
        `למחוק את תיק ההעסקה “${client.label}”?\n\nהמחיקה תישמר בענן ותימחק מכל המכשירים של המשפחה, לא רק מהמכשיר הזה.`,
      )
    )
      return;
    if (
      !window.confirm(
        `אישור אחרון: למחוק לצמיתות את “${client.label}” ואת כל המשימות, המסמכים ורשומות השכר שלו מכל המכשירים?`,
      )
    )
      return;
    const capture = captureMvpWorkspace();
    const previous: MvpWorkspaceSnapshot = {
      schemaVersion: capture.schemaVersion,
      entries: capture.entries,
    };
    deleteMvpClient(client.id);
    setClients(readMvpClients());
    if (undoTimerRef.current !== undefined) window.clearTimeout(undoTimerRef.current);
    setPendingUndo({ label: client.label, previous });
    undoTimerRef.current = window.setTimeout(() => {
      undoTimerRef.current = undefined;
      setPendingUndo(null);
    }, CLIENT_DELETE_UNDO_MS);
  }

  function undoRemove() {
    if (!pendingUndo) return;
    if (undoTimerRef.current !== undefined) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = undefined;
    // Restore-and-resave: the workspace is put back exactly as captured, and
    // the sync layer saves that as the next version. If the delete already
    // reached the server, the server keeps it in the version history.
    replaceMvpWorkspace(pendingUndo.previous);
    setClients(readMvpClients());
    setPendingUndo(null);
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
          {auth.enabled ? <SignOutButton /> : null}
          <button className="primary-button clients-add-button" type="button" onClick={addClient}>
            ＋ {t('clients.add')}
          </button>
        </div>
      </header>

      {pendingUndo ? (
        <aside className="info-box" role="status">
          <span>
            תיק ההעסקה “{pendingUndo.label}” נמחק
            {auth.enabled ? ' ונשלח לענן, ומכל המכשירים' : ''}.
          </span>
          <button className="secondary-button" type="button" onClick={undoRemove}>
            בטל מחיקה
          </button>
        </aside>
      ) : null}

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
                  {/* Through the shared formatter, not toLocaleDateString: this
                      is the one place a card showed a date in the reader's own
                      time zone while every other stamp showed Israel time. */}
                  <dd>{formatDateOnly(client.updatedAt) ?? '—'}</dd>
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
        {/* WEB-17: "גיבוי" writes every decrypted business key to a plain JSON
            download — Israeli ID numbers, passport numbers, medications and
            payroll history in clear text. The user was given no indication of
            that before choosing where to put the file. */}
        <span className="local-data-warning">{t('clients.backupPlaintextWarning')}</span>
      </aside>
    </main>
  );
}
