import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { getDeploymentEnvironment } from '../environment.js';

interface AuthContextValue {
  enabled: boolean;
  user: User | null;
  signIn(email: string, password: string): Promise<boolean>;
  signOut(): Promise<void>;
}

const defaultAuthContext: AuthContextValue = {
  enabled: false,
  user: null,
  signIn: async () => false,
  signOut: async () => undefined,
};

const AuthContext = createContext<AuthContextValue>(defaultAuthContext);

function createBrowserAuthClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return null;
  return createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });
}

export type AuthGateState = 'local-bypass' | 'configuration-required' | 'loading' | 'ready';

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
  loading,
}: {
  children: ReactNode;
  login: ReactNode;
  configurationRequired: ReactNode;
  loading: ReactNode;
}) {
  const [client] = useState(createBrowserAuthClient);
  const initialState = resolveAuthGateState(Boolean(client));
  const [state, setState] = useState<AuthGateState>(initialState);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (!client) return undefined;
    let active = true;

    void client.auth.getUser().then(({ data }) => {
      if (!active) return;
      setUser(data.user ?? null);
      setState('ready');
    });

    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setState('ready');
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
      async signOut() {
        if (client) await client.auth.signOut();
      },
    }),
    [client, user],
  );

  if (state === 'configuration-required') return configurationRequired;
  if (state === 'loading') return loading;
  if (state === 'ready' && !user) {
    return <AuthContext.Provider value={value}>{login}</AuthContext.Provider>;
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
