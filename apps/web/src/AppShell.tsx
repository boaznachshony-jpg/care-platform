/* eslint-disable no-restricted-syntax */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMvpProfile } from './hooks/use-mvp-profile.js';
import { createCareNotifications } from './notifications.js';
import { useClientPath } from './hooks/use-client-path.js';
import {
  readMvpDocuments,
  readMvpEmploymentExpenses,
  readMvpTasks,
} from './storage/mvp-storage.js';
import { RELEASE_LABEL } from './release.js';
import { useAuth } from './auth/auth-context.js';
import {
  getWorkspaceSyncState,
  retryWorkspaceSync,
  WORKSPACE_SYNC_CHANGED,
  type WorkspaceSyncState,
} from './storage/workspace-sync.js';

export interface AppShellProps {
  children: ReactNode;
}

const nav = [
  ['/', '⌂', 'ראשי'],
  ['/tasks', '✓', 'משימות'],
  ['/employee', '♙', 'עובד'],
  ['/trust', '♥', 'טיפים'],
  ['/glossary', 'ⓘ', 'מושגים'],
  ['/documents', '▣', 'מסמכים'],
  ['/timeline', '◷', 'ציר זמן'],
  ['/payroll', '₪', 'שכר'],
  ['/contact', '✉', 'עזרה'],
] as const;

const mobileNav = [
  ['/', '⌂', 'בית'],
  ['/tasks', '✓', 'משימות'],
  ['/payroll', '₪', 'שכר'],
  ['/documents', '▣', 'מסמכים'],
] as const;

const mobileMoreNav = [
  ['/employee', '♙', 'פרטי המטפל'],
  ['/trust', '♥', 'מסרים לבניית אמון'],
  ['/glossary', 'ⓘ', 'מושגים חשובים'],
  ['/timeline', '◷', 'ציר זמן'],
  ['/settings', '⚙', 'הגדרות'],
  ['/contact', '✉', 'עזרה ויצירת קשר'],
] as const;

const FONT_SCALE_KEY = 'caredesk.ui.font-scale.v1';
const fontScales = [1, 1.15, 1.3] as const;

function readFontScale(): number {
  const saved = Number(window.localStorage.getItem(FONT_SCALE_KEY));
  return fontScales.includes(saved as (typeof fontScales)[number]) ? saved : 1;
}

