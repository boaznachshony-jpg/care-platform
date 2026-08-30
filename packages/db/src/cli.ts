import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createPool } from './pool.js';
import { runMigrations } from './migrate.js';
import { assertMigrationTargetIsAllowed } from './migrate-target.js';

/**
 * `pnpm db:migrate` entry point. Reads DATABASE_ADMIN_URL from the environment
 * (load it via `node --env-file=.env.local`), never from an argument, so the
 * connection secret never lands in shell history or process listings.
 *
 * Migrations use the *owner* connection, deliberately separate from the
 * application's DATABASE_URL: since ADR-002 the running application connects
 * as the least-privilege `caredesk_app` login, which has no DDL rights and
 * must never be able to reshape the schema (see database/migrations/0005).
 *
 * `--dry-run` prints the pending list and exits without opening a transaction.
 * CAREDESK_MIGRATE_DRY_RUN=1 does the same, because `VAR=value cmd` is not
 * valid syntax in PowerShell and this repository is developed on Windows.
 *
 * The environment guard runs before the pool is opened; see migrate-target.ts
 * for what it demands of a non-loopback target.
 */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_ADMIN_URL;
  if (!connectionString) {
    console.error(
      'DATABASE_ADMIN_URL is not set. Migrations need the owner connection ' +
        '(postgres.<project-ref>), not the application role. Put it in ' +
        '.env.local (gitignored) and retry.',
    );
    process.exit(1);
  }

  const dryRun = process.argv.includes('--dry-run') || process.env.CAREDESK_MIGRATE_DRY_RUN === '1';

  const ref = assertMigrationTargetIsAllowed({
    name: 'DATABASE_ADMIN_URL',
    url: connectionString,
    source: process.env,
  });
  console.log(`Target: ${ref ?? 'local/non-Supabase database'}${dryRun ? ' (dry run)' : ''}`);

  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = resolve(here, '../../../database/migrations');

  const pool = createPool(connectionString);
  try {
    const versions = await runMigrations(pool, migrationsDir, { dryRun });
    if (versions.length === 0) {
      console.log('No new migrations - database is up to date.');
    } else if (dryRun) {
      console.log(`Would apply ${versions.length} migration(s):`);
      for (const version of versions) {
        console.log(`  - ${version}`);
      }
      console.log('Nothing was applied. Re-run without --dry-run to apply them.');
    } else {
      console.log(`Applied ${versions.length} migration(s):`);
      for (const version of versions) {
        console.log(`  - ${version}`);
      }
    }
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
