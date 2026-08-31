import type { EmploymentCaseResponse, OpenEmploymentCaseRequest } from '@caredesk/schemas';
import { listEmploymentCases, openEmploymentCase } from './api/client.js';
import { readActiveMvpProfile, type MvpProfile } from './storage/mvp-storage.js';

/**
 * The bridge between the legacy browser client and the canonical
 * `EmploymentCase` aggregate.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * ADR-006 makes the normalized PostgreSQL aggregate canonical and the
 * `caredesk.mvp.*` snapshot a transitional compatibility mechanism. The
 * migration then stalled on something simpler than any of its hard parts: code
 * review WEB-11 found that **no route in the product created a case**, so the
 * canonical module was unreachable and `/cases/:caseId`, the emergency binder
 * and the visa screens were dead ends reachable only by pasting a UUID. Every
 * protection built around the canonical tables was guarding an empty room.
 *
 * This module is the missing step: it turns "the user finished setting up a
 * client" into "a canonical case exists for that client", and it answers
 * "which canonical case is this client?" everywhere else.
 *
 * WHERE THE LINK IS KEPT
 * ----------------------
 * On the canonical row - `employment_case.legacy_client_id`, migration 0042 -
 * never in the snapshot. Recording it in localStorage would put the migration's
 * own bookkeeping in the store being migrated away from: unprotected by
 * `tenant_workspace_history` and RLS, and destroyed by a cleared browser. The
 * canonical side can answer the question on its own, so it does.
 *
 * READ DIRECTION
 * --------------
 * Canonical first, snapshot only as a fallback - never the reverse. The
 * snapshot supplies the *party details* for a case that does not exist yet
 * (they were typed during onboarding and there is nowhere else to get them),
 * and nothing else. Once the case exists, the canonical row is the answer.
 */

/**
 * Legacy single-client workspaces predate `caredesk.mvp.clients.v1` and have no
 * client id in the path. They still need a stable link, or the idempotence
 * check has nothing to match on and every retry opens another case. This
 * constant is that stable identity - one unscoped legacy workspace per tenant.
 */
export const LEGACY_UNSCOPED_CLIENT_ID = 'legacy:unscoped';

/**
 * The canonical case for a legacy client, or null.
 *
 * Cases created before migration 0042 carry `legacyClientId: null` and are not
 * matched here. That is deliberate and it is what keeps the live tenant
 * readable: an unlinked case is still listed, still openable at
 * `/cases/:caseId`, and still selectable in the binder. Nothing is hidden
 * because it predates the link.
 */
export async function findCanonicalCase(
  legacyClientId: string,
): Promise<EmploymentCaseResponse | null> {
  const cases = await listEmploymentCases();
  return cases.find((row) => row.legacyClientId === legacyClientId) ?? null;
}

/**
 * @param defaultRelationship what to record when setup never asked for the
 *   employer's relationship to the care recipient - which it does not, on any
 *   onboarding step; only SettingsPage does. It is passed in rather than
 *   hardcoded so the wording comes from the translation resources and this
 *   module stays free of UI text. Callers pass `t('case.defaultRelationship')`,
 *   which says "employer": the relationship the case itself establishes, and
 *   not an invented family tie.
 */
export function caseRequestFromProfile(
  profile: MvpProfile,
  legacyClientId: string,
  defaultRelationship: string,
): OpenEmploymentCaseRequest | null {
  // The canonical contract requires these five, and every one of them is
  // collected and validated by onboarding. A setup that never reached the
  // caregiver step cannot open a case yet, and inventing a placeholder would
  // put a made-up fact into the record of employment - so this returns null and
  // the caller shows the form instead of posting a request the user cannot fix.
  if (
    !profile.recipientName ||
    !profile.employerName ||
    !profile.caregiverName ||
    !profile.caregiverCountry ||
    !profile.employmentStartDate
  ) {
    return null;
  }
  return {
    careRecipient: {
      fullName: profile.recipientName,
      careLevel: profile.recipientCareLevel || undefined,
      city: profile.recipientCity || undefined,
    },
    employer: {
      fullName: profile.employerName,
      relationshipToRecipient: profile.employerRelationship || defaultRelationship,
      city: profile.employerCity || undefined,
    },
    caregiver: {
      legalName: profile.caregiverName,
      nationality: profile.caregiverCountry,
      primaryLanguage: profile.caregiverLanguage || undefined,
    },
    startDate: profile.employmentStartDate,
    legacyClientId,
  };
}

export type EnsureCanonicalCaseResult =
  | { kind: 'linked'; employmentCase: EmploymentCaseResponse }
  | { kind: 'incomplete' }
  | { kind: 'unavailable' };

/**
 * Makes sure a canonical case exists for this legacy client, and returns it.
 *
 * Safe to call repeatedly. The server is idempotent on `legacyClientId`
 * (`OpenEmploymentCase` returns the existing case; the unique index in 0042 is
 * the second line), so a retry after a failed network request cannot create a
 * duplicate household.
 *
 * `unavailable` is not an error state for the user: onboarding must complete
 * offline, and the case is opened on the next attempt. It is reported rather
 * than thrown so callers can decide whether to say anything.
 */
export async function ensureCanonicalCase(
  legacyClientId: string,
  defaultRelationship: string,
  profile: MvpProfile = readActiveMvpProfile(),
): Promise<EnsureCanonicalCaseResult> {
  try {
    const existing = await findCanonicalCase(legacyClientId);
    if (existing) return { kind: 'linked', employmentCase: existing };
  } catch {
    return { kind: 'unavailable' };
  }

  const request = caseRequestFromProfile(profile, legacyClientId, defaultRelationship);
  if (!request) return { kind: 'incomplete' };

  try {
    return { kind: 'linked', employmentCase: await openEmploymentCase(request) };
  } catch {
    return { kind: 'unavailable' };
  }
}
