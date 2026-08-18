import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';

/**
 * Applies every `NNNN_*.sql` in the migrations directory in ascending order,
 * skipping any version already recorded in schema_migrations. Each migration
 * runs in its own transaction and self-records its version (the SQL files end
 * with an insert into schema_migrations), so re-running is a no-op.
 */
export async function runMigrations(pool: Pool, migrationsDir: string): Promise<string[]> {
  await pool.query(
    'create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())',
  );

  const applied = new Set(
    (await pool.query<{ version: string }>('select version from schema_migrations')).rows.map(
      (row) => row.version,
    ),
  );

  const files = (await readdir(migrationsDir))
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort();

  const newlyApplied: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) {
      continue;
    }

    const sql = await readFile(join(migrationsDir, file), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('commit');
      newlyApplied.push(version);
    } catch (error) {
      await client.query('rollback');
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
    } finally {
      client.release();
    }
  }

  return newlyApplied;
}
