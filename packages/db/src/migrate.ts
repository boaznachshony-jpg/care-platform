import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool, PoolClient } from 'pg';

/**
 * A fixed, repository-scoped key for `pg_advisory_lock`. The value is
 * arbitrary; what matters is that every process that applies migrations to a
 * given database asks for the same one, so two operators at two terminals
 * serialise instead of interleaving. Advisory locks are per-database, so a
 * developer's local container and production never contend with each other.
 */
export const MIGRATION_ADVISORY_LOCK_KEY = 20260830;

/**
 * Bounds the time a migration will wait for a lock it cannot get. Without it,
 * an `alter table` that queues behind one long-running report holds an
 * ACCESS EXCLUSIVE *request*, and every subsequent query on that table queues
 * behind the request - turning a slow migration into a total table outage.
 * Failing after five seconds turns that outage into a retryable error.
 *
 * This bounds waiting, not work: a legitimately long backfill is unaffected.
 */
const LOCK_TIMEOUT = '5s';

export interface RunMigrationsOptions {
  /**
   * Report what would be applied and change nothing. The pending list is
   * still computed against the real ledger, so a dry run is a true plan and
   * not a guess.
   */
  readonly dryRun?: boolean;
}

/**
 * Applies every `NNNN_*.sql` in the migrations directory in ascending order,
 * skipping any version already recorded in `schema_migrations`, and returns
 * the versions it applied (or, for a dry run, the versions it would apply).
 *
 * THE RUNNER OWNS THE LEDGER.
 *
 * Until 2026-08-30 it did not: the SQL files were expected to end with their
 * own `insert into schema_migrations`, and 35 of the 38 did. `0024`, `0027` and
 * `0030` did not, so on every subsequent run the runner believed they were
 * pending, re-executed them, and died on `create table ... already exists` -
 * taking every later migration with it, because the loop is sequential. The
 * database froze at 0035 and three migrations were applied by hand through
 * the Supabase SQL editor instead.
 *
 * The insert below is what makes that impossible to repeat. It is inside the
 * same transaction as the migration body, so a migration is recorded if and
 * only if it actually took effect, and it is `on conflict do nothing` so the
 * 33 files that still record themselves stay correct and unchanged. Existing
 * migration files are immutable; the runner is what changes.
 *
 * The whole run holds a session-level advisory lock on a single client. It is
 * session-level rather than transaction-level deliberately: a transaction
 * lock would be released at each `commit`, which is precisely the window in
 * which a second run would slip in between two migrations.
 */
export async function runMigrations(
  pool: Pool,
  migrationsDir: string,
  options: RunMigrationsOptions = {},
): Promise<string[]> {
  const files = (await readdir(migrationsDir))
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort();

  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
    try {
      return await applyPending(client, migrationsDir, files, options);
    } finally {
      await client.query('select pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

async function applyPending(
  client: PoolClient,
  migrationsDir: string,
  files: string[],
  options: RunMigrationsOptions,
): Promise<string[]> {
  await client.query(
    'create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())',
  );

  const applied = new Set(
    (await client.query<{ version: string }>('select version from schema_migrations')).rows.map(
      (row) => row.version,
    ),
  );

  const pending = files
    .map((file) => ({ file, version: file.replace(/\.sql$/, '') }))
    .filter(({ version }) => !applied.has(version));

  if (options.dryRun) {
    return pending.map(({ version }) => version);
  }

  const newlyApplied: string[] = [];
  for (const { file, version } of pending) {
    const sql = await readFile(join(migrationsDir, file), 'utf-8');
    try {
      await client.query('begin');
      await client.query(`set local lock_timeout = '${LOCK_TIMEOUT}'`);
      await client.query(sql);
      await client.query(
        'insert into schema_migrations (version) values ($1) on conflict do nothing',
        [version],
      );
      await client.query('commit');
      newlyApplied.push(version);
    } catch (error) {
      await client.query('rollback');
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
    }
  }

  return newlyApplied;
}
