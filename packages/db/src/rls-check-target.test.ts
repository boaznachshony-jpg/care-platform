import { describe, expect, it } from 'vitest';
import { assertRlsTestTargetIsSafe, connectionHost } from './rls-check-target.js';

const PRODUCTION_REF = 'abcdefghijklmnopqrst';
const STAGING_REF = 'uvwxyz0123456789abcd';

const supabaseUrl = (ref: string) =>
  `postgresql://postgres.${ref}:pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres`;

const LOCAL = 'postgres://caredesk:caredesk@localhost:5432/caredesk_dev';

const target = (url: string, source: Record<string, string | undefined>) => () =>
  assertRlsTestTargetIsSafe({
    connections: [
      { name: 'DATABASE_URL', url },
      { name: 'DATABASE_ADMIN_URL', url },
    ],
    source,
  });

describe('assertRlsTestTargetIsSafe', () => {
  it('refuses the production project ref even when every override is set', () => {
    // The script this guards deletes from sixteen tables over a BYPASSRLS
    // connection. No configuration may unlock that against customer data.
    expect(
      target(supabaseUrl(PRODUCTION_REF), {
        PRODUCTION_SUPABASE_PROJECT_REF: PRODUCTION_REF,
        CAREDESK_RLS_TEST_ALLOW_REMOTE: '1',
        CAREDESK_RLS_TEST_PROJECT_REF: PRODUCTION_REF,
      }),
    ).toThrow(/production Supabase project/);
  });

  it('refuses the production project through the direct-connection host too', () => {
    expect(
      target(`postgresql://postgres:pw@db.${PRODUCTION_REF}.supabase.co:5432/postgres`, {
        PRODUCTION_SUPABASE_PROJECT_REF: PRODUCTION_REF,
        CAREDESK_RLS_TEST_ALLOW_REMOTE: '1',
        CAREDESK_RLS_TEST_PROJECT_REF: PRODUCTION_REF,
      }),
    ).toThrow(/production Supabase project/);
  });

  it('allows a loopback database with no opt-in at all, so CI keeps working', () => {
    expect(target(LOCAL, {})).not.toThrow();
    expect(target('postgres://postgres@127.0.0.1:5432/db', {})).not.toThrow();
  });

  it('refuses any remote host without the explicit opt-in', () => {
    expect(target(supabaseUrl(STAGING_REF), {})).toThrow(/non-loopback database/);
  });

  it('refuses a remote run while the production ref is unknown', () => {
    // Without the production ref the first rule cannot fire, so the run cannot
    // be proved safe and must not be allowed on optimism.
    expect(
      target(supabaseUrl(STAGING_REF), {
        CAREDESK_RLS_TEST_ALLOW_REMOTE: '1',
        CAREDESK_RLS_TEST_PROJECT_REF: STAGING_REF,
      }),
    ).toThrow(/PRODUCTION_SUPABASE_PROJECT_REF is unset/);
  });

  it('requires the operator to state the expected ref, and to state it correctly', () => {
    expect(
      target(supabaseUrl(STAGING_REF), {
        PRODUCTION_SUPABASE_PROJECT_REF: PRODUCTION_REF,
        CAREDESK_RLS_TEST_ALLOW_REMOTE: '1',
      }),
    ).toThrow(/requires CAREDESK_RLS_TEST_PROJECT_REF/);

    expect(
      target(supabaseUrl(STAGING_REF), {
        PRODUCTION_SUPABASE_PROJECT_REF: PRODUCTION_REF,
        CAREDESK_RLS_TEST_ALLOW_REMOTE: '1',
        CAREDESK_RLS_TEST_PROJECT_REF: 'a-different-ref-entirely',
      }),
    ).toThrow(/expects a-different-ref-entirely/);
  });

  it('allows a fully declared non-production project', () => {
    expect(
      target(supabaseUrl(STAGING_REF), {
        PRODUCTION_SUPABASE_PROJECT_REF: PRODUCTION_REF,
        CAREDESK_RLS_TEST_ALLOW_REMOTE: '1',
        CAREDESK_RLS_TEST_PROJECT_REF: STAGING_REF,
      }),
    ).not.toThrow();
  });

  it('refuses when only one of the two connections is production', () => {
    expect(() =>
      assertRlsTestTargetIsSafe({
        connections: [
          { name: 'DATABASE_URL', url: LOCAL },
          { name: 'DATABASE_ADMIN_URL', url: supabaseUrl(PRODUCTION_REF) },
        ],
        source: { PRODUCTION_SUPABASE_PROJECT_REF: PRODUCTION_REF },
      }),
    ).toThrow(/DATABASE_ADMIN_URL points at the production Supabase project/);
  });
});

describe('connectionHost', () => {
  it('ignores a password containing an @ when locating the host', () => {
    expect(connectionHost('postgres://user:p@ss@localhost:5432/db')).toBe('localhost');
  });

  it('handles bracketed IPv6 and reports an unreadable authority as undefined', () => {
    expect(connectionHost('postgres://user@[::1]:5432/db')).toBe('::1');
    expect(connectionHost('')).toBeUndefined();
  });
});
