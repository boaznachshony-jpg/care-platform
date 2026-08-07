import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { initI18n } from '@caredesk/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  requestMagicLink: vi.fn(),
  requestPasswordReset: vi.fn(),
  updatePassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../auth/auth-context.js', () => ({
  useAuth: () => ({
    enabled: true,
    user: null,
    ...authMocks,
  }),
}));

import { AuthLoadingPage, LoginPage, validateRegistration } from './LoginPage.js';

function renderWithProviders(component: ReactNode) {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <MemoryRouter>{component}</MemoryRouter>
    </I18nextProvider>,
  );
}

describe('login progress', () => {
  beforeEach(() => {
    authMocks.signIn.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('explains the secure authentication delay and prevents duplicate submissions', async () => {
    vi.useFakeTimers();
    let finishSignIn: ((value: boolean) => void) | undefined;
    authMocks.signIn.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finishSignIn = resolve;
      }),
    );

    renderWithProviders(<LoginPage />);
    fireEvent.change(screen.getByLabelText('כתובת דוא״ל'), {
      target: { value: 'owner@example.test' },
    });
    fireEvent.change(screen.getByLabelText('סיסמה'), {
      target: { value: 'secure-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'כניסה למערכת' }));

    expect(authMocks.signIn).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /מתחברים בבטחה/ })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('מאמתים את פרטי הכניסה בחיבור מאובטח');
    expect(screen.getByRole('status')).toHaveTextContent('אין צורך ללחוץ שוב');

    fireEvent.click(screen.getByRole('button', { name: /מתחברים בבטחה/ }));
    expect(authMocks.signIn).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(3100);
    });
    expect(screen.getByRole('status')).toHaveTextContent('האימות נמשך מעט מהרגיל');

    await act(async () => {
      finishSignIn?.(false);
      await Promise.resolve();
    });
    expect(screen.getByRole('alert')).toHaveTextContent('פרטי הכניסה אינם תקינים');
    expect(screen.getByRole('button', { name: 'כניסה למערכת' })).toBeEnabled();
  });

  it('shows the protected workspace loading phase', () => {
    renderWithProviders(<AuthLoadingPage />);

    expect(screen.getByRole('status')).toHaveTextContent('טוענים את האזור האישי');
    expect(screen.getByRole('status')).toHaveTextContent('טוענים את התיק המאובטח שלכם');
    expect(screen.getByRole('status')).toHaveTextContent('אין צורך לרענן את הדף');
  });
});

describe('registration validation', () => {
  it('accepts an email username with matching secure passwords', () => {
    expect(
      validateRegistration('owner@example.test', 'a-secure-password', 'a-secure-password'),
    ).toBeNull();
  });

  it('rejects an invalid email address', () => {
    expect(validateRegistration('owner', 'a-secure-password', 'a-secure-password')).toBe('email');
  });

  it('requires at least 12 characters', () => {
    expect(validateRegistration('owner@example.test', 'short', 'short')).toBe('password');
  });

  it('requires the password confirmation to match', () => {
    expect(
      validateRegistration('owner@example.test', 'a-secure-password', 'another-password'),
    ).toBe('confirmation');
  });
});
