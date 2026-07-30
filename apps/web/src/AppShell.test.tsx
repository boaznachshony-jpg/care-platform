import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
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
});
