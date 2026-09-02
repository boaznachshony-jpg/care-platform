/**
 * Only the shape actually used, so this module needs neither an i18next type
 * import nor a dependency on the UI package's option type.
 */
type Translate = (key: string) => string;
interface RelationshipOption {
  value: string;
  label: string;
}

/**
 * The employer's relationship to the person being cared for.
 *
 * WHY A LIST AND NOT A TEXT BOX
 * -----------------------------
 * The question is closed — there are four answers that matter to this product —
 * and asking it as free text produced a blank box whose only guidance was the
 * browser's own autofill dropdown. It also produced one spelling per customer
 * ("בת", "הבת", "בת של המטופלת"), which is a column nothing can ever group by.
 *
 * "קרוב משפחה" and "נאמן" are deliberately broad: the first covers every family
 * tie other than a child, the second covers a guardian, an appointed
 * representative or a friend acting for the person — someone with standing but
 * no family relation. Between them nothing is left without an honest answer, so
 * nobody has to pick a wrong one.
 *
 * WHY THE VALUES ARE THE HEBREW LABELS
 * ------------------------------------
 * `employment_case.relationship_to_recipient` is a free-text display column and
 * already holds Hebrew text for live records. Storing identifiers instead would
 * make every existing row render as `son` on the case screen, and would need a
 * migration to fix a field that is only ever displayed. So the option value is
 * the label, and existing rows keep working unchanged.
 */
export const RELATIONSHIP_OPTION_KEYS = ['son', 'daughter', 'relative', 'trustee'] as const;

export type RelationshipOptionKey = (typeof RELATIONSHIP_OPTION_KEYS)[number];

/**
 * The options to show, given whatever is stored today.
 *
 * `current` is not decoration. A record whose relationship was typed before
 * this list existed — "אחות", "בן זוג" — must still be offered its own value,
 * or opening the form and saving it would quietly replace a fact the customer
 * entered with one of ours. Constitution §13: a screen never destroys data by
 * being opened.
 */
export function relationshipOptions(t: Translate, current?: string): readonly RelationshipOption[] {
  const known = RELATIONSHIP_OPTION_KEYS.map((key) => {
    const label = t(`case.relationshipOptions.${key}`);
    return { value: label, label };
  });
  const value = current?.trim();
  if (!value || known.some((option) => option.value === value)) return known;
  return [...known, { value, label: value }];
}
