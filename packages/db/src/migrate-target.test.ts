import { describe, expect, it } from 'vitest';
import { assertMigrationTargetIsAllowed } from './migrate-target.js';

const PRODUCTION_REF = 'abcdefghijklmnopqrst';
const STAGING_REF = 'uvwxyz0123456789abcd';

const supabaseUrl = (ref: string) =>
  `postgresql://postgres.${ref}:pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres`;

const LOCAL = 'postgres://caredesk:caredesk@localhost:5432/caredesk_dev';

const target = (url: string, source: Record<string, string | undefined>) => () =>
  assertMigrationTargetIsAllowed({ name: 'DATABASE_ADMIN_URL', url, source });

describe('assertMigrationTargetIsAllowed', () => {
  it('allows a loopback database with no configuration at all', () => {
    expect(target(LOCAL, {})).not.toThrow();
    expect(target('postgres://u:p@127.0.0.1:5432/db', {})).not.toThrow();
  });

  it('refuses a remote target while the production ref is unknown', () => {
    // Without PRODUCTION_SUPABASE_PROJECT_REF the runner cannot tell the
    // customer's database from a sandbox, so it must not guess.
    expect(target(supabaseUrl(STAGING_REF), {})).toThrow(
      /PRODUCTION_SUPABASE_PROJECT_REF is unset/,
    );
  });

  it('requires the operator to state which project they expect', () => {
    expect(
      target(supabaseUrl(STAGING_REF), { PRODUCTION_SUPABASE_PROJECT_REF: PRODUCTION_REF }),
    ).toThrow(/requires CAREDESK_MIGRATE_PROJECT_REF/);
  });

  it('refuses when the stated ref and the connection string disagree', () => {
    // This is the .env.local left open in the other window: the operator
    // believes they are migrating staging and the URL says production.
    expect(
      target(supabaseUrl(PRODUCTION_REF), {
        PRODUCTION_SUPABASE_PROJECT_REF: PRODUCTION_REF,
        CAREDESK_MIGRATE_PROJECT_REF: STAGING_REF,
      }),
    ).toThrow(new RegExp(`resolves to project ref ${PRODUCTION_REF}`));
  });

  it('refuses production even when the operator typed the production ref', () => {
    expect(
      target(supabaseUrl(PRODUCTION_REF), {
        PRODUCTION_SUPABASE_PROJECT_REF: PRODUCTION_REF,
        CAREDESK_MIGRATE_PROJECT_REF: PRODUCTION_REF,
      }),
    ).toThrow(/refuses to migrate production/);
  });

  it('allows production once the second, separate opt-in is present', () => {
    // Unlike db:rls-test, migrating production is legitimate. The guard exists
    // to make it deliberate, not to make it impossible.
    expect(
      target(supabaseUrl(PRODUCTION_REF), {
        PRODUCTION_SUPABASE_PROJECT_REF: PRODUCTION_REF,
        CAREDESK_MIGRATE_PROJECT_REF: PRODUCTION_REF,
        CAREDESK_MIGRATE_ALLOW_PRODUCTION: '1',
      }),
    ).not.toThrow();
  });

  it('allows a named non-production project without the production opt-in', () => {
    expect(
      target(supabaseUrl(STAGING_REF), {
        PRODUCTION_SUPABASE_PROJECT_REF: PRODUCTION_REF,
        CAREDESK_MIGRATE_PROJECT_REF: STAGING_REF,
      }),
    ).not.toThrow();
  });

  it('treats an unreadable host as remote rather than as local', () => {
    // A connection string the host parser cannot classify must never earn the
    // loopback exemption by accident.
    expect(target('not-a-connection-string', {})).toThrow(/PRODUCTION_SUPABASE_PROJECT_REF/);
  });

  it('returns the resolved ref so the caller can print the target', () => {
    expect(
      assertMigrationTargetIsAllowed({
        name: 'DATABASE_ADMIN_URL',
        url: supabaseUrl(STAGING_REF),
        source: {
          PRODUCTION_SUPABASE_PROJECT_REF: PRODUCTION_REF,
          CAREDESK_MIGRATE_PROJECT_REF: STAGING_REF,
        },
      }),
    ).toBe(STAGING_REF);
  });
});
