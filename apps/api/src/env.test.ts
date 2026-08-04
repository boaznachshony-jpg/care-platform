import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

describe('loadEnv', () => {
  it('defaults to safe Milestone 0 values with an empty environment', () => {
    const env = loadEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.AI_PROVIDER).toBe('mock');
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

  it('keeps product billing disabled and fully sponsored by default', () => {
    const env = loadEnv({});
    expect(env.BILLING_PROVIDER).toBe('disabled');
    expect(env.BILLING_PRICE_AGOROT).toBe(3900);
    expect(env.BILLING_VAT_RATE_BPS).toBe(1800);
    expect(env.BILLING_LAUNCH_DISCOUNT_PERCENT).toBe(100);
  });

  it('requires every server-only Cardcom credential and forbids a production mock', () => {
    expect(() => loadEnv({ BILLING_PROVIDER: 'cardcom' })).toThrow();
    expect(() => loadEnv({ NODE_ENV: 'production', BILLING_PROVIDER: 'mock' })).toThrow();
  });
});
