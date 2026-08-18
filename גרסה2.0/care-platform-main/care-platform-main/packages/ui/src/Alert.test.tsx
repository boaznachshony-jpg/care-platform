import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { Alert } from './Alert.js';

describe('Alert', () => {
  it('uses an assertive alert role for error', () => {
    render(<Alert variant="error" title="שגיאה" />);
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
  });

  it('uses a polite status role for info', () => {
    render(<Alert variant="info" title="Heads up" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(
      <Alert variant="warning" title="Expiring soon">
        The visa expires in 7 days.
      </Alert>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
