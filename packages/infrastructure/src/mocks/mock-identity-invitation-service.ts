import type { IdentityInvitationService, InvitedIdentity } from '@caredesk/application';

/** Deterministic, delivery-free invitation provider for local development and tests. */
export class MockIdentityInvitationService implements IdentityInvitationService {
  readonly invitedEmails: string[] = [];

  async invite(email: string): Promise<InvitedIdentity> {
    this.invitedEmails.push(email);
    return { authSubject: `synthetic-invite:${email.toLowerCase()}` };
  }
}
