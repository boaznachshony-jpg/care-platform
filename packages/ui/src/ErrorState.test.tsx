import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { ErrorState } from './ErrorState.js';

describe('ErrorState', () => {
  it('announces itself immediately via role=alert', () => {
    render(<ErrorState kind="retryable" title="Couldn't load" body="Check your connection." />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(
      <ErrorState
        kind="authorization"
        title="No access"
        body="You don't have permission to view this case."
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
