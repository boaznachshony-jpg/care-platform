import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { getDeploymentEnvironment } from '../environment.js';
import { getBrowserAuthClient } from './client.js';
import { startWorkspaceSync, stopWorkspaceSync } from '../storage/workspace-sync.js';

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
  children: ReactNode;
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
    let active = true;
    let hydrationId = 0;

    const applySession = async (nextUser: User | null) => {
      const requestId = ++hydrationId;
      setState('loading');
      if (!nextUser) {
        stopWorkspaceSync();
        if (!active || requestId !== hydrationId) return;
        setUser(null);
        setState('ready');
        return;
      }

      try {
        await startWorkspaceSync();
        if (!active || requestId !== hydrationId) return;
        setUser(nextUser);
        setState('ready');
      } catch {
        if (!active || requestId !== hydrationId) return;
        setUser(null);
        setState('storage-error');
      }
    };

    void client.auth.getUser().then(({ data }) => {
      if (active) void applySession(data.user ?? null);
    });

    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecoveringPassword(true);
      if (active) void applySession(session?.user ?? null);
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
