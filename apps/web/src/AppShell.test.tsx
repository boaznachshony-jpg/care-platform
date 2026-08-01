import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { saveMvpTasks } from './storage/mvp-storage.js';
import { AppShell } from './AppShell.js';

describe('AppShell text size controls', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.removeProperty('--ui-scale');
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
