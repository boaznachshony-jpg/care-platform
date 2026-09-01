import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { ValueOrigin, ValueOriginLegend, type ValueOriginKind } from './ValueOrigin.js';

const KINDS: readonly ValueOriginKind[] = ['input', 'calculated', 'paid', 'forecast'];

/** `initI18n` is a module singleton, so a language switch has to be undone. */
afterEach(() => {
  void initI18n().changeLanguage('he');
});

function renderBadge(node: ReactNode, language = 'he') {
  const i18n = initI18n();
  void i18n.changeLanguage(language);
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);
}

function bundle(language: 'he' | 'en'): Record<string, unknown> {
  return initI18n().getResourceBundle(language, 'translation').valueOrigin as Record<
    string,
    unknown
  >;
}

describe('ValueOrigin — R5-01..R5-04', () => {
  it('names each of the four kinds in Hebrew, on screen', () => {
    renderBadge(
      <>
        {KINDS.map((kind) => (
          <ValueOrigin key={kind} kind={kind} />
        ))}
      </>,
    );

    expect(screen.getByText('הוזן')).toBeInTheDocument();
    expect(screen.getByText('מחושב')).toBeInTheDocument();
    expect(screen.getByText('שולם')).toBeInTheDocument();
    expect(screen.getByText('תחזית')).toBeInTheDocument();
  });

  /**
   * The reason this test exists: a colour-only distinction is not a
   * distinction. It has to survive greyscale, a monochrome print of the payroll
   * summary, and a screen reader. So each badge carries text of its own — and
   * each kind's text differs from every other kind's.
   */
  it('does not rely on colour: every kind carries distinct text and a distinct glyph', () => {
    const { container } = renderBadge(
      <>
        {KINDS.map((kind) => (
          <ValueOrigin key={kind} kind={kind} />
        ))}
      </>,
    );

    const badges = Array.from(container.querySelectorAll('.value-origin'));
    expect(badges).toHaveLength(4);

    const labels = badges.map(
      (badge) => badge.querySelector('.value-origin-label')?.textContent ?? '',
    );
    const glyphs = badges.map(
      (badge) => badge.querySelector('.value-origin-glyph')?.textContent ?? '',
    );
    expect(new Set(labels).size).toBe(4);
    expect(new Set(glyphs).size).toBe(4);
    expect(labels.every((label) => label.length > 0)).toBe(true);

    // The glyph is decoration on top of the word; the word is the accessible name.
    for (const badge of badges) {
      expect(badge.querySelector('.value-origin-glyph')).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('states in full, for a screen reader, what each kind claims', () => {
    const { container } = renderBadge(
      <>
        {KINDS.map((kind) => (
          <ValueOrigin key={kind} kind={kind} />
        ))}
      </>,
    );

    const meanings = Array.from(container.querySelectorAll('.value-origin .sr-only')).map(
      (element) => element.textContent ?? '',
    );
    expect(meanings).toHaveLength(4);
    expect(new Set(meanings).size).toBe(4);
    // The whole point of the release: a calculation is not legal truth, and a
    // forecast is not a fact.
    expect(meanings[1]).toContain('אינו אמת משפטית');
    expect(meanings[3]).toContain('אינה עובדה');
  });

  it('marks the kind on the element so a screen or a print rule can key on it', () => {
    const { container } = renderBadge(<ValueOrigin kind="forecast" />);
    expect(container.querySelector('.value-origin')).toHaveAttribute(
      'data-value-origin',
      'forecast',
    );
  });
});

describe('ValueOrigin provenance — R5-05', () => {
  it('shows only the provenance parts the caller actually has', () => {
    const { container } = renderBadge(
      <ValueOrigin kind="paid" provenance={{ source: 'סגירת חודש בשרת', when: '09.08.2026' }} />,
    );

    const provenance = container.querySelector('.value-origin-provenance')?.textContent ?? '';
    expect(provenance).toContain('מקור: סגירת חודש בשרת');
    expect(provenance).toContain('מתי: 09.08.2026');
    // No actor exists on a close record, so no actor is claimed.
    expect(provenance).not.toContain('מי:');
  });

  it('renders no provenance line at all when the record carries none', () => {
    const { container } = renderBadge(<ValueOrigin kind="input" />);
    expect(container.querySelector('.value-origin-provenance')).toBeNull();
  });

  it('shows all three parts when all three exist', () => {
    const { container } = renderBadge(
      <ValueOrigin
        kind="paid"
        provenance={{ source: 'סגירת חודש בשרת', who: 'רות לוי', when: '09.08.2026' }}
      />,
    );
    const provenance = container.querySelector('.value-origin-provenance')?.textContent ?? '';
    expect(provenance).toContain('מקור:');
    expect(provenance).toContain('מי: רות לוי');
    expect(provenance).toContain('מתי:');
  });
});

describe('ValueOriginLegend', () => {
  it('explains every kind it is asked to explain, in one place', () => {
    const { container } = renderBadge(<ValueOriginLegend kinds={['input', 'calculated']} />);

    const legend = container.querySelector('.value-origin-legend') as HTMLElement | null;
    expect(legend).not.toBeNull();
    expect(within(legend!).getByText('הוזן')).toBeInTheDocument();
    expect(within(legend!).getByText('מחושב')).toBeInTheDocument();
    expect(legend!.querySelectorAll('li')).toHaveLength(2);
    expect(legend!.textContent).toContain('באחריות המשתמש');
  });
});

describe('ValueOrigin translations', () => {
  it('renders the English labels when the interface is English', () => {
    renderBadge(<ValueOrigin kind="paid" />, 'en');
    expect(screen.getByText('Paid')).toBeInTheDocument();
  });

  /**
   * `LIABILITY-FRAMING.md` requires the resource files to stay identical in key
   * structure. `fallbackLng` is Hebrew, so a missing English key would not
   * throw — it would quietly print Hebrew inside an English screen.
   */
  it('keeps the Hebrew and English resources structurally identical', () => {
    const he = bundle('he');
    const en = bundle('en');
    expect(Object.keys(en).sort()).toEqual(Object.keys(he).sort());
    for (const key of ['input', 'calculated', 'paid', 'forecast', 'provenance', 'source']) {
      expect(Object.keys(en[key] as object).sort()).toEqual(Object.keys(he[key] as object).sort());
    }
  });
});
