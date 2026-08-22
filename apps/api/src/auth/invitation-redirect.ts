/**
 * Where an invited family member lands after accepting the invitation.
 *
 * This used to be "whatever happens to be first in CORS_ORIGINS", which made a
 * production behaviour depend on the ORDER of an unrelated list. When the
 * custom domain was added, localhost became the first entry - so every
 * invitation in production was sent with redirect_to=http://localhost:5173/app.
 * Supabase rejects a redirect target that is not on its allow-list, the invite
 * call came back 4xx, and the person inviting was told the email service had
 * failed. The email service was fine.
 *
 * The rule is now explicit rather than incidental: use the configured URL if
 * there is one, otherwise the first real https origin, and never a loopback
 * address outside development.
 */
export function resolveInvitationRedirect(input: {
  familyInviteRedirectUrl?: string;
  corsOrigins: string;
  nodeEnv: string;
}): string {
  if (input.familyInviteRedirectUrl) return input.familyInviteRedirectUrl;

  const origins = input.corsOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const isLoopback = (origin: string) =>
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(origin);
  const preferred =
    origins.find((origin) => origin.startsWith('https://') && !isLoopback(origin)) ??
    (input.nodeEnv === 'production' ? undefined : origins[0]);

  if (!preferred) {
    // Failing at startup is better than sending invitations that can never be
    // accepted and then blaming the email provider for it.
    throw new Error(
      'FAMILY_INVITE_REDIRECT_URL is required in production: CORS_ORIGINS contains no https origin to fall back to.',
    );
  }
  return `${preferred.replace(/\/+$/, '')}/app`;
}
