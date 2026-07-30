/* eslint-disable no-restricted-syntax */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useMvpProfile } from './hooks/use-mvp-profile.js';
import { createCareNotifications } from './notifications.js';
import {
  readMvpDocuments,
  readMvpEmploymentExpenses,
  readMvpTasks,
} from './storage/mvp-storage.js';

export interface AppShellProps {
  children: ReactNode;
}

const nav = [
  ['/', '⌂', 'ראשי'],
  ['/tasks', '✓', 'משימות'],
  ['/employee', '♙', 'עובד'],
  ['/trust', '♥', 'אמון'],
  ['/documents', '▣', 'מסמכים'],
  ['/timeline', '◷', 'ציר זמן'],
  ['/payroll', '₪', 'שכר'],
] as const;

const mobileNav = [
  ['/', '⌂', 'בית'],
  ['/tasks', '✓', 'משימות'],
  ['/payroll', '₪', 'שכר'],
  ['/documents', '▣', 'מסמכים'],
  ['/settings', '•••', 'עוד'],
] as const;

const FONT_SCALE_KEY = 'caredesk.ui.font-scale.v1';
const fontScales = [1, 1.15, 1.3] as const;

function readFontScale(): number {
  const saved = Number(window.localStorage.getItem(FONT_SCALE_KEY));
  return fontScales.includes(saved as (typeof fontScales)[number]) ? saved : 1;
}

export function AppShell({ children }: AppShellProps) {
  const [profile] = useMvpProfile();
  const [fontScale, setFontScale] = useState(readFontScale);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
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
            <small>ניהול העסקה ישירה</small>
          </div>
        </div>
        <nav className="desktop-nav">
          {nav.map(([to, icon, label]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              <span>{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-help">
          <strong>הכול בשליטה</strong>
          <span>המערכת מסכמת עבורך מה דורש טיפול.</span>
        </div>
        <NavLink className="settings-link" to="/settings">
          ⚙ הגדרות
        </NavLink>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <div>
            <strong>שלום בועז</strong>
            <span>יום שלישי, 28 ביולי</span>
          </div>
          <div className="top-actions">
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
              <button
                className={
                  notifications.length > 0 ? 'notification-bell active' : 'notification-bell'
                }
                type="button"
                aria-label={
                  notifications.length > 0
                    ? `התראות, ${notifications.length} נושאים לטיפול`
                    : 'התראות, אין נושאים לטיפול'
                }
                aria-expanded={notificationsOpen}
                aria-controls="notification-panel"
                onClick={() => setNotificationsOpen((open) => !open)}
              >
                <span aria-hidden="true">🔔</span>
                {notifications.length > 0 ? (
                  <strong className="notification-count">{notifications.length}</strong>
                ) : null}
              </button>
              {notificationsOpen ? (
                <section
                  id="notification-panel"
                  className="notification-panel"
                  aria-label="נושאים לטיפול"
                >
                  <div className="notification-panel-header">
                    <div>
                      <strong>נושאים לטיפול</strong>
                      <small>
                        {notifications.length > 0
                          ? `${notifications.length} פריטים לפי הגדרת התזכורת`
                          : 'אין כרגע נושאים דחופים'}
                      </small>
                    </div>
                    <button
                      type="button"
                      aria-label="סגירת ההתראות"
                      onClick={() => setNotificationsOpen(false)}
                    >
                      ×
                    </button>
                  </div>
                  {notifications.length > 0 ? (
                    <div className="notification-list">
                      {notifications.map((notification) => (
                        <Link
                          className={`notification-item ${notification.severity}`}
                          to={notification.to}
                          key={notification.id}
                          onClick={() => setNotificationsOpen(false)}
                        >
                          <span className="notification-dot" aria-hidden="true" />
                          <span>
                            <strong>{notification.title}</strong>
                            <small>{notification.detail}</small>
                          </span>
                          <span aria-hidden="true">←</span>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p className="notification-empty">
                      המערכת לא מצאה משימות, מסמכים או תשלומים הדורשים טיפול בטווח שנבחר.
                    </p>
                  )}
                  <Link
                    className="notification-settings-link"
                    to="/settings"
                    onClick={() => setNotificationsOpen(false)}
                  >
                    הגדרות התראות
                  </Link>
                </section>
              ) : null}
            </div>
            <div className="avatar">ב</div>
          </div>
        </header>
        <main id="main-content" className="main-content">
          {children}
        </main>
        <nav className="mobile-nav" aria-label="ניווט תחתון">
          {mobileNav.map(([to, icon, label]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              <span>{icon}</span>
              <small>{label}</small>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
