import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Pool } from 'pg';
import { runMigrations } from './migrate.js';
import { ensureSupabaseCompatibilityRoles } from './ci-postgres-roles.js';

/**
 * The check that would have caught the whole class.
 *
 * On 2026-08-30 `pnpm db:migrate` had been unusable for a day: three
 * migrations never inserted their own row into `schema_migrations`, so every
 * run after the first re-executed them and died on
 * `create table ... already exists`. CI never saw it, because CI migrated a
 * fresh container exactly once - and applying migrations once to an empty
 * database is the one scenario in which the bug is invisible.
 *
 * So this runs `runMigrations` twice against the same container and asserts
 * the second call applies nothing. Any migration that fails to record itself,
 * by any mechanism, fails here on the pull request rather than on the one
 * database that matters.
 *
 * The third call is a dry run: it asserts the planner and the applier agree
 * about what is pending, so `--dry-run` cannot quietly become a lie.
 */
const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) {
  throw new Error('DATABASE_ADMIN_URL is required for the migration idempotency check.');
}

const hostname = new URL(adminUrl).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
  throw new Error(`Migration idempotency check refuses non-loopback database host: ${hostname}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../../../database/migrations');

const admin = new Pool({ connectionString: adminUrl, ssl: false, max: 2 });
try {
  await ensureSupabaseCompatibilityRoles(admin);

  const first = await runMigrations(admin, migrationsDir);
  if (first.length === 0) {
    throw new Error(
      'The first run applied no migrations. This check requires a fresh database; the container ' +
        'it was pointed at already has a schema_migrations ledger.',
    );
  }
  console.log(`First run applied ${first.length} migration(s).`);

  const second = await runMigrations(admin, migrationsDir);
  if (second.length > 0) {
    throw new Error(
      `Migrations are not idempotent. The second run re-applied ${second.length} migration(s): ` +
        `${second.join(', ')}. Every applied migration must be recorded in schema_migrations ` +
        `inside its own transaction - see packages/db/src/migrate.ts.`,
    );
  }
  console.log('Second run applied nothing. Migrations are idempotent.');

  const planned = await runMigrations(admin, migrationsDir, { dryRun: true });
  if (planned.length > 0) {
    throw new Error(
      `--dry-run reports ${planned.length} pending migration(s) on a fully migrated database: ` +
        `${planned.join(', ')}. The plan disagrees with the applier.`,
    );
  }
  console.log('Dry run reports nothing pending.');
} finally {
  await admin.end();
}
