import { useEffect, useState } from 'react';
import { findCanonicalCase, LEGACY_UNSCOPED_CLIENT_ID } from '../canonical-case.js';
import { listEmploymentCases } from '../api/client.js';

/**
 * `'none'` and `'unavailable'` look similar (both mean "there is no case id
 * to sync with right now") but are kept distinct because they say different
 * things to the rest of the page: `'none'` means onboarding never opened a
 * case, so there is nothing server-side to read *by design* — the screen
 * should just behave exactly as it always has, with no offline messaging.
 * `'unavailable'` means a case very likely exists but this browser could not
 * reach the server to find out, which is the state that should show the
 * "offline copy" label.
 *
 * `'ambiguous'` is Defect 4's fix. `useLegacyClientId()` returns the literal
 * sentinel `LEGACY_UNSCOPED_CLIENT_ID` for every visitor of the unscoped
 * `/tasks`, `/documents`, `/medications` routes — there is no client id in
 * the URL to read. `findCanonicalCase` then matches *any* case whose
 * `legacyClientId` column literally equals that sentinel string. For an
 * account that has only ever had one client, that is harmless: the sentinel
 * can only ever mean that one client, because it is the only case in the
 * account old enough to predate per-client routing. Once a second client
 * exists, the sentinel is no longer an identification, it is a guess — this
 * browser has no way to know which of the account's households the person
 * currently looking at `/tasks` means, and syncing anyway risks writing a
 * caregiver's medication list, or a document, under the wrong family's case.
 * Refusing outright and telling the family why (open the client-scoped
 * `/clients/:clientId/...` route instead) is safer than guessing wrong in
 * either direction — this is exactly the kind of ambiguity Constitution
 * §13's "never guess with someone else's data" rule exists for.
 */
export type CaseLookupState =
  | { status: 'checking' }
  | { status: 'none' }
  | { status: 'unavailable' }
  | { status: 'ambiguous' }
  | { status: 'found'; caseId: string };

/**
 * Resolves the canonical case for the legacy client the current screen
 * belongs to, re-checking whenever the client changes. Read-only: never
 * creates a case (that is `ensureCanonicalCase`'s job, used at onboarding
 * completion, not here — a Tasks/Documents/Medications screen opened before
 * onboarding finishes has nothing to sync to yet, and that is fine).
 */
export function useCaseForLegacyClient(legacyClientId: string): CaseLookupState {
  const [state, setState] = useState<CaseLookupState>({ status: 'checking' });

  useEffect(() => {
    let active = true;
    setState({ status: 'checking' });

    async function resolve(): Promise<CaseLookupState> {
      if (legacyClientId === LEGACY_UNSCOPED_CLIENT_ID) {
        // See the 'ambiguous' doc comment above: only refuse when the
        // sentinel is genuinely ambiguous (more than one client on the
        // account). A single-client account still resolves normally below,
        // exactly as it always has.
        const cases = await listEmploymentCases();
        // "More than one client on the account" is simply more than one
        // case: each employment case is one household. As soon as a second
        // one exists, the unscoped sentinel can no longer be trusted to mean
        // a specific one of them, no matter which of the two (if either)
        // literally carries the sentinel string in its legacyClientId column.
        if (cases.length > 1) {
          return { status: 'ambiguous' };
        }
      }
      const found = await findCanonicalCase(legacyClientId);
      return found ? { status: 'found', caseId: found.id } : { status: 'none' };
    }

    resolve()
      .then((next) => {
        if (active) setState(next);
      })
      .catch(() => {
        if (active) setState({ status: 'unavailable' });
      });
    return () => {
      active = false;
    };
  }, [legacyClientId]);

  return state;
}
