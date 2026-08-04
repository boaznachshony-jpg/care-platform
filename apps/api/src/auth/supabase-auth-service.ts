import type { AuthService, AuthSession } from '@caredesk/application';

interface SupabaseUserResponse {
  id?: unknown;
  last_sign_in_at?: unknown;
}

interface JwtClaims {
  iat?: unknown;
  exp?: unknown;
  aal?: unknown;
}

interface FetchResponseLike {
  readonly ok: boolean;
  json(): Promise<unknown>;
}

type FetchLike = (input: string, init?: Record<string, unknown>) => Promise<FetchResponseLike>;

function readClaims(token: string): JwtClaims {
  try {
    const encoded = token.split('.')[1];
    if (!encoded) return {};
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as JwtClaims;
  } catch {
    return {};
  }
}

function isoFromEpoch(value: unknown, fallback: Date): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : fallback.toISOString();
}

/**
 * Validates a bearer token against Supabase Auth's `/auth/v1/user` endpoint.
 * Identity is taken only from that verified response; decoded JWT fields are
 * used for session timestamps/MFA metadata, never as proof of identity.
 */
export class SupabaseAuthService implements AuthService {
  constructor(
    private readonly supabaseUrl: string,
    private readonly publishableKey: string,
    private readonly fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
  ) {}

  async verifySession(token: string): Promise<AuthSession | null> {
    if (!token) return null;

    let response: FetchResponseLike;
    try {
      response = await this.fetchImpl(`${this.supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
        method: 'GET',
        headers: {
          apikey: this.publishableKey,
          authorization: `Bearer ${token}`,
        },
      });
    } catch {
      return null;
    }

    if (!response.ok) return null;
    const user = (await response.json().catch(() => null)) as SupabaseUserResponse | null;
    if (!user || typeof user.id !== 'string' || !user.id) return null;

    const now = new Date();
    const claims = readClaims(token);
    const lastSignIn = typeof user.last_sign_in_at === 'string' ? user.last_sign_in_at : null;

    return {
      // Supabase's user id is the provider subject. PgActorResolver maps it to
      // the internal app_user id before any authorization check occurs.
      userId: user.id,
      authSubject: user.id,
      issuedAt: isoFromEpoch(claims.iat, lastSignIn ? new Date(lastSignIn) : now),
      expiresAt: isoFromEpoch(claims.exp, now),
      mfaSatisfied: claims.aal === 'aal2',
    };
  }
}
