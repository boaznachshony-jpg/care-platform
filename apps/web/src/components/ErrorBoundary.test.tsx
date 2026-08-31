import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { AppErrorBoundary, SectionErrorBoundary } from './ErrorBoundary.js';

/**
 * WEB-06. Without a boundary every one of these cases ends as React 18
 * unmounting the whole tree: a blank white document, no message, no way back.
 * Each test below fails outright (nothing rendered to assert on) if the
 * boundary is removed.
 */

// The customer-data leak these tests guard against: a real thrown error in
// this app can carry a record id or a typed value in its message.
const SECRET_IN_MESSAGE = 'passport A1234567 of ישראל ישראלי';

function Boom({ shouldThrow = true }: { shouldThrow?: boolean }): JSX.Element {
  if (shouldThrow) throw new Error(SECRET_IN_MESSAGE);
  return <p>recovered content</p>;
}

function withI18n(node: React.ReactNode) {
  return <I18nextProvider i18n={initI18n()}>{node}</I18nextProvider>;
}

describe('AppErrorBoundary', () => {
  beforeEach(() => {
    // React logs the caught error itself; keep the test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a Hebrew recovery screen instead of a blank page', () => {
    render(
      withI18n(
        <AppErrorBoundary>
          <Boom />
        </AppErrorBoundary>,
      ),
    );

    expect(screen.getByRole('heading', { name: 'משהו השתבש במסך' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('offers a way forward, not just an apology', () => {
    render(
      withI18n(
        <AppErrorBoundary>
          <Boom />
        </AppErrorBoundary>,
      ),
    );

    expect(screen.getByRole('button', { name: 'ניסיון נוסף' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'רענון הדף' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'חזרה לרשימת המעסיקים' })).toHaveAttribute(
      'href',
      '/app',
    );
  });

  it('shows neither the error message nor a stack trace', () => {
    render(
      withI18n(
        <AppErrorBoundary>
          <Boom />
        </AppErrorBoundary>,
      ),
    );

    expect(document.body.textContent).not.toContain('A1234567');
    expect(document.body.textContent).not.toContain('Error');
    expect(document.body.textContent).not.toContain('at Boom');
  });

  it('reports the error to the caller without rendering it', () => {
    const onError = vi.fn();
    render(
      withI18n(
        <AppErrorBoundary onError={onError}>
          <Boom />
        </AppErrorBoundary>,
      ),
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]![0] as Error).message).toBe(SECRET_IN_MESSAGE);
  });

  it('re-renders the children when the user retries', () => {
    let shouldThrow = true;
    function Flaky() {
      return <Boom shouldThrow={shouldThrow} />;
    }
    render(
      withI18n(
        <AppErrorBoundary>
          <Flaky />
        </AppErrorBoundary>,
      ),
    );

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'ניסיון נוסף' }));

    expect(screen.getByText('recovered content')).toBeInTheDocument();
  });
});

describe('SectionErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the rest of the page on screen when one panel throws', () => {
    render(
      withI18n(
        <div>
          <p>שכר חודש יולי: 7,000</p>
          <SectionErrorBoundary>
            <Boom />
          </SectionErrorBoundary>
          <p>המשך העמוד</p>
        </div>,
      ),
    );

    expect(screen.getByText('שכר חודש יולי: 7,000')).toBeInTheDocument();
    expect(screen.getByText('המשך העמוד')).toBeInTheDocument();
    expect(screen.getByText('החלק הזה לא נטען')).toBeInTheDocument();
  });

  it('clears the failure when the reset key changes, so navigation is not a dead end', () => {
    let shouldThrow = true;
    function Flaky() {
      return <Boom shouldThrow={shouldThrow} />;
    }
    const { rerender } = render(
      withI18n(
        <SectionErrorBoundary resetKey="/payroll">
          <Flaky />
        </SectionErrorBoundary>,
      ),
    );
    expect(screen.getByText('החלק הזה לא נטען')).toBeInTheDocument();

    shouldThrow = false;
    rerender(
      withI18n(
        <SectionErrorBoundary resetKey="/tasks">
          <Flaky />
        </SectionErrorBoundary>,
      ),
    );

    expect(screen.getByText('recovered content')).toBeInTheDocument();
  });
});
