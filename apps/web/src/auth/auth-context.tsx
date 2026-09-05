import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { User } from '@supabase/supabase-js';
import { listFamilyMembers, prewarmApi } from '../api/client.js';
import { getDeploymentEnvironment } from '../environment.js';
import { getBrowserAuthClient } from './client.js';
import { AccessRevokedPage } from './AccessRevokedPage.js';
import {
  canUseCachedWorkspace,
  flushWorkspaceSync,
  getWorkspaceSyncState,
  isWorkspaceAccessDeniedError,
  pauseWorkspaceSync,
  startWorkspaceSync,
  stopWorkspaceSync,
  WORKSPACE_SYNC_CHANGED,
} from '../storage/workspace-sync.js';
import { clearLocalDocumentFileCache } from '../storage/document-file-store.js';

/**
 * 'unsaved-changes': the device holds edits the cloud has not accepted. The
 * caller must show the customer the choice between retrying and leaving
 * anyway; a silent refusal is what SEC-WEB-01 was about.
 * 'error': the identity provider refused to end the session while it still
 * exists. Nothing was cleared.
 */
export type SignOutResult = 'ok' | 'unsaved-changes' | 'error';

export interface SignOutOptions {
  /** Skip the cloud flush: the customer chose to lose unsaved edits. */
  discardUnsaved?: boolean;
}

export interface LastSignOut {
  /** False when passport/ID scans are still in the device's IndexedDB. */
  documentCacheCleared: boolean;
}

interface AuthContextValue {
  enabled: boolean;
  user: User | null;
  /**
   * False when the account is a viewer on the family workspace. Derived once
   * per hydration from GET /family/members; unknown is treated as writable so
   * a failed lookup never locks an owner out of their own screens.
   */
  canWrite: boolean;
  /** Outcome of the most recent sign-out on this device, for the login page. */
  lastSignOut: LastSignOut | null;
  signIn(email: string, password: string): Promise<boolean>;
  signUp(email: string, password: string): Promise<'signed-in' | 'confirmation-required' | 'error'>;
  resendSignUpConfirmation(email: string): Promise<boolean>;
  requestMagicLink(email: string): Promise<boolean>;
  requestPasswordReset(email: string): Promise<boolean>;
  updatePassword(password: string): Promise<boolean>;
  signOut(options?: SignOutOptions): Promise<SignOutResult>;
  /** Re-attempts the IndexedDB delete that a previous sign-out reported as blocked. */
  retryDocumentCacheClear(): Promise<boolean>;
}

const defaultAuthContext: AuthContextValue = {
  enabled: false,
  user: null,
  canWrite: true,
  lastSignOut: null,
  signIn: async () => false,
  signUp: async () => 'error',
  resendSignUpConfirmation: async () => false,
  requestMagicLink: async () => false,
  requestPasswordReset: async () => false,
  updatePassword: async () => false,
  signOut: async () => 'ok',
  retryDocumentCacheClear: async () => true,
};

const AuthContext = createContext<AuthContextValue>(defaultAuthContext);
export const AUTH_SESSION_RECOVERY_GRACE_MS = 1_500;

export type AuthGateState =
  | 'local-bypass'
  | 'configuration-required'
  | 'storage-error'
  | 'access-revoked'
  | 'loading'
  | 'ready';

export function resolveAuthGateState(
  hasClient: boolean,
  environment = getDeploymentEnvironment(),
): AuthGateState {
  if (environment === 'local' && !hasClient) return 'local-bypass';
  if (!hasClient) return 'configuration-required';
  return 'loading';
}

/**
 * One request after hydration. The API already returns the caller's own role
 * in the members list, so no new endpoint is needed. Any failure - including a
 * 403 for a member who may not list the family - leaves the answer "unknown",
 * which is rendered as writable; the server is still the one that refuses a
 * write, and workspace-sync turns that refusal into a visible 'read-only'.
 */
async function loadCanWrite(): Promise<boolean> {
  try {
    const response = await listFamilyMembers();
    const me = response.members.find((member) => member.isCurrentUser);
    return me ? me.role !== 'viewer' : true;
  } catch {
    return true;
  }
}

