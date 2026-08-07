import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { prewarmApi } from '../api/client.js';
import { getDeploymentEnvironment } from '../environment.js';
import { getBrowserAuthClient } from './client.js';
import {
  canUseCachedWorkspace,
  startWorkspaceSync,
  stopWorkspaceSync,
} from '../storage/workspace-sync.js';

interface AuthContextValue {
  enabled: boolean;
  user: User | null;
  signIn(email: string, password: string): Promise<boolean>;
  signUp(email: string, password: string): Promise<'signed-in' | 'confirmation-required' | 'error'>;
  requestMagicLink(email: string): Promise<boolean>;
  requestPasswordReset(email: string): Promise<boolean>;
  updatePassword(password: string): Promise<boolean>;
  signOut(): Promise<void>;
}

const defaultAuthContext: AuthContextValue = {
  enabled: false,
  user: null,
  signIn: async () => false,
  signUp: async () => 'error',
  requestMagicLink: async () => false,
  requestPasswordReset: async () => false,
  updatePassword: async () => false,
  signOut: async () => undefined,
};

const AuthContext = createContext<AuthContextValue>(defaultAuthContext);

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

  useEffect(() => {
    if (!client) return undefined;
    // Wake the public API while Supabase restores or verifies the session. The
    // request contains no credentials or customer data and overlaps the most
    // expensive part of a cold first sign-in.
    void prewarmApi();
    let active = true;
    let sessionId = 0;
    let currentUserId: string | null | undefined;

    const applySession = async (nextUser: User | null) => {
      if (nextUser && currentUserId === nextUser.id) {
        // TOKEN_REFRESHED and USER_UPDATED should refresh context without
        // restarting hydration or briefly covering the app with a loader.
        if (active) setUser(nextUser);
        return;
      }

      const requestId = ++sessionId;
      currentUserId = nextUser?.id ?? null;
      if (!nextUser) {
        stopWorkspaceSync();
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
      if (active) window.setTimeout(() => void applySession(session?.user ?? null), 0);
    });

    return () => {
      active = false;
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
        if (client) await client.auth.signOut();
        stopWorkspaceSync();
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
