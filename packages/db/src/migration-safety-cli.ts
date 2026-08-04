import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseNameStatus, validateMigrationChanges } from './migration-safety.js';

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function comparisonBase(): string {
  const explicitBase = process.argv.find((argument) => argument.startsWith('--base='));
  if (explicitBase) {
    return explicitBase.slice('--base='.length);
  }

  if (process.env.GITHUB_BASE_REF) {
    return `origin/${process.env.GITHUB_BASE_REF}`;
  }

  return 'HEAD^';
}

function sqlChanges(output: string) {
  return parseNameStatus(output).filter((change) =>
    change.paths.some((path) => path.endsWith('.sql')),
  );
}

function uniqueChanges(...groups: ReturnType<typeof sqlChanges>[]) {
  const changes = new Map<string, ReturnType<typeof sqlChanges>[number]>();
  for (const group of groups) {
    for (const change of group) {
      const key = change.paths.at(-1) ?? change.paths.join('\t');
      changes.set(key, change);
    }
  }
  return [...changes.values()];
}

async function main(): Promise<void> {
  const base = comparisonBase();
  git('rev-parse', '--verify', base);

  const committedDiff = git(
    'diff',
    '--name-status',
    '--find-renames',
    `${base}...HEAD`,
    '--',
    'database/migrations',
  );
  const workingDiff = git('diff', '--name-status', 'HEAD', '--', 'database/migrations');
  const untracked = git(
    'ls-files',
    '--others',
    '--exclude-standard',
    '--',
    'database/migrations/*.sql',
  );
  const untrackedChanges = untracked
    ? untracked.split(/\r?\n/).map((path) => ({ status: 'A', paths: [path] }))
    : [];
  const changes = uniqueChanges(
    sqlChanges(committedDiff),
    sqlChanges(workingDiff),
    untrackedChanges,
  );
  const errors = await validateMigrationChanges(changes, (path) =>
    readFile(resolve(process.cwd(), path), 'utf8'),
  );

  if (errors.length > 0) {
    console.error('Migration safety check failed:');
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    console.error(
      'Do not bypass this check. Follow docs/operations/production-release-and-recovery.md.',
    );
    process.exit(1);
  }

  if (changes.length === 0) {
    console.log(`Migration safety check passed: no migration changes since ${base}.`);
  } else {
    console.log(`Migration safety check passed: ${changes.length} additive migration(s).`);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
