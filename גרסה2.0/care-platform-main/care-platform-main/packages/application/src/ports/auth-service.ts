/**
 * Port for ADR-001 (Supabase Auth). Establishes identity only — it answers
 * "who is this," never "what may they do." See AuthorizationService for
 * the deny-by-default access decision (Constitution §18).
 */
export interface AuthSession {
  userId: string;
  authSubject: string;
  issuedAt: string;
  expiresAt: string;
  mfaSatisfied: boolean;
}

export interface AuthService {
  verifySession(token: string): Promise<AuthSession | null>;
}
