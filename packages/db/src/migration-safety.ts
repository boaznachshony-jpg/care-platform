export interface MigrationChange {
  readonly status: string;
  readonly paths: readonly string[];
}

export interface MigrationSafetyFinding {
  readonly rule: string;
  readonly message: string;
}

const MIGRATION_PATH = /^database\/migrations\/\d{4}_[a-z0-9_]+\.sql$/;

const DESTRUCTIVE_RULES: ReadonlyArray<{
  readonly rule: string;
  readonly message: string;
  readonly pattern: RegExp;
}> = [
  {
    rule: 'drop-table',
    message: 'DROP TABLE can permanently remove customer data.',
    pattern: /\bdrop\s+table\b/i,
  },
  {
    rule: 'drop-schema',
    message: 'DROP SCHEMA can permanently remove customer data.',
    pattern: /\bdrop\s+schema\b/i,
  },
  {
    rule: 'truncate',
    message: 'TRUNCATE can permanently remove customer data.',
    pattern: /\btruncate\b/i,
  },
  {
    rule: 'delete-from',
    message: 'DELETE FROM requires a separately reviewed, backed-up data migration.',
    pattern: /\bdelete\s+from\b/i,
  },
  {
    rule: 'drop-column',
    message: 'DROP COLUMN must use the expand/migrate/contract release process.',
    pattern: /\balter\s+table[\s\S]{0,400}\bdrop\s+column\b/i,
  },
  {
    rule: 'rename-column',
    message: 'RENAME COLUMN breaks old application versions; add a compatible column first.',
    pattern: /\balter\s+table[\s\S]{0,400}\brename\s+column\b/i,
  },
  {
    rule: 'alter-column-type',
    message: 'Changing a column type can truncate data or break a rolling deployment.',
    pattern: /\balter\s+table[\s\S]{0,400}\balter\s+column[\s\S]{0,250}\btype\b/i,
  },
  {
    rule: 'set-not-null',
    message: 'SET NOT NULL needs a completed backfill and a separate compatibility release.',
    pattern: /\balter\s+table[\s\S]{0,400}\balter\s+column[\s\S]{0,250}\bset\s+not\s+null\b/i,
  },
];

/**
 * Removes comments and literal bodies before pattern matching. A migration may
 * explain a dangerous statement in a comment without actually executing it.
 */
function executableSql(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''");
}

export function findDestructiveMigrationStatements(sql: string): MigrationSafetyFinding[] {
  const executable = executableSql(sql);
  return DESTRUCTIVE_RULES.filter(({ pattern }) => pattern.test(executable)).map(
    ({ rule, message }) => ({ rule, message }),
  );
}

export function parseNameStatus(output: string): MigrationChange[] {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [status = '', ...paths] = line.split('\t');
      return { status, paths };
    });
}

export async function validateMigrationChanges(
  changes: readonly MigrationChange[],
  readSql: (path: string) => Promise<string>,
): Promise<string[]> {
  const errors: string[] = [];

  for (const change of changes) {
    const path = change.paths.at(-1) ?? '(unknown migration)';

    if (change.status !== 'A') {
      errors.push(
        `${path}: applied migration files are immutable (git status ${change.status}). ` +
          'Add a new numbered migration instead.',
      );
      continue;
    }

    if (!MIGRATION_PATH.test(path)) {
      errors.push(`${path}: migration names must match database/migrations/NNNN_snake_case.sql.`);
      continue;
    }

    const findings = findDestructiveMigrationStatements(await readSql(path));
    for (const finding of findings) {
      errors.push(`${path}: [${finding.rule}] ${finding.message}`);
    }
  }

  return errors;
}
