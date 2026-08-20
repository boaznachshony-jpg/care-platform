import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { AutocompleteField, filterSuggestions } from './AutocompleteField.js';

const cities = ['חיפה', 'חדרה', 'תל אביב-יפו', 'טירת כרמל', 'נוף הגליל'] as const;

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <I18nextProvider i18n={initI18n()}>
      <AutocompleteField label="עיר או יישוב" value={value} options={cities} onChange={setValue} />
    </I18nextProvider>
  );
}

describe('filterSuggestions', () => {
  it('ranks prefix matches before substring matches', () => {
    expect(filterSuggestions(['abc', 'bca', 'cab'], 'a')).toEqual(['abc', 'bca', 'cab']);
    expect(filterSuggestions(['bca', 'abc'], 'a')).toEqual(['abc', 'bca']);
  });

  it('returns nothing for an empty or whitespace-only query', () => {
    expect(filterSuggestions(cities, '')).toEqual([]);
    expect(filterSuggestions(cities, '   ')).toEqual([]);
  });

  it('caps the number of suggestions', () => {
    const many = Array.from({ length: 20 }, (_, index) => `aa-${index}`);
    expect(filterSuggestions(many, 'aa', 3)).toHaveLength(3);
  });

  it('hides the list once the typed value is the only exact match', () => {
    expect(filterSuggestions(cities, 'חיפה')).toEqual([]);
  });

  it('matches anywhere in the name, not only at the start', () => {
    expect(filterSuggestions(cities, 'כרמל')).toEqual(['טירת כרמל']);
  });
});

describe('AutocompleteField', () => {
  it('shows filtered suggestions and selects one with the mouse', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'עיר או יישוב' });

    fireEvent.change(input, { target: { value: 'ח' } });
    const listbox = screen.getByRole('listbox');
    expect(listbox).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'true');

    fireEvent.mouseDown(screen.getByRole('option', { name: 'חדרה' }));
    expect(input).toHaveValue('חדרה');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('supports keyboard navigation: arrows to move, Enter to pick, Escape to close', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'עיר או יישוב' });

    fireEvent.change(input, { target: { value: 'ח' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: 'חיפה' }).id,
    );

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('חיפה');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'ט' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('allows free text that is not in the option list', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'עיר או יישוב' });

    fireEvent.change(input, { target: { value: 'כפר שלי הקטן' } });

    expect(input).toHaveValue('כפר שלי הקטן');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes the suggestion list when the field loses focus', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'עיר או יישוב' });

    fireEvent.change(input, { target: { value: 'ח' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.blur(input);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
