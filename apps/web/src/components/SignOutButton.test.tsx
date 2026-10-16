import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
}));

vi.mock('../auth/auth-context.js', () => ({
  useAuth: () => ({ enabled: true, signOut: mocks.signOut }),
}));

import { SignOutButton } from './SignOutButton.js';

function renderButton(props: Parameters<typeof SignOutButton>[0] = {}) {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <SignOutButton {...props} />
    </I18nextProvider>,
  );
}

/**
 * SEC-WEB-01. Five screens each rendered their own `void auth.signOut()`, and
 * every one of them threw the result away. This is the one control that does
 * not.
 */
describe('SignOutButton', () => {
  beforeEach(() => {
    mocks.signOut.mockReset();
  });

  it('signs out quietly when nothing is pending', async () => {
    mocks.signOut.mockResolvedValue('ok');
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'יציאה' }));

    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledWith({ discardUnsaved: false }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the refusal with retry and discard when edits are unsaved', async () => {
    mocks.signOut.mockResolvedValue('unsaved-changes');
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'יציאה' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'יש שינויים שעוד לא נשמרו בענן, ולכן היציאה נעצרה.',
    );
    expect(screen.getByRole('button', { name: 'נסו שוב' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'צאו בכל זאת — שינויים שלא נשמרו יאבדו' }),
    ).toBeInTheDocument();
  });

  it('retries the save on "try again" and only discards when told to', async () => {
    mocks.signOut.mockResolvedValue('unsaved-changes');
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'יציאה' }));
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: 'נסו שוב' }));
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(2));
    expect(mocks.signOut).toHaveBeenLastCalledWith({ discardUnsaved: false });

    mocks.signOut.mockResolvedValue('ok');
    fireEvent.click(screen.getByRole('button', { name: 'צאו בכל זאת — שינויים שלא נשמרו יאבדו' }));
    await waitFor(() => expect(mocks.signOut).toHaveBeenLastCalledWith({ discardUnsaved: true }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('reports a provider failure without offering to discard', async () => {
    mocks.signOut.mockResolvedValue('error');
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'יציאה' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('היציאה לא הושלמה');
    expect(screen.getByRole('button', { name: 'נסו שוב' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'צאו בכל זאת — שינויים שלא נשמרו יאבדו' }),
    ).not.toBeInTheDocument();
  });

  it('treats a rejected sign-out as a failure, never as silence', async () => {
    mocks.signOut.mockRejectedValue(new Error('boom'));
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'יציאה' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('היציאה לא הושלמה');
  });

  it('runs the caller hook before signing out and accepts custom content', async () => {
    mocks.signOut.mockResolvedValue('ok');
    const before = vi.fn();
    renderButton({ onBeforeSignOut: before, className: 'custom', children: 'להתנתק' });

    fireEvent.click(screen.getByRole('button', { name: 'להתנתק' }));

    expect(before).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'להתנתק' })).toHaveClass('custom');
  });
});
