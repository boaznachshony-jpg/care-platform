import { useTranslation } from 'react-i18next';

/**
 * R5-01 / R5-02 / R5-03 / R5-04 — the four kinds of number, said out loud.
 *
 * WHY THIS EXISTS
 * ---------------
 * Until now the payroll screen, the future-cost screen and the national
 * insurance table rendered four different claims in the same typeface: a figure
 * the user typed, a figure CareDesk derived, a payment that happened, and a
 * projection about a month that has not occurred. Rendered identically, they
 * read as one claim of the same strength — and the strongest of them (a
 * calculation, a forecast) is exactly the one the product must NOT be read as
 * asserting. `LIABILITY-FRAMING.md` says the product is a tool for organising
 * and recording: what the customer types is the customer's responsibility, and
 * a calculation is not legal truth. That position is only defensible if the
 * screen says which is which.
 *
 * WHY ONE COMPONENT AND NOT FOUR TREATMENTS
 * -----------------------------------------
 * Four ad-hoc treatments would drift apart the first time a screen is edited,
 * and the distinction would then mean something different on each surface —
 * which is worse than no distinction, because it would look deliberate. There
 * is one component, one set of i18n keys, and one CSS block.
 *
 * WHY NOT COLOUR
 * --------------
 * The badge always renders the translated WORD (הוזן / מחושב / שולם / תחזית)
 * plus a shape-distinct glyph. Colour is decoration on top of that, so the
 * distinction survives greyscale, monochrome printing (the payroll summary is
 * printed) and a screen reader. The `sr-only` sentence states the meaning in
 * full, because "מחושב" alone does not tell a non-sighted user that the number
 * is not a payslip.
 *
 * WHAT IT IS NOT
 * --------------
 * It is presentation only. It reads no store, derives no amount and changes no
 * calculation. The caller decides the kind, because only the caller knows where
 * its number came from.
 */
export type ValueOriginKind = 'input' | 'calculated' | 'paid' | 'forecast';

/**
 * R5-05 — source / who / when.
 *
 * Every field is optional and nothing here is invented: a badge shows only the
 * parts the underlying record already carries. Where the data has no "who"
 * (the MVP payroll store records no actor) the badge simply omits it rather
 * than displaying a placeholder that would imply the product knows.
 */
export interface ValueProvenance {
  /** Human-readable origin, normally `t('valueOrigin.source.*')`. */
  source?: string;
  /** Who recorded it, when the record carries an actor. */
  who?: string;
  /** Already-formatted date or timestamp. Formatting stays with the caller. */
  when?: string;
}

/**
 * Shape-distinct on purpose: a pencil, a sigma, a check and an arrow are
 * distinguishable from one another at 12px and in monochrome. They are
 * `aria-hidden` — the word beside them is the accessible name.
 */
const ORIGIN_GLYPH: Record<ValueOriginKind, string> = {
  input: '✎',
  calculated: '∑',
  paid: '✓',
  forecast: '↗',
};

export function ValueOrigin({
  kind,
  provenance,
  className,
}: {
  kind: ValueOriginKind;
  provenance?: ValueProvenance;
  className?: string;
}) {
  const { t } = useTranslation();
  const details = [
    provenance?.source ? t('valueOrigin.provenance.source', { source: provenance.source }) : '',
    provenance?.who ? t('valueOrigin.provenance.who', { who: provenance.who }) : '',
    provenance?.when ? t('valueOrigin.provenance.when', { when: provenance.when }) : '',
  ].filter(Boolean);
  return (
    <span
      className={['value-origin', `value-origin-${kind}`, className].filter(Boolean).join(' ')}
      data-value-origin={kind}
    >
      <span aria-hidden="true" className="value-origin-glyph">
        {ORIGIN_GLYPH[kind]}
      </span>
      <span className="value-origin-label">{t(`valueOrigin.${kind}.label`)}</span>
      <span className="sr-only">{t(`valueOrigin.${kind}.meaning`)}</span>
      {details.length ? (
        <span className="value-origin-provenance">{details.join(' · ')}</span>
      ) : null}
    </span>
  );
}

/**
 * The key to the badges, stated once per screen that uses them.
 *
 * Placed ABOVE the numbers it explains, for the same reason the liability notes
 * are (`LIABILITY-FRAMING.md`, placement rule 2): a reader must meet the rule
 * before acting on the figures, not after.
 */
export function ValueOriginLegend({ kinds }: { kinds: readonly ValueOriginKind[] }) {
  const { t } = useTranslation();
  return (
    <div className="value-origin-legend">
      <strong>{t('valueOrigin.legendTitle')}</strong>
      <p>{t('valueOrigin.legendIntro')}</p>
      <ul>
        {kinds.map((kind) => (
          <li key={kind}>
            <ValueOrigin kind={kind} />
            {/* aria-hidden is correct here and only here: the badge already
                exposes this exact sentence through its `sr-only` span, so
                without this the legend would be read out twice. */}
            <span aria-hidden="true">{t(`valueOrigin.${kind}.meaning`)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
