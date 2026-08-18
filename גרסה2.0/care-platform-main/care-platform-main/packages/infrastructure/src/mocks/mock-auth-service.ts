import type { AuthService, AuthSession } from '@caredesk/application';

/**
 * Deterministic stand-in for Supabase Auth (ADR-001). Sessions are seeded
 * in-memory, keyed by an opaque bearer token — no real credential handling.
 */
export class MockAuthService implements AuthService {
  private readonly sessionsByToken = new Map<string, AuthSession>();

  seedSession(token: string, session: AuthSession): void {
    this.sessionsByToken.set(token, session);
  }

  async verifySession(token: string): Promise<AuthSession | null> {
    const session = this.sessionsByToken.get(token);
    if (!session) {
      return null;
    }
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      return null;
    }
    return session;
  }
}
