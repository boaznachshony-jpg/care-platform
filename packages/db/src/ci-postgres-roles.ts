import type { Pool } from 'pg';

/**
 * Vanilla PostgreSQL lacks the roles Supabase predefines, so the unchanged
 * production migrations cannot be applied to a bare container until these
 * exist. They are created NOLOGIN: they carry grants so the migrations'
 * `grant ... to caredesk_app` statements resolve, and nothing can connect as
 * them.
 *
 * Shared by both CI harnesses that migrate a disposable container - the RLS
 * check and the idempotency check - so the two cannot drift into disagreeing
 * about what a fresh database looks like.
 */
export async function ensureSupabaseCompatibilityRoles(pool: Pool): Promise<void> {
  await pool.query(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'postgres') then
        create role postgres nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
      end if;
    end
    $$;
  `);
}
