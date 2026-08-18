import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { TextField } from './TextField.js';

describe('TextField', () => {
  it('links the label to the input', () => {
    render(<TextField label="שם מלא" />);
    expect(screen.getByLabelText('שם מלא')).toBeInTheDocument();
  });

  it('links the error message and marks the input invalid', () => {
    render(<TextField label="Full name" error="Required" />);
    const input = screen.getByLabelText('Full name');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
    expect(input).toHaveAccessibleDescription('Required');
  });

  it('supports an LTR value inside an RTL layout', () => {
    render(<TextField label="Email" inputDir="ltr" />);
    expect(screen.getByLabelText('Email')).toHaveAttribute('dir', 'ltr');
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<TextField label="City" required />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
