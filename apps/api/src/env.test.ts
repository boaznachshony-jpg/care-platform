import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const PRODUCTION_REF = 'abcdefghijklmnopqrst';
const PRODUCTION_DATABASE_URL = `postgresql://caredesk_app.${PRODUCTION_REF}:pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres`;
const PREVIEW_DATABASE_URL =
  'postgresql://caredesk_app.uvwxyz0123456789abcd:pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres';

/**
 * Everything production requires before it is allowed to boot, so that a test
 * about one rule is not accidentally satisfied - or failed - by another.
 */
const productionBaseline = {
  NODE_ENV: 'production',
  DATABASE_URL: PRODUCTION_DATABASE_URL,
  WORKSPACE_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  SUPABASE_URL: 'https://primary.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
  SUPABASE_SERVICE_ROLE_KEY: 'primary-server-only',
  SUPABASE_STORAGE_BUCKET: 'private-documents',
  BACKUP_SUPABASE_URL: 'https://backup.supabase.co',
  BACKUP_SUPABASE_SERVICE_ROLE_KEY: 'backup-server-only',
  BACKUP_SUPABASE_STORAGE_BUCKET: 'private-documents-backup',
} as const;

describe('loadEnv', () => {
  it('defaults to safe Milestone 0 values with an empty environment', () => {
    const env = loadEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.AI_PROVIDER).toBe('mock');
  });

  it('requires a valid workspace encryption key for a production database', () => {
    const { WORKSPACE_ENCRYPTION_KEY: _omitted, ...withoutKey } = productionBaseline;
    expect(() => loadEnv(withoutKey)).toThrow('WORKSPACE_ENCRYPTION_KEY');
    expect(() => loadEnv({ ...productionBaseline, WORKSPACE_ENCRYPTION_KEY: 'not-a-key' })).toThrow(
      'WORKSPACE_ENCRYPTION_KEY',
    );
    expect(loadEnv(productionBaseline).WORKSPACE_ENCRYPTION_KEY).toBeTruthy();
  });

  it('refuses to start a production deployment that would use the in-memory repositories', () => {
    // DB-03. Each of these settings silently degrades to a mock or an
    // in-process array when absent; readiness() reported that and gated
    // nothing. Absence must now be a boot failure.
    for (const field of [
      'DATABASE_URL',
      'SUPABASE_URL',
      'SUPABASE_PUBLISHABLE_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_STORAGE_BUCKET',
    ] as const) {
      const { [field]: _omitted, ...rest } = productionBaseline;
      expect(() => loadEnv(rest), `${field} must be required in production`).toThrow(field);
    }
    expect(() => loadEnv(productionBaseline)).not.toThrow();
  });

  it('refuses to start a preview deployment pointed at the production database', () => {
    // REL-02 / DR-08. The only thing separating a preview build from customer
    // data is a Vercel dashboard setting, which has no test and no diff.
    expect(() =>
      loadEnv({
        ...productionBaseline,
        VERCEL: '1',
        VERCEL_ENV: 'preview',
        PRODUCTION_SUPABASE_PROJECT_REF: PRODUCTION_REF,
      }),
    ).toThrow(/points at the production Supabase project/);
  });

  it('refuses a non-production deployment that cannot prove its database is not production', () => {
    // Fail closed: an unset PRODUCTION_SUPABASE_PROJECT_REF would otherwise
    // disarm the check above the first time somebody forgets one variable.
    expect(() => loadEnv({ ...productionBaseline, VERCEL: '1', VERCEL_ENV: 'preview' })).toThrow(
      /PRODUCTION_SUPABASE_PROJECT_REF is not set/,
    );
  });

  it('refuses a laptop pointed at the production database', () => {
    expect(() =>
      loadEnv({ ...productionBaseline, PRODUCTION_SUPABASE_PROJECT_REF: PRODUCTION_REF }),
    ).toThrow(/from a local deployment/);
  });

  it('lets production hold the production database, and previews hold their own', () => {
    expect(() =>
      loadEnv({
        ...productionBaseline,
        VERCEL: '1',
        VERCEL_ENV: 'production',
        PRODUCTION_SUPABASE_PROJECT_REF: PRODUCTION_REF,
      }),
    ).not.toThrow();
    expect(() =>
      loadEnv({
        ...productionBaseline,
        DATABASE_URL: PREVIEW_DATABASE_URL,
        VERCEL: '1',
        VERCEL_ENV: 'preview',
        PRODUCTION_SUPABASE_PROJECT_REF: PRODUCTION_REF,
      }),
    ).not.toThrow();
  });

  it('leaves a local run with no database and no production ref alone', () => {
    expect(() => loadEnv({})).not.toThrow();
    expect(() =>
      loadEnv({ DATABASE_URL: 'postgres://caredesk:caredesk@localhost:5432/caredesk_dev' }),
    ).not.toThrow();
  });

  it('rejects an AI_PROVIDER value outside the approved set', () => {
    expect(() => loadEnv({ AI_PROVIDER: 'some-other-vendor' })).toThrow();
  });

  it('requires the Supabase URL and publishable key together', () => {
    expect(() => loadEnv({ SUPABASE_URL: 'https://project.supabase.co' })).toThrow();
    expect(() => loadEnv({ SUPABASE_PUBLISHABLE_KEY: 'publishable-key' })).toThrow();
    expect(
      loadEnv({
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
      }).SUPABASE_URL,
    ).toBe('https://project.supabase.co');
  });

  it('requires private storage credentials and bucket together', () => {
    expect(() => loadEnv({ SUPABASE_SERVICE_ROLE_KEY: 'server-only' })).toThrow();
    expect(() => loadEnv({ SUPABASE_STORAGE_BUCKET: 'private-documents' })).toThrow();
  });

  it('requires an independent backup whenever production document storage is enabled', () => {
    const {
      BACKUP_SUPABASE_URL: _url,
      BACKUP_SUPABASE_SERVICE_ROLE_KEY: _key,
      BACKUP_SUPABASE_STORAGE_BUCKET: _bucket,
      ...withoutBackup
    } = productionBaseline;
    expect(() => loadEnv(withoutBackup)).toThrow('BACKUP_SUPABASE_URL');
    expect(loadEnv(productionBaseline).BACKUP_SUPABASE_STORAGE_BUCKET).toBe(
      'private-documents-backup',
    );
  });

  it('keeps product billing disabled and fully sponsored by default', () => {
    const env = loadEnv({});
    expect(env.BILLING_PROVIDER).toBe('disabled');
    expect(env.BILLING_PRICE_AGOROT).toBe(3900);
    expect(env.BILLING_VAT_RATE_BPS).toBe(1800);
    expect(env.BILLING_LAUNCH_DISCOUNT_PERCENT).toBe(100);
    expect(env.BILLING_GRACE_DAYS).toBe(7);
  });

  it('requires all server-only support delivery settings together', () => {
    expect(() =>
      loadEnv({ SUPPORT_DESTINATION_EMAIL: 'private-destination@example.com' }),
    ).toThrow();
    expect(
      loadEnv({
        SUPPORT_DESTINATION_EMAIL: 'private-destination@example.com',
        SUPPORT_FROM_EMAIL: 'support@example.com',
        RESEND_API_KEY: 'server-only-key',
      }).SUPPORT_DESTINATION_EMAIL,
    ).toBe('private-destination@example.com');
  });

  it('requires every server-only Cardcom credential and forbids a production mock', () => {
    expect(() => loadEnv({ BILLING_PROVIDER: 'cardcom' })).toThrow();
    expect(() => loadEnv({ ...productionBaseline, BILLING_PROVIDER: 'mock' })).toThrow(
      'BILLING_PROVIDER',
    );
  });
});
