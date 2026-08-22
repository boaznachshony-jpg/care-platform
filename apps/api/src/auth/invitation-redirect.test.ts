import { describe, expect, it } from 'vitest';
import { resolveInvitationRedirect } from './invitation-redirect.js';

/** Mirrors the CORS_ORIGINS default in env.ts: canonical domain first. */
const PRODUCTION_ORIGINS =
  'https://caredesk-isr.com,https://www.caredesk-isr.com,https://care-platform-web.vercel.app,http://localhost:5173';

describe('resolveInvitationRedirect', () => {
  it('never sends production invitations to localhost', () => {
    // The regression this test exists for: the redirect used to be the first
    // entry of CORS_ORIGINS. Adding the custom domain put localhost first, so
    // every production invitation carried redirect_to=http://localhost:5173/app.
    // Supabase rejected it, and the UI reported an email delivery failure.
    const redirect = resolveInvitationRedirect({
      corsOrigins: PRODUCTION_ORIGINS,
      nodeEnv: 'production',
    });
    expect(redirect).not.toMatch(/localhost|127\.0\.0\.1/);
    expect(redirect).toBe('https://caredesk-isr.com/app');
  });

  it('honours an explicitly configured redirect above everything else', () => {
    expect(
      resolveInvitationRedirect({
        familyInviteRedirectUrl: 'https://caredesk-isr.com/app',
        corsOrigins: PRODUCTION_ORIGINS,
        nodeEnv: 'production',
      }),
    ).toBe('https://caredesk-isr.com/app');
  });

  it('is not sensitive to the order of CORS_ORIGINS', () => {
    // The point of the fix: reordering an unrelated list must not change where
    // an invited family member lands.
    const reordered = 'https://caredesk-isr.com,http://localhost:5173';
    const original = 'http://localhost:5173,https://caredesk-isr.com';
    expect(resolveInvitationRedirect({ corsOrigins: reordered, nodeEnv: 'production' })).toBe(
      resolveInvitationRedirect({ corsOrigins: original, nodeEnv: 'production' }),
    );
  });

  it('still allows a local origin during development', () => {
    expect(
      resolveInvitationRedirect({
        corsOrigins: 'http://localhost:5173',
        nodeEnv: 'development',
      }),
    ).toBe('http://localhost:5173/app');
  });

  it('refuses to start in production rather than send an invitation that cannot be accepted', () => {
    expect(() =>
      resolveInvitationRedirect({ corsOrigins: 'http://localhost:5173', nodeEnv: 'production' }),
    ).toThrow(/FAMILY_INVITE_REDIRECT_URL is required in production/);
  });

  it('does not produce a double slash when an origin has a trailing slash', () => {
    expect(
      resolveInvitationRedirect({
        corsOrigins: 'https://caredesk-isr.com/',
        nodeEnv: 'production',
      }),
    ).toBe('https://caredesk-isr.com/app');
  });
});
