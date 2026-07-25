import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createPool } from './pool.js';
import { runMigrations } from './migrate.js';

/**
 * `pnpm db:migrate` entry point. Reads DATABASE_URL from the environment
 * (load it via `node --env-file=.env.local`), never from an argument, so the
 * connection secret never lands in shell history or process listings.
 */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Put it in .env.local (gitignored) and retry.');
    process.exit(1);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = resolve(here, '../../../database/migrations');

  const pool = createPool(connectionString);
  try {
    const applied = await runMigrations(pool, migrationsDir);
    if (applied.length === 0) {
      console.log('No new migrations — database is up to date.');
    } else {
      console.log(`Applied ${applied.length} migration(s):`);
      for (const version of applied) {
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
