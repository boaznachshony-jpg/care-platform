import type { IdentityInvitationService, InvitedIdentity } from '@caredesk/application';

interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<FetchResponseLike>;

interface SupabaseInvitedUser {
  id?: unknown;
}

/**
 * Supabase Auth answers 422 to an invitation for an e-mail that already has an
 * account. Surfaced as its own type so the route can say "this person already
 * has a CareDesk account" instead of blaming the e-mail provider (UI-NAV-02).
 * Carries no address: the message must stay safe to log.
 */
export class IdentityAlreadyRegisteredError extends Error {
  constructor() {
    super('Identity invitation refused: the e-mail address is already registered.');
    this.name = 'IdentityAlreadyRegisteredError';
  }
}

/** Server-only Supabase Admin invitation. The service-role key never reaches the browser. */
export class SupabaseInvitationService implements IdentityInvitationService {
  constructor(
    private readonly supabaseUrl: string,
    private readonly serviceRoleKey: string,
    private readonly redirectTo: string,
    private readonly fetchImpl: FetchLike = (input, init) =>
      fetch(input, init) as unknown as Promise<FetchResponseLike>,
  ) {}

  async invite(email: string): Promise<InvitedIdentity> {
    const endpoint = new URL('/auth/v1/invite', this.supabaseUrl);
    endpoint.searchParams.set('redirect_to', this.redirectTo);
    const response = await this.fetchImpl(endpoint.toString(), {
      method: 'POST',
      headers: {
        apikey: this.serviceRoleKey,
        authorization: `Bearer ${this.serviceRoleKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });
    if (response.status === 422) throw new IdentityAlreadyRegisteredError();
    if (!response.ok) {
      throw new Error(`Identity invitation failed with status ${response.status}.`);
    }
    const body = (await response.json()) as SupabaseInvitedUser;
    if (typeof body.id !== 'string' || body.id.length === 0) {
      throw new Error('Identity invitation did not return a user subject.');
    }
    return { authSubject: body.id };
  }
}
