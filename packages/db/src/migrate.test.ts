import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { MIGRATION_ADVISORY_LOCK_KEY, runMigrations } from './migrate.js';

/**
 * A Postgres stand-in that records every statement in order and answers the
 * two queries the runner reads back. Vitest has no database, and the property
 * under test is not "does this SQL work" - it is "does the runner record what
 * it applied, in the same transaction, exactly once". That is a property of
 * the statement sequence, which is what this captures.
 */
interface FakeDatabase {
  readonly statements: string[];
  /** Versions the fake ledger already holds, as `schema_migrations` would. */
  readonly ledger: Set<string>;
  readonly pool: Pool;
  /** Released clients, to prove the pool is not leaked on any path. */
  releases: number;
}

function fakePool(options: { failOn?: RegExp } = {}): FakeDatabase {
  const statements: string[] = [];
  const ledger = new Set<string>();
  const state = { releases: 0 };

  const query = async (text: string, values?: unknown[]) => {
    statements.push(text);
    if (options.failOn?.test(text)) {
      throw new Error('duplicate_table');
    }
    if (/insert into schema_migrations/i.test(text) && values) {
      ledger.add(String(values[0]));
      return { rows: [] };
    }
    if (/select version from schema_migrations/i.test(text)) {
      return { rows: [...ledger].map((version) => ({ version })) };
    }
    return { rows: [] };
  };

  const client = {
    query,
    release() {
      state.releases += 1;
    },
  };

  const pool = {
    connect: async () => client,
    query,
  } as unknown as Pool;

  return {
    statements,
    ledger,
    pool,
    get releases() {
      return state.releases;
    },
  } as FakeDatabase;
}

let migrationsDir = '';

async function migrationDirectory(files: Record<string, string>): Promise<string> {
  migrationsDir = await mkdtemp(join(tmpdir(), 'caredesk-migrate-'));
  for (const [name, sql] of Object.entries(files)) {
    await writeFile(join(migrationsDir, name), sql, 'utf-8');
  }
  return migrationsDir;
}

afterEach(() => {
  migrationsDir = '';
});

describe('runMigrations', () => {
  it('records a migration that does not record itself', async () => {
    // REL-01 / DB-02: 0024, 0027 and 0030 end at a grant. Before this change
    // the runner left them unrecorded, so the next run re-applied them and
    // died on "already exists", taking every later migration with it.
    const dir = await migrationDirectory({
      '0001_silent.sql': 'create table silent (id int);\n',
    });
    const db = fakePool();

    const first = await runMigrations(db.pool, dir);
    expect(first).toEqual(['0001_silent']);
    expect(db.ledger.has('0001_silent')).toBe(true);

    const second = await runMigrations(db.pool, dir);
    expect(second).toEqual([]);
  });

  it('records the version inside the migration transaction, before the commit', async () => {
    // A ledger row written after the commit is a second transaction: a crash
    // between the two leaves an applied-but-unrecorded migration, which is the
    // exact state that wedged production.
    const dir = await migrationDirectory({
      '0001_a.sql': 'create table a (id int);\n',
    });
    const db = fakePool();
    await runMigrations(db.pool, dir);

    const begin = db.statements.findIndex((s) => s === 'begin');
    const insert = db.statements.findIndex((s) => /insert into schema_migrations/i.test(s));
    const commit = db.statements.findIndex((s) => s === 'commit');
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThan(begin);
    expect(commit).toBeGreaterThan(insert);
  });

  it('inserts on conflict do nothing so a self-recording migration still applies', async () => {
    // 35 of the 38 committed migrations end with their own insert. Those files
    // are immutable, so the runner's insert must be able to lose the race with
    // them without raising a primary key violation.
    const dir = await migrationDirectory({
      '0001_self.sql':
        "create table s (id int);\ninsert into schema_migrations (version) values ('0001_self');\n",
    });
    const db = fakePool();

    await expect(runMigrations(db.pool, dir)).resolves.toEqual(['0001_self']);
    // Two inserts reach the database here, and only one of them is the runner's.
    // The first is the migration file's own insert, replayed verbatim as part of
    // the file body; it is a literal `values ('0001_self')` and it is immutable,
    // so asserting against it tests the fixture rather than the code. The
    // runner's insert is the parameterised one, and `$1` is what tells them
    // apart.
    const insert = db.statements.find((s) =>
      /insert into schema_migrations \(version\) values \(\$1\)/i.test(s),
    );
    expect(insert).toBeDefined();
    expect(insert).toMatch(/on conflict do nothing/i);
  });

  it('holds a session advisory lock for the whole run and releases it', async () => {
    const dir = await migrationDirectory({
      '0001_a.sql': 'create table a (id int);\n',
      '0002_b.sql': 'create table b (id int);\n',
    });
    const db = fakePool();
    await runMigrations(db.pool, dir);

    const lock = db.statements.findIndex((s) => s.includes('pg_advisory_lock'));
    const unlock = db.statements.findIndex((s) => s.includes('pg_advisory_unlock'));
    const commits = db.statements.filter((s) => s === 'commit');
    expect(lock).toBe(0);
    expect(commits).toHaveLength(2);
    // Session-level, not transaction-level: the lock must still be held across
    // the commit between two migrations, which is where a second run would
    // otherwise slip in.
    expect(unlock).toBeGreaterThan(db.statements.lastIndexOf('commit'));
    expect(MIGRATION_ADVISORY_LOCK_KEY).toBeTypeOf('number');
  });

  it('releases the advisory lock and the client when a migration fails', async () => {
    const dir = await migrationDirectory({
      '0001_boom.sql': 'create table boom (id int);\n',
    });
    const db = fakePool({ failOn: /create table boom/ });

    await expect(runMigrations(db.pool, dir)).rejects.toThrow(/0001_boom\.sql failed/);
    expect(db.statements).toContain('rollback');
    expect(db.statements.some((s) => s.includes('pg_advisory_unlock'))).toBe(true);
    expect(db.releases).toBe(1);
  });

  it('bounds how long a migration waits for a lock', async () => {
    // REL-07: an ALTER that queues behind one long-running query makes every
    // later query on that table queue behind it. Failing fast is recoverable;
    // a blocked table is an outage.
    const dir = await migrationDirectory({ '0001_a.sql': 'create table a (id int);\n' });
    const db = fakePool();
    await runMigrations(db.pool, dir);

    const begin = db.statements.indexOf('begin');
    expect(db.statements[begin + 1]).toMatch(/set local lock_timeout/i);
  });

  it('dry run reports the pending list and applies nothing', async () => {
    const dir = await migrationDirectory({
      '0001_a.sql': 'create table a (id int);\n',
      '0002_b.sql': 'create table b (id int);\n',
    });
    const db = fakePool();
    db.ledger.add('0001_a');

    await expect(runMigrations(db.pool, dir, { dryRun: true })).resolves.toEqual(['0002_b']);
    expect(db.statements).not.toContain('begin');
    expect(db.ledger.has('0002_b')).toBe(false);
  });

  it('applies files in ascending order and ignores non-migration files', async () => {
    const dir = await migrationDirectory({
      '0002_b.sql': 'create table b (id int);\n',
      '0001_a.sql': 'create table a (id int);\n',
      'README.md': 'not a migration\n',
      'notes.sql': 'select 1;\n',
    });
    const db = fakePool();

    await expect(runMigrations(db.pool, dir)).resolves.toEqual(['0001_a', '0002_b']);
  });
});
