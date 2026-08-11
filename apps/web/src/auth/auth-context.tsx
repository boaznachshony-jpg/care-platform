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
import { prewarmApi } from '../api/client.js';
import { getDeploymentEnvironment } from '../environment.js';
import { getBrowserAuthClient } from './client.js';
import {
  canUseCachedWorkspace,
  flushWorkspaceSync,
  pauseWorkspaceSync,
  startWorkspaceSync,
  stopWorkspaceSync,
} from '../storage/workspace-sync.js';

interface AuthContextValue {
  enabled: boolean;
  user: User | null;
  signIn(email: string, password: string): Promise<boolean>;
  signUp(email: string, password: string): Promise<'signed-in' | 'confirmation-required' | 'error'>;
  resendSignUpConfirmation(email: string): Promise<boolean>;
  requestMagicLink(email: string): Promise<boolean>;
  requestPasswordReset(email: string): Promise<boolean>;
  updatePassword(password: string): Promise<boolean>;
  signOut(): Promise<boolean>;
}

const defaultAuthContext: AuthContextValue = {
  enabled: false,
  user: null,
  signIn: async () => false,
  signUp: async () => 'error',
  resendSignUpConfirmation: async () => false,
  requestMagicLink: async () => false,
  requestPasswordReset: async () => false,
  updatePassword: async () => false,
  signOut: async () => true,
};

const AuthContext = createContext<AuthContextValue>(defaultAuthContext);
export const AUTH_SESSION_RECOVERY_GRACE_MS = 1_500;

export type AuthGateState =
  'local-bypass' | 'configuration-required' | 'storage-error' | 'loading' | 'ready';

export function resolveAuthGateState(
  hasClient: boolean,
  environment = getDeploymentEnvironment(),
): AuthGateState {
  if (environment === 'local' && !hasClient) return 'local-bypass';
  if (!hasClient) return 'configuration-required';
  return 'loading';
}

export function AuthProvider({
  children,
  login,
  configurationRequired,
  storageUnavailable,
  passwordRecovery,
  loading,
}: {
  children?: ReactNode;
  login: ReactNode;
  configurationRequired: ReactNode;
  storageUnavailable: ReactNode;
  passwordRecovery: ReactNode;
  loading: ReactNode;
}) {
  const [client] = useState(getBrowserAuthClient);
  const initialState = resolveAuthGateState(Boolean(client));
  const [state, setState] = useState<AuthGateState>(initialState);
  const [user, setUser] = useState<User | null>(null);
  const [recoveringPassword, setRecoveringPassword] = useState(false);
  const explicitSignOutRef = useRef(false);

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
      if (nextUser && currentUserId === nextUser.id) {
        // TOKEN_REFRESHED and USER_UPDATED should refresh context without
        // restarting hydration or briefly covering the app with a loader.
        if (active) {
          setUser(nextUser);
          setState('ready');
        }
        return;
      }

      const requestId = ++sessionId;
      currentUserId = nextUser?.id ?? null;
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
        setUser(nextUser);
        setState('ready');
      } catch {
        if (!active || requestId !== sessionId) return;
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
            emailRedirectTo: `${window.location.origin}/app`,
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
      async signOut() {
        if (!(await flushWorkspaceSync())) return false;
        explicitSignOutRef.current = true;
        const result = client ? await client.auth.signOut() : undefined;
        if (result?.error) {
          explicitSignOutRef.current = false;
          return false;
        }
        stopWorkspaceSync();
        setUser(null);
        setState('ready');
        explicitSignOutRef.current = false;
        return true;
      },
    }),
    [client, user],
  );

  if (state === 'configuration-required') return configurationRequired;
  if (state === 'storage-error') return storageUnavailable;
  if (state === 'loading') return loading;
  if (state === 'ready' && user && recoveringPassword) {
    return <AuthContext.Provider value={value}>{passwordRecovery}</AuthContext.Provider>;
  }
  if (state === 'ready' && !user) {
    return <AuthContext.Provider value={value}>{login}</AuthContext.Provider>;
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