function currentHebrewDate(): string {
  return new Intl.DateTimeFormat('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
}

export function AppShell({ children }: AppShellProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const path = useClientPath();
  const auth = useAuth();
  const [profile] = useMvpProfile();
  const [fontScale, setFontScale] = useState(readFontScale);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [syncState, setSyncState] = useState<WorkspaceSyncState>(getWorkspaceSyncState);
  const notifications = profile.notificationsEnabled
    ? createCareNotifications({
        tasks: readMvpTasks(),
        documents: readMvpDocuments(),
        expenses: readMvpEmploymentExpenses(),
        reminderLeadDays: profile.reminderLeadDays,
      })
    : [];

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(fontScale));
    window.localStorage.setItem(FONT_SCALE_KEY, String(fontScale));
  }, [fontScale]);

  useEffect(() => {
    const update = () => setSyncState(getWorkspaceSyncState());
    window.addEventListener(WORKSPACE_SYNC_CHANGED, update);
    return () => window.removeEventListener(WORKSPACE_SYNC_CHANGED, update);
  }, []);

  return (
    <div className="app-frame">
      <a href="#main-content" className="cd-skip-link">
        דלג לתוכן
      </a>
      <aside className="sidebar" aria-label="ניווט ראשי">
        <div className="brand">
          <span className="brand-mark">C</span>
          <div>
            <strong>CareDesk</strong>
            <small>{RELEASE_LABEL}</small>
            <small>ניהול העסקה ישירה</small>
          </div>
        </div>
        <nav className="desktop-nav">
          {nav.map(([to, icon, label]) => (
            <NavLink key={to} to={path(to)} end={to === '/'}>
              <span>{icon}</span>
              {label}
            </NavLink>
          ))}
          <NavLink to={path('/reports')}>
            <span aria-hidden="true">▤</span>
            {t('reports.nav')}
          </NavLink>
        </nav>
        <div className="sidebar-help">
          <strong>הכול בשליטה</strong>
          <span>המערכת מסכמת עבורך מה דורש טיפול.</span>
        </div>
        <NavLink className="settings-link" to={path('/settings')}>
          ⚙ הגדרות
        </NavLink>
        <NavLink className="settings-link client-switch-link" to="/app">
          ⇄ החלפת מעסיק
        </NavLink>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <div>
            <strong>שלום {profile.employerName || 'וברוכים הבאים'}</strong>
            <span>{currentHebrewDate()}</span>
          </div>
          <div className="top-actions">
            {auth.enabled && syncState === 'error' ? (
              <span className="sync-status sync-status-error" role="alert">
                השמירה בענן נכשלה
                <button
                  className="sync-retry-button"
                  type="button"
                  onClick={() => void retryWorkspaceSync()}
                >
                  נסו שוב
                </button>
              </span>
            ) : auth.enabled && syncState !== 'disabled' ? (
              <span className={`sync-status sync-status-${syncState}`} role="status">
                {syncState === 'saving' ? 'שומר…' : syncState === 'loading' ? 'טוען…' : 'נשמר בענן'}
              </span>
            ) : null}
            {auth.enabled ? (
              <button className="sign-out-button" type="button" onClick={() => void auth.signOut()}>
                {t('auth.signOut')}
              </button>
            ) : null}
            <Link className="top-client-switch" to="/app" aria-label="החלפת מעסיק">
              ⇄
            </Link>
            <div className="font-size-controls" role="group" aria-label="גודל טקסט">
              <button
                type="button"
                aria-label="הקטנת טקסט"
                disabled={fontScale === fontScales[0]}
                onClick={() =>
                  setFontScale(
                    (current) =>
                      fontScales[Math.max(0, fontScales.indexOf(current as 1 | 1.15 | 1.3) - 1)] ??
                      current,
                  )
                }
              >
                א−
              </button>
              <button
                type="button"
                aria-label="הגדלת טקסט"
                disabled={fontScale === fontScales[fontScales.length - 1]}
                onClick={() =>
                  setFontScale(
                    (current) =>
                      fontScales[
                        Math.min(
                          fontScales.length - 1,
                          fontScales.indexOf(current as 1 | 1.15 | 1.3) + 1,
                        )
                      ] ?? current,
                  )
                }
              >
                א+
              </button>
            </div>
            <div className="notification-center">
              <Link
                className={
                  notifications.length > 0 ? 'notification-bell active' : 'notification-bell'
                }
                to={path('/tasks')}
                aria-label={
                  notifications.length > 0
                    ? `מעבר למשימות פתוחות, ${notifications.length} נושאים לטיפול`
                    : 'מעבר למשימות פתוחות'
                }
              >
                <span aria-hidden="true">🔔</span>
                {notifications.length > 0 ? (
                  <strong className="notification-count">{notifications.length}</strong>
                ) : null}
              </Link>
            </div>
            <div className="avatar">ב</div>
          </div>
        </header>
        <main id="main-content" className="main-content">
          {children}
        </main>
        <nav className="mobile-nav" aria-label="ניווט תחתון">
          {mobileNav.map(([to, icon, label]) => (
            <NavLink
              key={to}
              to={path(to)}
              end={to === '/'}
              onClick={() => setMobileMoreOpen(false)}
            >
              <span>{icon}</span>
              <small>{label}</small>
            </NavLink>
          ))}
          <button
            className={mobileMoreNav.some(([to]) => path(to) === location.pathname) ? 'active' : ''}
            type="button"
            aria-expanded={mobileMoreOpen}
            aria-controls="mobile-more-menu"
            onClick={() => setMobileMoreOpen((open) => !open)}
          >
            <span aria-hidden="true">•••</span>
            <small>עוד</small>
          </button>
        </nav>
        {mobileMoreOpen ? (
          <nav id="mobile-more-menu" className="mobile-more-menu" aria-label="ניווט נוסף">
            <NavLink to={path('/reports')} onClick={() => setMobileMoreOpen(false)}>
              <span aria-hidden="true">▤</span>
              {t('reports.nav')}
            </NavLink>
            {mobileMoreNav.map(([to, icon, label]) => (
              <NavLink key={to} to={path(to)} onClick={() => setMobileMoreOpen(false)}>
                <span aria-hidden="true">{icon}</span>
                {label}
              </NavLink>
            ))}
            <Link to="/app" onClick={() => setMobileMoreOpen(false)}>
              <span aria-hidden="true">⇄</span>
              החלפת מעסיק
            </Link>
            {auth.enabled ? (
              <button
                className="mobile-more-sign-out"
                type="button"
                onClick={() => {
                  setMobileMoreOpen(false);
                  void auth.signOut();
                }}
              >
                <span aria-hidden="true">↪</span>
                {t('auth.signOut')}
              </button>
            ) : null}
          </nav>
        ) : null}
      </div>
    </div>
  );
}
