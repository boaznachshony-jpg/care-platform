/* eslint-disable no-restricted-syntax */
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

export interface AppShellProps {
  children: ReactNode;
}

const nav = [
  ['/', '⌂', 'ראשי'],
  ['/tasks', '✓', 'משימות'],
  ['/employee', '♙', 'עובד'],
  ['/documents', '▣', 'מסמכים'],
  ['/timeline', '◷', 'ציר זמן'],
  ['/payroll', '₪', 'שכר'],
] as const;

export function AppShell({ children }: AppShellProps) {
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
            <button aria-label="התראות">🔔</button>
            <div className="avatar">ב</div>
          </div>
        </header>
        <main id="main-content" className="main-content">
          {children}
        </main>
        <nav className="mobile-nav" aria-label="ניווט תחתון">
          {nav.slice(0, 5).map(([to, icon, label]) => (
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