export function AuthProvider({
  children,
  login,
  configurationRequired,
  storageUnavailable,
  accessRevoked,
  passwordRecovery,
  loading,
  sessionRecovering,
}: {
  children?: ReactNode;
  login: ReactNode;
  configurationRequired: ReactNode;
  storageUnavailable: ReactNode;
  /**
   * Shown when the server refuses the workspace outright (401/403): the
   * membership was revoked. Defaults to the built-in page so the host does not
   * have to know about the state.
   */
  accessRevoked?: ReactNode;
  passwordRecovery: ReactNode;
  loading: ReactNode;
  /**
   * Shown over the still-mounted app while a transient session is verified
   * (WEB-05). Passed in rather than translated here so this module keeps no
   * dependency on the i18n provider.
   */
  sessionRecovering?: ReactNode;
}) {
  const [client] = useState(getBrowserAuthClient);
  const initialState = resolveAuthGateState(Boolean(client));
  const [state, setState] = useState<AuthGateState>(initialState);
  const [user, setUser] = useState<User | null>(null);
  const [canWrite, setCanWrite] = useState(true);
  const [lastSignOut, setLastSignOut] = useState<LastSignOut | null>(null);
  const [recoveringPassword, setRecoveringPassword] = useState(false);
  const explicitSignOutRef = useRef(false);
  /**
   * The user whose workspace has actually been hydrated from the server. A ref
   * because both the auth effect and signOut have to clear it, and because it
   * must survive re-renders without triggering one.
   */
  const hydratedUserRef = useRef<string | null>(null);
  /**
   * WEB-05: whether `children` have ever been on screen. A transient auth blip
   * after that point must overlay them, not unmount them.
   */
  const hasMountedChildrenRef = useRef(false);
  /**
   * GAP-2-01: the purge after a revoked membership runs once per revocation,
   * whichever path noticed it first (hydration rejecting, or the sync layer
   * reporting 'unauthorized' from a save or an idle re-check).
   */
  const revokingRef = useRef(false);

  useEffect(() => {
    if (state === 'ready' && user) hasMountedChildrenRef.current = true;
    // UI-NAV-01: the login page unmounts the children, so there is nothing
    // left to preserve. Without this reset the next sign-in in the same tab
    // rendered the app immediately, before hydration, and the client list
    // that mounted against an empty cache never refreshed.
    if (state === 'ready' && !user) hasMountedChildrenRef.current = false;
  }, [state, user]);

  const revokeAccess = async () => {
    if (revokingRef.current) return;
    revokingRef.current = true;
    hydratedUserRef.current = null;
    setCanWrite(true);
    // stopWorkspaceSync purges caredesk.mvp.*, drafts, the cache key, the
    // onboarding/sync residue and the IndexedDB document cache. A revoked
    // relative must not keep a browsable decrypted copy of the family's data.
    await stopWorkspaceSync();
    setState('access-revoked');
  };

  useEffect(() => {
    if (!client) return undefined;
    const onSyncChanged = () => {
      if (getWorkspaceSyncState() === 'unauthorized') void revokeAccess();
    };
    window.addEventListener(WORKSPACE_SYNC_CHANGED, onSyncChanged);
    return () => window.removeEventListener(WORKSPACE_SYNC_CHANGED, onSyncChanged);
  }, [client]);

  useEffect(() => {
    if (!client) return undefined;
    // Wake the public API while Supabase restores or verifies the session. The
    // request contains no credentials or customer data and overlaps the most
    // expensive part of a cold first sign-in.
    void prewarmApi();
    let active = true;
    let sessionId = 0;
    let currentUserId: string | null | undefined;
    let recoveryTimer: number | undefined;

    const applySession = async (nextUser: User | null) => {
      if (nextUser && recoveryTimer !== undefined) {
        window.clearTimeout(recoveryTimer);
        recoveryTimer = undefined;
      }
      if (nextUser && currentUserId === nextUser.id && hydratedUserRef.current === nextUser.id) {
        // TOKEN_REFRESHED and USER_UPDATED should refresh context without
        // restarting hydration or briefly covering the app with a loader.
        //
        // `hydratedUserRef` is what makes this safe. Testing only "same user"
        // meant that once currentUserId was set, hydration could be skipped
        // forever: a returning customer whose device cache is unreadable (the
        // cache key lives in sessionStorage and dies with the browser, while
        // the data lives in localStorage and survives) would load the app,
        // never call /workspace, and be shown "you have no cases" while their
        // workspace sat intact on the server. Verified in production: zero
        // /workspace requests, 27 local keys none of which decrypted, and 8.5KB
        // of real data at version 295 server-side.
        if (active) {
          setUser(nextUser);
          setState('ready');
        }
        return;
      }

      const requestId = ++sessionId;
      currentUserId = nextUser?.id ?? null;
      revokingRef.current = false;
      if (!nextUser) {
        // A token refresh or mobile tab suspension can briefly surface a null
        // session. Flush what we can, then keep the encrypted same-user cache
        // so the next verified session can resume without apparent data loss.
        await flushWorkspaceSync();
        pauseWorkspaceSync();
        if (!active || requestId !== sessionId) return;
        setUser(null);
        setState('ready');
        return;
      }

      const canResumeImmediately = canUseCachedWorkspace(nextUser.id);
      if (canResumeImmediately) {
        // A verified same-account cache makes return visits feel immediate.
        // Server hydration continues below and sync failures remain visible in
        // the app banner without hiding otherwise usable local data.
        setUser(nextUser);
        setState('ready');
      } else {
        setState('loading');
      }

      try {
        // If this is a cold deployment, finish waking it before the protected
        // workspace request. Recent/in-flight warm-ups are reused.
        await prewarmApi();
        await startWorkspaceSync(nextUser.id);
        if (!active || requestId !== sessionId) return;
        hydratedUserRef.current = nextUser.id;
        setUser(nextUser);
        setState('ready');
        const writable = await loadCanWrite();
        if (!active || requestId !== sessionId) return;
        setCanWrite(writable);
      } catch (error) {
        if (!active || requestId !== sessionId) return;
        hydratedUserRef.current = null;
        if (isWorkspaceAccessDeniedError(error)) {
          // Not a blip: the server said this account may not read the
          // workspace. Keeping a same-user cache visible here is exactly the
          // leak GAP-2-01 describes.
          setUser(nextUser);
          await revokeAccess();
          return;
        }
        if (canResumeImmediately) {
          setUser(nextUser);
          setState('ready');
        } else {
          setUser(null);
          setState('storage-error');
        }
      }
    };

    const recoverTransientSession = () => {
      if (recoveryTimer !== undefined) window.clearTimeout(recoveryTimer);
      pauseWorkspaceSync();
      setState('loading');
      console.info('[auth] Empty session observed; verifying persisted session before sign-out.');
      recoveryTimer = window.setTimeout(async () => {
        recoveryTimer = undefined;
        if (!active) return;
        try {
          const persisted = await client.auth.getSession();
          if (persisted.data.session?.user) {
            console.info('[auth] Session recovered from persisted state.');
            await applySession(persisted.data.session.user);
            return;
          }
          const refreshed = await client.auth.refreshSession();
          if (refreshed.data.session?.user) {
            console.info('[auth] Session recovered by token refresh.');
            await applySession(refreshed.data.session.user);
            return;
          }
        } catch {
          console.warn('[auth] Session recovery failed; authentication will be cleared.');
        }
        if (active) await applySession(null);
      }, AUTH_SESSION_RECOVERY_GRACE_MS);
    };

    // getSession() reads Supabase's persisted browser session immediately.
    // Every API call still validates its access token server-side; the UI does
    // not need to wait for an extra getUser() network round-trip on each visit.
    void client.auth.getSession().then(
      ({ data }) => {
        if (active) void applySession(data.session?.user ?? null);
      },
      () => {
        if (!active) return;
        setUser(null);
        setState('storage-error');
      },
    );

    const { data } = client.auth.onAuthStateChange((event, session) => {
      // getSession() above owns initial restoration. Handling INITIAL_SESSION
      // as well can race a transient null event and clear a valid local cache.
      if (event === 'INITIAL_SESSION') return;
      if (event === 'PASSWORD_RECOVERY') setRecoveringPassword(true);
      // Supabase holds an internal auth lock while this callback runs. Defer
      // workspace API calls so request() can safely read the refreshed token.
      if (!active) return;
      if (!session?.user && !explicitSignOutRef.current) {
        recoverTransientSession();
        return;
      }
      const nextUser = session?.user ?? null;
      window.setTimeout(() => void applySession(nextUser), 0);
    });

    return () => {
      active = false;
      if (recoveryTimer !== undefined) window.clearTimeout(recoveryTimer);
      data.subscription.unsubscribe();
    };
  }, [client]);

  const value = useMemo<AuthContextValue>(
    () => ({
      enabled: Boolean(client),
      user,
      canWrite,
      lastSignOut,
      async signIn(email, password) {
        if (!client) return false;
        const { error } = await client.auth.signInWithPassword({ email, password });
        return !error;
      },
      async signUp(email, password) {
        if (!client) return 'error';
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/app?firstRun=1`,
          },
        });
        if (error) return 'error';
        return data.session ? 'signed-in' : 'confirmation-required';
      },
      async resendSignUpConfirmation(email) {
        if (!client) return false;
        const { error } = await client.auth.resend({
          type: 'signup',
          email,
          options: {
            emailRedirectTo: `${window.location.origin}/app?firstRun=1`,
          },
        });
        return !error;
      },
      async requestMagicLink(email) {
        if (!client) return false;
        const { error } = await client.auth.signInWithOtp({
          email,
          options: {
            shouldCreateUser: false,
            // A passwordless link can also be the first successful entry for
            // an account whose email was just confirmed. Preserve the same
            // first-run intent as the sign-up confirmation flow so the user
            // lands in client onboarding instead of an empty client picker.
            emailRedirectTo: `${window.location.origin}/app?firstRun=1`,
          },
        });
        return !error;
      },
      async requestPasswordReset(email) {
        if (!client) return false;
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/app`,
        });
        return !error;
      },
      async updatePassword(password) {
        if (!client) return false;
        const { error } = await client.auth.updateUser({ password });
        if (!error) setRecoveringPassword(false);
        return !error;
      },
      async signOut(options) {
        // SEC-WEB-01: a refused flush used to come back as a bare `false` that
        // every caller ignored, so the customer pressed "sign out" and nothing
        // happened. The refusal is now a named result the button renders.
        if (!options?.discardUnsaved && !(await flushWorkspaceSync())) return 'unsaved-changes';
        explicitSignOutRef.current = true;
        const result = client ? await client.auth.signOut() : undefined;
        if (result?.error) {
          // The provider can fail to end a session that is already gone (an
          // expired refresh token, a revoked user). The device must still be
          // cleared in that case; only a session that truly persists is an
          // error the customer has to hear about.
          const persisted = client ? await client.auth.getSession().catch(() => null) : null;
          if (persisted?.data.session) {
            explicitSignOutRef.current = false;
            return 'error';
          }
        }
        hydratedUserRef.current = null;
        const stopped = await stopWorkspaceSync();
        setLastSignOut({ documentCacheCleared: stopped?.documentCacheCleared !== false });
        setCanWrite(true);
        setUser(null);
        setState('ready');
        explicitSignOutRef.current = false;
        return 'ok';
      },
      async retryDocumentCacheClear() {
        try {
          await clearLocalDocumentFileCache();
          setLastSignOut({ documentCacheCleared: true });
          return true;
        } catch {
          setLastSignOut({ documentCacheCleared: false });
          return false;
        }
      },
    }),
    [client, user, canWrite, lastSignOut],
  );

  if (state === 'configuration-required') return configurationRequired;
  if (state === 'storage-error') return storageUnavailable;
  if (state === 'access-revoked') {
    return (
      <AuthContext.Provider value={value}>
        {accessRevoked ?? (
          <AccessRevokedPage
            signOut={async () =>
              (await value.signOut({ discardUnsaved: true })) === 'ok' ? 'ok' : 'error'
            }
          />
        )}
      </AuthContext.Provider>
    );
  }
  /**
   * WEB-05: returning `loading` INSTEAD of `children` unmounted the whole
   * React subtree, and `recoverTransientSession()` sets state to 'loading'
   * on every momentary null session — which Supabase emits on token refresh
   * and when a mobile browser resumes a suspended tab. A user mid-way through
   * the payroll wizard lost everything typed, twice a day, for a blip that
   * recovers in 1.5 s.
   *
   * Once the app has been shown, a re-entry into 'loading' is therefore an
   * overlay, not a teardown. The cold start (nothing mounted yet) still
   * renders the loading screen, because there is nothing to preserve.
   */
  if (state === 'loading' && !hasMountedChildrenRef.current) return loading;
  if (state === 'ready' && user && recoveringPassword) {
    return <AuthContext.Provider value={value}>{passwordRecovery}</AuthContext.Provider>;
  }
  if (state === 'ready' && !user) {
    return <AuthContext.Provider value={value}>{login}</AuthContext.Provider>;
  }
  /**
   * One shape for both states, deliberately. Rendering the overlay from a
   * separate branch put `children` at a different depth in the two trees — bare
   * under the provider when ready, one <div> deeper while recovering — so React
   * reconciled them as different elements and unmounted the subtree on the way
   * in and again on the way out. That is the very teardown the overlay exists
   * to prevent, reintroduced by the markup that implements it. The host element
   * is therefore always present and only the notice is conditional, which keeps
   * every child's position in the tree, and so its state, unchanged.
   */
  return (
    <AuthContext.Provider value={value}>
      <div className="auth-recovery-overlay-host">
        {children}
        {state === 'loading' ? (
          <div className="auth-recovery-overlay" role="status" aria-live="polite">
            {sessionRecovering ?? loading}
          </div>
        ) : null}
      </div>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
