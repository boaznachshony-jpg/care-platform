import { describe, expect, it } from 'vitest';
import { extractSupabaseProjectRef, pointsAtProject } from './supabase-project-ref.js';

const REF = 'abcdefghijklmnopqrst';

describe('extractSupabaseProjectRef', () => {
  it('reads the ref from every shape the same project is handed out as', () => {
    // A guard that recognised only one of these would wave the others through,
    // which is the whole failure mode it exists to prevent.
    expect(
      extractSupabaseProjectRef(
        `postgresql://postgres.${REF}:pw@aws-1-eu-central-1.pooler.supabase.com:6543/postgres`,
      ),
    ).toBe(REF);
    expect(
      extractSupabaseProjectRef(
        `postgresql://caredesk_app.${REF}:pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres`,
      ),
    ).toBe(REF);
    expect(
      extractSupabaseProjectRef(`postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`),
    ).toBe(REF);
    expect(extractSupabaseProjectRef(`https://${REF}.supabase.co`)).toBe(REF);
  });

  it('is not defeated by case or by a password holding URL metacharacters', () => {
    expect(
      extractSupabaseProjectRef(
        `postgresql://postgres.${REF.toUpperCase()}:p#w/d@aws-1-eu-central-1.pooler.supabase.com:6543/postgres`,
      ),
    ).toBe(REF);
  });

  it('returns undefined for targets that are not a Supabase project', () => {
    expect(
      extractSupabaseProjectRef('postgres://caredesk:caredesk@localhost:5432/caredesk_dev'),
    ).toBeUndefined();
    expect(extractSupabaseProjectRef('')).toBeUndefined();
    // The pooler host itself must never be mistaken for a ref.
    expect(
      extractSupabaseProjectRef(
        'postgresql://postgres:pw@aws-1-eu-central-1.pooler.supabase.com/postgres',
      ),
    ).toBeUndefined();
  });
});

describe('pointsAtProject', () => {
  it('matches a ref across differing connection shapes', () => {
    expect(pointsAtProject(`https://${REF}.supabase.co`, REF.toUpperCase())).toBe(true);
    expect(pointsAtProject(`https://${REF}.supabase.co`, 'zzzzzzzzzzzzzzzzzzzz')).toBe(false);
  });

  it('never matches when the target has no readable ref', () => {
    expect(pointsAtProject('postgres://localhost:5432/db', REF)).toBe(false);
  });
});
