import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { Button } from './Button.js';
import { EmptyState } from './EmptyState.js';

describe('EmptyState', () => {
  it('always renders both a title and a body', () => {
    render(<EmptyState title="עדיין אין כלום" body="פתחו תיק העסקה כדי להתחיל." />);
    expect(screen.getByText('עדיין אין כלום')).toBeInTheDocument();
    expect(screen.getByText('פתחו תיק העסקה כדי להתחיל.')).toBeInTheDocument();
  });

  it('has no detectable accessibility violations with an action', async () => {
    const { container } = render(
      <EmptyState
        title="Nothing here"
        body="Open a case to get started."
        action={<Button>Open case</Button>}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
