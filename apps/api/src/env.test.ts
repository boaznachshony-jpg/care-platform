import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

describe('loadEnv', () => {
  it('defaults to safe Milestone 0 values with an empty environment', () => {
    const env = loadEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.AI_PROVIDER).toBe('mock');
  });

  it('requires a valid workspace encryption key for a production database', () => {
    expect(() =>
      loadEnv({ NODE_ENV: 'production', DATABASE_URL: 'postgres://example.invalid/db' }),
    ).toThrow();
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://example.invalid/db',
        WORKSPACE_ENCRYPTION_KEY: 'not-a-key',
      }),
    ).toThrow();
    expect(
      loadEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://example.invalid/db',
        WORKSPACE_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
      }).WORKSPACE_ENCRYPTION_KEY,
    ).toBeTruthy();
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
    const primary = {
      NODE_ENV: 'production',
      SUPABASE_URL: 'https://primary.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
      SUPABASE_SERVICE_ROLE_KEY: 'primary-server-only',
      SUPABASE_STORAGE_BUCKET: 'private-documents',
    };
    expect(() => loadEnv(primary)).toThrow();
    expect(
      loadEnv({
        ...primary,
        BACKUP_SUPABASE_URL: 'https://backup.supabase.co',
        BACKUP_SUPABASE_SERVICE_ROLE_KEY: 'backup-server-only',
        BACKUP_SUPABASE_STORAGE_BUCKET: 'private-documents-backup',
      }).BACKUP_SUPABASE_STORAGE_BUCKET,
    ).toBe('private-documents-backup');
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
    expect(() => loadEnv({ NODE_ENV: 'production', BILLING_PROVIDER: 'mock' })).toThrow();
  });
});
