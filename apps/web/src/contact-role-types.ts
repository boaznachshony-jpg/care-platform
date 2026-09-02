/**
 * The standing a person has on a case.
 *
 * WHY A CLOSED LIST
 * -----------------
 * `case_contact.role_type` is free text today, so it holds whatever each family
 * typed — and the emergency binder prints that text verbatim to whoever is
 * handed the folder. "מורשה טיפול" and "אח" and "טלפון של גדי" all rendered the
 * same way, and none of them told the reader what the person may decide.
 *
 * The four levels below are ordered by authority, and each is named for what
 * the person may do rather than for what they lack. The wording the owner
 * rejected — "אין לו חשבון או הרשאות משתמש" — described people by an absence,
 * which is both unkind and uninformative to someone reading a binder in an
 * emergency.
 *
 * WHAT THESE DO NOT DO — READ THIS BEFORE ADDING A FIFTH
 * -----------------------------------------------------
 * They grant nothing. Nothing in the API or the database consults `role_type`;
 * it is a description of standing that exists outside CareDesk — who the family
 * has actually authorised, in life. A label that says "מורשה ניהול" while the
 * system enforces nothing would be a promise the product does not keep, so the
 * form says so in a hint rather than leaving the reader to assume otherwise.
 *
 * Turning these into real permissions is a separate, deliberate piece of work:
 * it needs an account per contact, an invitation, and a server-side check on
 * every route. Until that exists, this list stays honest about being a label.
 *
 * WHY THE VALUES ARE THE HEBREW LABELS
 * ------------------------------------
 * Same reason as `relationship-options.ts`: the column already holds Hebrew
 * text for live records and is rendered raw on the case screen and in the
 * binder. Identifiers would print as `informed` to a family reading a folder.
 */
export const CONTACT_ROLE_KEYS = ['informed', 'interested', 'care', 'management'] as const;

export type ContactRoleKey = (typeof CONTACT_ROLE_KEYS)[number];

type Translate = (key: string) => string;

interface ContactRoleOption {
  value: string;
  label: string;
}

/**
 * `current` keeps a role typed before this list existed selectable, so opening
 * an existing contact and saving it cannot replace what the family recorded.
 */
export function contactRoleOptions(t: Translate, current?: string): readonly ContactRoleOption[] {
  const known = CONTACT_ROLE_KEYS.map((key) => {
    const label = t(`contacts.roleOptions.${key}`);
    return { value: label, label };
  });
  const value = current?.trim();
  if (!value || known.some((option) => option.value === value)) return known;
  return [...known, { value, label: value }];
}
