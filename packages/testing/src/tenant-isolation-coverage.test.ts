import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Root 6 - tenant isolation is enforced unevenly.
 *
 * Two of the seven findings under that root are the same failure mode: a
 * hand-maintained list that describes the schema, drifting behind the schema it
 * describes, with nothing to notice.
 *
 *   DB-09  `ALL_TENANT_TABLES` in packages/db/src/rls-check.ts is what the live
 *          `pnpm db:rls-test` guard asks "is forced RLS still on?". Six
 *          tenant-scoped tables added between 0027 and 0038 were never added to
 *          it, so the guard printed "all tenant-owned and control tables retain
 *          enabled, forced RLS" while never looking at leave_entry,
 *          scenario_expense, professional_review_request,
 *          ai_action_confirmation, tenant_workspace_history or
 *          tenant_data_census.
 *
 *   DB-01  `idempotency_record` was granted `select, insert` and seven write
 *          paths then locked it with `select ... for update`, which PostgreSQL
 *          refuses without UPDATE or DELETE privilege. Every idempotent
 *          mutation in the product failed on its retry path.
 *
 * Both are checked here by DERIVING the answer from database/migrations rather
 * than by restating it, so the check cannot go stale the way the lists did.
 * Neither needs a live database: the migrations are the source of truth for
 * grants and for RLS, and CI already applies them for real in the
 * `postgres-rls` job.
 */

const repoFile = (relativePath: string) =>
  fileURLToPath(new URL(`../../../${relativePath}`, import.meta.url));

const MIGRATIONS_DIR = 'database/migrations';

/** Comments may legitimately discuss a grant or a table that is never created. */
function executableSql(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\r\n]*/g, ' ');
}

async function allMigrationSql(): Promise<string> {
  const files = (await readdir(repoFile(MIGRATIONS_DIR)))
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort();
  const bodies = await Promise.all(
    files.map((name) => readFile(repoFile(`${MIGRATIONS_DIR}/${name}`), 'utf8')),
  );
  return executableSql(bodies.join('\n'));
}

/** `create table x ( ... \n);` - the shape every migration in this repo uses. */
function createdTables(sql: string): Map<string, string> {
  const tables = new Map<string, string>();
  const statement = /create\s+table\s+(?:if\s+not\s+exists\s+)?(\w+)\s*\(([\s\S]*?)\n\);/gi;
  let match: RegExpExecArray | null;
  while ((match = statement.exec(sql)) !== null) tables.set(match[1]!, match[2]!);
  return tables;
}

describe('root 6 - tenant isolation coverage is derived, not remembered', () => {
  it('parses every create table statement in the migrations', async () => {
    const sql = await allMigrationSql();
    // A parser that silently matches nothing would make every assertion below
    // vacuously true, which is precisely the failure this whole file exists to
    // stop happening a second time.
    // Compared as a set of names, not a count: 0017 re-declares tenant_workspace
    // and workspace_file with `create table if not exists` to repair a pilot
    // account, so two names legitimately appear twice.
    const declared = new Set(
      [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(\w+)\s*\(/gi)].map((m) => m[1]!),
    );
    expect([...createdTables(sql).keys()].sort()).toEqual([...declared].sort());
    expect(declared.size).toBeGreaterThan(50);
  });

  it('DB-09: the live RLS guard covers every tenant-scoped table in the schema', async () => {
    const sql = await allMigrationSql();
    const tenantScoped = [...createdTables(sql)]
      .filter(([, body]) => /\btenant_id\b/.test(body))
      .map(([name]) => name)
      .sort();

    const guard = await readFile(repoFile('packages/db/src/rls-check.ts'), 'utf8');
    const listBody = /ALL_TENANT_TABLES\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(guard);
    expect(listBody, 'ALL_TENANT_TABLES not found in rls-check.ts').not.toBeNull();
    const covered = new Set([...listBody![1]!.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]!));

    const uncovered = tenantScoped.filter((table) => !covered.has(table));
    expect(uncovered, `tenant-scoped tables the live RLS guard never inspects`).toEqual([]);

    // The reverse direction too: a name that no longer exists makes the guard
    // report a missing table forever, which trains people to ignore it.
    const created = new Set(tenantScoped);
    expect([...covered].filter((table) => !created.has(table))).toEqual([]);
  });

  it('DB-01: every table locked with SELECT ... FOR UPDATE may actually be locked', async () => {
    const sql = await allMigrationSql();

    // Effective grants to caredesk_app, replaying grant/revoke in file order.
    const held = new Map<string, Set<string>>();
    const privilegeStatement =
      /\b(grant|revoke)\s+([a-z, ]+?)\s+on\s+((?:\w+\s*,\s*)*\w+)\s+(?:to|from)\s+caredesk_app\b/gi;
    let match: RegExpExecArray | null;
    while ((match = privilegeStatement.exec(sql)) !== null) {
      const [, verb, privileges, tables] = match;
      const list = privileges!
        .split(',')
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean);
      for (const table of tables!.split(',').map((t) => t.trim())) {
        if (!held.has(table)) held.set(table, new Set());
        const set = held.get(table)!;
        for (const privilege of list) {
          if (verb!.toLowerCase() === 'grant') set.add(privilege);
          else if (privilege === 'all') set.clear();
          else set.delete(privilege);
        }
      }
    }

    const sources = await sourceFiles();
    const locked: Array<{ table: string; file: string }> = [];
    for (const { path, text } of sources) {
      for (const occurrence of text.matchAll(/\bfor\s+update\b/gi)) {
        // The nearest `from <table>` BEFORE the lock clause. Taking the first
        // `from` after the nearest `select` picks the wrong table when a query
        // spans template-literal lines, which most of these do.
        const preceding = text.slice(Math.max(0, occurrence.index - 800), occurrence.index);
        const froms = [...preceding.matchAll(/\bfrom\s+([a-z_][a-z0-9_]*)/gi)];
        const table = froms.at(-1)?.[1];
        if (table && held.has(table)) locked.push({ table, file: path });
      }
    }

    // If this is empty the assertion below proves nothing.
    expect(locked.length).toBeGreaterThan(5);

    // PostgreSQL: "to use FOR UPDATE ... UPDATE, DELETE, or SELECT FOR
    // UPDATE/SHARE privilege is required". SELECT alone is not enough.
    const unlockable = [
      ...new Set(
        locked
          .filter(({ table }) => {
            const privileges = held.get(table)!;
            return !privileges.has('update') && !privileges.has('delete') && !privileges.has('all');
          })
          .map(({ table, file }) => `${table} (locked in ${file})`),
      ),
    ].sort();

    expect(
      unlockable,
      'tables the application role locks but is not granted the privilege to lock',
    ).toEqual([]);
  });
});

/** Every non-test TypeScript source that can issue SQL as the application role. */
async function sourceFiles(): Promise<Array<{ path: string; text: string }>> {
  const roots = ['apps/api/src', 'packages/db/src'];
  const found: Array<{ path: string; text: string }> = [];
  const walk = async (relative: string): Promise<void> => {
    for (const entry of await readdir(repoFile(relative), { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(child);
      else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
        found.push({ path: child, text: await readFile(repoFile(child), 'utf8') });
      }
    }
  };
  for (const root of roots) await walk(root);
  return found;
}
