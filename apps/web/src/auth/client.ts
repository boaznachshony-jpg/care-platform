import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let browserAuthClient: SupabaseClient | null | undefined;

/** One browser client shared by the login gate and every API request. */
export function getBrowserAuthClient(): SupabaseClient | null {
  if (browserAuthClient !== undefined) return browserAuthClient;

  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) {
    browserAuthClient = null;
    return browserAuthClient;
  }

  browserAuthClient = createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });
  return browserAuthClient;
}

/** Used only by unit tests to isolate the module-level browser client. */
export function resetBrowserAuthClientForTests(): void {
  browserAuthClient = undefined;
}
