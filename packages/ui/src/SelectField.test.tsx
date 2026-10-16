import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { SelectField } from './SelectField.js';

const options = [
  { value: 'spouse', label: 'בן/בת זוג' },
  { value: 'child', label: 'בן/בת' },
] as const;

describe('SelectField', () => {
  it('links the label to the select', () => {
    render(<SelectField label="קרבה למטופל" options={options} />);
    expect(screen.getByLabelText('קרבה למטופל')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders the placeholder as an empty-valued first option', () => {
    render(<SelectField label="Relationship" options={options} placeholder="Choose…" />);
    const first = screen.getAllByRole('option')[0];
    expect(first).toHaveTextContent('Choose…');
    expect(first).toHaveValue('');
    expect(screen.getAllByRole('option')).toHaveLength(options.length + 1);
  });

  it('links the error message and marks the select invalid', () => {
    render(<SelectField label="Relationship" options={options} error="Required" />);
    const select = screen.getByLabelText('Relationship');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
    expect(select).toHaveAccessibleDescription('Required');
    expect(select.getAttribute('aria-describedby')).toContain(`${select.id}-error`);
  });

  it('links the hint through aria-describedby', () => {
    render(<SelectField label="Relationship" options={options} hint="Pick the closest match." />);
    expect(screen.getByLabelText('Relationship')).toHaveAccessibleDescription(
      'Pick the closest match.',
    );
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(
      <SelectField label="City" options={options} placeholder="Choose…" required />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
