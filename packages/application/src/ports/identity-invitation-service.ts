export interface InvitedIdentity {
  authSubject: string;
}

/** Sends a provider-managed, one-time sign-in invitation. Credentials never pass through CareDesk. */
export interface IdentityInvitationService {
  invite(email: string): Promise<InvitedIdentity>;
}
