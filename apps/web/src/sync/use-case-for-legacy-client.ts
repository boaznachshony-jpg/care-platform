import { useEffect, useState } from 'react';
import { findCanonicalCase } from '../canonical-case.js';

/**
 * `'none'` and `'unavailable'` look similar (both mean "there is no case id
 * to sync with right now") but are kept distinct because they say different
 * things to the rest of the page: `'none'` means onboarding never opened a
 * case, so there is nothing server-side to read *by design* — the screen
 * should just behave exactly as it always has, with no offline messaging.
 * `'unavailable'` means a case very likely exists but this browser could not
 * reach the server to find out, which is the state that should show the
 * "offline copy" label.
 */
export type CaseLookupState =
  | { status: 'checking' }
  | { status: 'none' }
  | { status: 'unavailable' }
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
    findCanonicalCase(legacyClientId)
      .then((found) => {
        if (!active) return;
        setState(found ? { status: 'found', caseId: found.id } : { status: 'none' });
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
