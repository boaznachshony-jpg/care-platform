import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { Button } from './Button.js';
import { EmptyState } from './EmptyState.js';

describe('EmptyState', () => {
  it('renders both a title and a body when given', () => {
    render(<EmptyState title="עדיין אין כלום" body="פתחו תיק העסקה כדי להתחיל." />);
    expect(screen.getByText('עדיין אין כלום')).toBeInTheDocument();
    expect(screen.getByText('פתחו תיק העסקה כדי להתחיל.')).toBeInTheDocument();
  });

  it('renders no body element when body is omitted', () => {
    const { container } = render(<EmptyState title="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(container.querySelector('.cd-empty-state__body')).toBeNull();
  });

  it('renders no body element when body is an empty string', () => {
    const { container } = render(<EmptyState title="Nothing here" body="" />);
    expect(container.querySelector('.cd-empty-state__body')).toBeNull();
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
