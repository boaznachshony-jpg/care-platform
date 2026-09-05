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

  describe('busy', () => {
    it('does not call onClick while busy', () => {
      const onClick = vi.fn();
      render(
        <Button busy onClick={onClick}>
          שמור
        </Button>,
      );
      screen.getByRole('button').click();
      expect(onClick).not.toHaveBeenCalled();
    });

    it('keeps its accessible name and is not disabled while busy', () => {
      render(<Button busy>שמור</Button>);
      const button = screen.getByRole('button', { name: 'שמור' });
      expect(button).toBeEnabled();
      expect(button).not.toHaveAttribute('aria-disabled');
      expect(button).toHaveAttribute('aria-busy', 'true');
      expect(button).toHaveAttribute('data-busy', 'true');
      expect(button.querySelector('.cd-button__spinner')).toHaveAttribute('aria-hidden', 'true');
    });

    it('renders no spinner and no aria-busy when idle', () => {
      render(<Button>שמור</Button>);
      const button = screen.getByRole('button');
      expect(button).not.toHaveAttribute('aria-busy');
      expect(button.querySelector('.cd-button__spinner')).toBeNull();
    });

    it('has no detectable accessibility violations while busy', async () => {
      const { container } = render(<Button busy>Save</Button>);
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
