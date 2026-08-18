import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { StatusBadge } from './StatusBadge.js';

describe('StatusBadge', () => {
  it('always renders the label as text, never color-only', () => {
    render(<StatusBadge tone="danger" label="פג תוקף" />);
    expect(screen.getByText('פג תוקף')).toBeInTheDocument();
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<StatusBadge tone="success" label="Active" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
