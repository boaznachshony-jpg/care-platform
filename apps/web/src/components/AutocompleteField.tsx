import { useId, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

const DEFAULT_MAX_SUGGESTIONS = 8;

/**
 * Suggestion filter used by the autocomplete: prefix matches first, then
 * substring matches. Free text is always allowed — this only ranks helpers.
 */
export function filterSuggestions(
  options: readonly string[],
  query: string,
  maxSuggestions = DEFAULT_MAX_SUGGESTIONS,
): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const prefixMatches: string[] = [];
  const substringMatches: string[] = [];
  for (const option of options) {
    if (option.startsWith(trimmed)) prefixMatches.push(option);
    else if (option.includes(trimmed)) substringMatches.push(option);
  }
  const combined = [...prefixMatches, ...substringMatches].slice(0, maxSuggestions);
  // Nothing left to suggest once the typed value is the only exact match.
  if (combined.length === 1 && combined[0] === trimmed) return [];
  return combined;
}

export interface AutocompleteFieldProps {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  required?: boolean;
  autoComplete?: string;
  maxSuggestions?: number;
}

/**
 * Accessible free-text input with a filtered suggestions dropdown
 * (WAI-ARIA combobox pattern). Values outside the option list are allowed —
 * the list assists typing, it is not a whitelist. Inherits the app's RTL
 * direction; keyboard support: arrows to move, Enter to pick, Escape to
 * close.
 */
export function AutocompleteField({
  label,
  value,
  options,
  onChange,
  required,
  autoComplete,
  maxSuggestions = DEFAULT_MAX_SUGGESTIONS,
}: AutocompleteFieldProps) {
  const { t } = useTranslation();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const suggestions = open ? filterSuggestions(options, value, maxSuggestions) : [];
  const expanded = open && suggestions.length > 0;

  function pick(option: string) {
    onChange(option);
    setOpen(false);
    setActiveIndex(-1);
  }

  function close() {
    setOpen(false);
    setActiveIndex(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      else if (suggestions.length > 0) {
        setActiveIndex((current) => (current + 1) % suggestions.length);
      }
      return;
    }
    if (event.key === 'ArrowUp') {
      if (!expanded) return;
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
      return;
    }
    if (event.key === 'Enter') {
      if (expanded && activeIndex >= 0 && suggestions[activeIndex] !== undefined) {
        event.preventDefault();
        pick(suggestions[activeIndex]);
      }
      return;
    }
    if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      close();
    }
  }

  return (
    <label className="autocomplete-field">
      {label}
      <span className="autocomplete-anchor">
        <input
          role="combobox"
          value={value}
          required={required}
          autoComplete={autoComplete}
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={
            expanded && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined
          }
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={onKeyDown}
          onBlur={close}
        />
        {expanded ? (
          <ul
            className="autocomplete-suggestions"
            role="listbox"
            id={listId}
            aria-label={t('common.suggestions')}
          >
            {suggestions.map((option, index) => (
              <li
                key={option}
                id={`${listId}-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? 'active' : undefined}
                onMouseDown={(event) => {
                  // Select before the input's blur closes the list.
                  event.preventDefault();
                  pick(option);
                }}
                onMouseEnter={() => setActiveIndex(index)}
              >
                {option}
              </li>
            ))}
          </ul>
        ) : null}
      </span>
    </label>
  );
}
