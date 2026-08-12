import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Pool } from 'pg';
import { runMigrations } from './migrate.js';

/**
 * End-to-end CI adapter for a disposable local PostgreSQL service.
 *
 * Vanilla PostgreSQL lacks Supabase's predefined roles, so this creates only
 * compatible NOLOGIN role names before applying the unchanged production
 * migrations. Data assertions still execute as caredesk_app/NOBYPASSRLS. The
 * loopback guard makes this unsuitable for shared or production databases.
 */
const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) {
  throw new Error('DATABASE_ADMIN_URL is required for the CI RLS check.');
}

const hostname = new URL(adminUrl).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
  throw new Error(`CI RLS check refuses non-loopback database host: ${hostname}`);
}

const admin = new Pool({ connectionString: adminUrl, ssl: false, max: 2 });
try {
  await admin.query(`
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

  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = resolve(here, '../../../database/migrations');
  const applied = await runMigrations(admin, migrationsDir);
  console.log(`CI database ready (${applied.length} migration(s) applied).`);
} finally {
  await admin.end();
}

process.env.DATABASE_URL = adminUrl;
process.env.RLS_TEST_MODE = 'ci-role-switch';
await import('./rls-check.js');
