import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Pool } from 'pg';
import { runMigrations } from './migrate.js';
import { ensureSupabaseCompatibilityRoles } from './ci-postgres-roles.js';
import { assertRlsTestTargetIsSafe } from './rls-check-target.js';

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

// The loopback check above is host-shaped and the shared guard is project-ref
// shaped; they fail on different mistakes. This adapter runs migrations before
// it delegates to rls-check.ts, so it needs its own copy of the ref check
// rather than inheriting the one that runs later.
assertRlsTestTargetIsSafe({
  connections: [{ name: 'DATABASE_ADMIN_URL', url: adminUrl }],
  source: process.env,
});

const admin = new Pool({ connectionString: adminUrl, ssl: false, max: 2 });
try {
  await ensureSupabaseCompatibilityRoles(admin);

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
