import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { saveMvpTasks } from './storage/mvp-storage.js';
import { AppShell } from './AppShell.js';

function renderShell() {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <MemoryRouter>
        <AppShell>
          <p>תוכן בדיקה</p>
        </AppShell>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('AppShell text size controls', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.removeProperty('--ui-scale');
    document.documentElement.removeAttribute('data-theme');
  });

  it('enlarges the entire interface and persists the selected size', () => {
    render(
      <MemoryRouter>
        <AppShell>
          <p>תוכן בדיקה</p>
        </AppShell>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'הגדלת טקסט' }));
    expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1.15');
    expect(localStorage.getItem('caredesk.ui.font-scale.v1')).toBe('1.15');

    fireEvent.click(screen.getByRole('button', { name: 'הגדלת טקסט' }));
    expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1.3');
    expect(screen.getByRole('button', { name: 'הגדלת טקסט' })).toBeDisabled();
  });

  it('links the notification bell to the list of open tasks', () => {
    saveMvpTasks([
      {
        id: 'due-task',
        title: 'תשלום שכר חודשי',
        dueDate: new Date().toISOString().slice(0, 10),
        priority: 'important',
        status: 'open',
        createdAt: new Date().toISOString(),
      },
    ]);

    render(
      <MemoryRouter>
        <AppShell>
          <p>תוכן בדיקה</p>
        </AppShell>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('link', {
        name: /מעבר למשימות פתוחות, \d+ נושאים לטיפול/,
      }),
    ).toHaveAttribute('href', '/tasks');
  });

  it('always provides a clear route back to the public landing page', () => {
    render(
      <MemoryRouter>
        <AppShell>
          <p>תוכן בדיקה</p>
        </AppShell>
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'CareDesk — חזרה לדף הנחיתה' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(screen.getAllByRole('link', { name: /חזרה לדף הנחיתה/ })).toHaveLength(2);
  });

  it('shows the saved employer name and the current date instead of demo text', () => {
    localStorage.setItem(
      'caredesk.mvp.profile.v1',
      JSON.stringify({
        employerName: 'מעסיק אמיתי',
        onboardingCompleted: true,
      }),
    );

    render(
      <MemoryRouter>
        <AppShell>
          <p>תוכן בדיקה</p>
        </AppShell>
      </MemoryRouter>,
    );

    expect(screen.getByText('שלום מעסיק אמיתי')).toBeVisible();
    expect(screen.queryByText('יום שלישי, 28 ביולי')).not.toBeInTheDocument();
  });
});

describe('AppShell theme toggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('applies the dark theme on the document root and persists the choice', () => {
    renderShell();

    const toggle = screen.getByRole('button', { name: 'מעבר בין תצוגה בהירה לכהה' });
    fireEvent.click(toggle);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('caredesk.ui.theme')).toBe('dark');

    fireEvent.click(toggle);
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    expect(localStorage.getItem('caredesk.ui.theme')).toBe('light');
  });

  it('restores a previously saved dark theme on load and defaults to light otherwise', () => {
    localStorage.setItem('caredesk.ui.theme', 'dark');
    const { unmount } = renderShell();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    unmount();

    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    renderShell();
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });
});
