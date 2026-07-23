import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';

export interface AppShellProps {
  children: ReactNode;
}

/**
 * Purpose: RTL document shell with skip link, header, nav placeholder, and one main landmark
 *   (design-system-and-component-catalog.md §6 AppShell).
 * Accessibility: a skip link that becomes visible on focus lets keyboard users bypass the nav; <main>
 *   is the single landmark content lives in.
 * RTL: relies on the <html dir="rtl"> set in index.html — no directional CSS of its own to fight.
 */
export function AppShell({ children }: AppShellProps) {
  const { t } = useTranslation();

  return (
    <>
      <a href="#main-content" className="cd-skip-link">
        {t('shell.skipToContent')}
      </a>
      <header>
        <p>{t('app.name')}</p>
      </header>
      <nav aria-label={t('shell.primaryNavigation')}>
        <NavLink to="/">{t('nav.dashboard')}</NavLink>{' '}
        <NavLink to="/cases/new">{t('nav.openCase')}</NavLink>
      </nav>
      <main id="main-content">{children}</main>
    </>
  );
}
