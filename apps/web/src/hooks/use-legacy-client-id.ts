import { useParams } from 'react-router-dom';
import { LEGACY_UNSCOPED_CLIENT_ID } from '../canonical-case.js';

/**
 * The legacy client the current screen belongs to, as the router sees it.
 *
 * Read from the route rather than from `window.location`. Those two agree in
 * the browser and do not agree under `MemoryRouter`, which is what every test
 * uses - so a component that asks `window.location` is a component whose
 * client-scoping cannot be tested. The router is also the only correct source
 * during a transition, before the address bar has caught up.
 */
export function useLegacyClientId(): string {
  const { clientId } = useParams<{ clientId: string }>();
  return clientId || LEGACY_UNSCOPED_CLIENT_ID;
}
