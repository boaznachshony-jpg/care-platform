import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { Button } from './Button.js';

describe('Button', () => {
  it('renders its children as the accessible name', () => {
    render(<Button>שמור</Button>);
    expect(screen.getByRole('button', { name: 'שמור' })).toBeInTheDocument();
  });

  it('calls onClick when activated and not disabled', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    screen.getByRole('button').click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('marks itself aria-disabled when disabled', () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-disabled', 'true');
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<Button>Save</Button>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
