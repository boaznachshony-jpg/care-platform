/* global console, process */
/**
 * Guards the five invariants that, between them, make `pnpm db:migrate`
 * trustworthy. Every one of them was violated in production on 2026-08-30.
 *
 * WHAT WENT WRONG
 * ---------------
 * The runner did not write the ledger. Each SQL file was expected to end with
 * its own `insert into schema_migrations`, and 35 of the 38 did. `0024`, `0027`
 * and `0030` did not. So every run after the first re-executed them, hit
 * `create table document_intake_review already exists`, threw, and - because
 * the loop is sequential - never reached any later migration. The schema
 * froze. Migrations 0035, 0036 and 0037 were applied by hand through the
 * Supabase SQL editor, on a database holding a real customer's data, because
 * the runner could not be trusted. A day was spent blaming a password.
 *
 * WHAT IS CHECKED
 * ---------------
 *   1. RUNNER COVERAGE. packages/db/src/migrate.ts must insert the version it
 *      just applied, inside the migration's own transaction, with
 *      `on conflict do nothing`. This is the rule that makes rule 2 satisfiable
 *      by the runner rather than by 38 separate acts of discipline. If someone
 *      removes that insert, this fails first and explains why.
 *
 *   2. EVERY MIGRATION IS COVERED. Each `database/migrations/NNNN_*.sql` is
 *      recorded either by itself or by the runner. With rule 1 holding, every
 *      file is covered by the runner - but the rule is written as a disjunction
 *      on purpose, so that deleting the runner's insert does not silently
 *      un-cover 38 files; it re-imposes the old requirement on all of them and
 *      names the three that never met it.
 *
 *   3. A SELF-RECORD NAMES ITS OWN VERSION. A file that records a version is
 *      only allowed to skip rule 2 if the version it records is its own. This
 *      is the transposed-digit case: `0031` recording `0013` reads as
 *      compliant, applies twice, and skips a real migration forever. Recording
 *      OTHER versions in addition is permitted - `0017` legitimately repairs
 *      three earlier rows.
 *
 *   4. MIGRATION NUMBERS ARE UNIQUE. `0026_canonical_product_intelligence` and
 *      `0026_wave5_worker_authorization` both exist. Nothing broke, because
 *      they are independent and the ledger keys on the full filename - but the
 *      ordering between them is decided by `c` sorting before `w`, not by
 *      intent. Two agents on two branches both writing `0036_*.sql` both pass
 *      CI today. The existing pair is grandfathered by name below; a new
 *      collision fails. The applied files are immutable and are NOT renumbered.
 *
 *   5. THE /ready CONTRACT IS COMPLETE. packages/db/src/required-migrations.ts
 *      is what `/ready` compares the live ledger against. It must list exactly
 *      the migrations on disk - no more, no fewer, same order. A hand-
 *      maintained list is only safe while something fails when it goes stale;
 *      this is that something.
 *
 * VERIFYING THE GUARD
 * -------------------
 *   node scripts/check-migration-ledger.mjs
 *     -> passes against the repository as it stands
 *
 *   pnpm lint:migration-ledger:demo-failure
 *   node scripts/check-migration-ledger.mjs
 *     --fixture scripts/fixtures/migration-ledger-violations
 *     -> fails, reporting an unrecorded migration, a migration that records
 *        somebody else's version, a duplicate number and a stale required list
 *
 * The fixture directory may contain a `migrations/` subdirectory, a
 * `migrate.ts.txt` and a `required-migrations.ts.txt`; anything absent falls
 * back to the real file, so a fixture can exercise one rule at a time. The
 * `.txt` suffix keeps the synthetic sources out of eslint and typecheck, the
 * same way scripts/fixtures/adr-006-freeze-violation does.
 * CHECK_MIGRATION_LEDGER_FIXTURE=<dir> does the same on a POSIX shell - the
 * flag exists because `VAR=value cmd` is not valid syntax in PowerShell and
 * this repository is developed on Windows.
 *
 * Run: node scripts/check-migration-ledger.mjs   (wired into `pnpm lint`)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = 'database/migrations';
const RUNNER = 'packages/db/src/migrate.ts';
const REQUIRED_LIST = 'packages/db/src/required-migrations.ts';

/**
 * Numbers that were already duplicated when this check was written. Both files
 * are applied in production, so they are immutable: renaming either one would
 * make the runner apply it a second time under a new version. The entry is a
 * record of history, not permission - a third file numbered 0026 still fails.
 */
const GRANDFATHERED_DUPLICATES = {
  '0026': ['0026_canonical_product_intelligence.sql', '0026_wave5_worker_authorization.sql'],
};

function flag(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

const fixtureDir = flag('fixture') || process.env.CHECK_MIGRATION_LEDGER_FIXTURE || '';

function fixturePath(name) {
  if (!fixtureDir) return null;
  const candidate = join(fixtureDir, name);
  return existsSync(candidate) ? candidate : null;
}

const migrationsDir = fixturePath('migrations') || MIGRATIONS_DIR;
const runnerPath = fixturePath('migrate.ts.txt') || RUNNER;
const requiredPath = fixturePath('required-migrations.ts.txt') || REQUIRED_LIST;

function read(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Blanks `--` line comments and `/* *\/` block comments, preserving newlines,
 * so a commented-out or merely discussed `insert into schema_migrations` never
 * counts as a real one. Dollar-quoted bodies are left alone: a `--` inside one
 * is a comment there too.
 */
function stripSqlComments(sql) {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Every version string any `insert into schema_migrations` in this file names. */
function recordedVersions(sql) {
  const versions = new Set();
  const statement = /insert\s+into\s+schema_migrations\s*\([^)]*\)\s*values([\s\S]*?);/gi;
  let match;
  while ((match = statement.exec(sql)) !== null) {
    for (const literal of match[1].matchAll(/'([^']+)'/g)) versions.add(literal[1]);
  }
  return versions;
}

const failures = [];

// --- Rule 1: the runner records what it applies -------------------------
const runner = read(runnerPath);
const runnerRecords =
  /insert\s+into\s+schema_migrations\s*\(\s*version\s*\)\s*values\s*\(\s*\$1\s*\)\s*on\s+conflict\s+do\s+nothing/i.test(
    runner,
  );

if (!runnerRecords) {
  failures.push(
    `${runnerPath} no longer inserts the applied version into schema_migrations.\n` +
      `    The runner must record each migration inside that migration's own\n` +
      `    transaction, as:\n` +
      `      insert into schema_migrations (version) values ($1) on conflict do nothing\n` +
      `    Without it the ledger depends on 38 separate acts of discipline in the SQL\n` +
      `    files, which is exactly how db:migrate wedged for a full day on 2026-08-30.`,
  );
}

// --- Rules 2 + 3 + 4: the migration files -------------------------------
let files = [];
try {
  files = readdirSync(migrationsDir)
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort();
} catch {
  failures.push(`Cannot read the migrations directory ${migrationsDir}.`);
}

const unrecorded = [];
const misrecorded = [];
const byNumber = new Map();

for (const file of files) {
  const version = file.replace(/\.sql$/, '');
  const number = file.slice(0, 4);
  if (!byNumber.has(number)) byNumber.set(number, []);
  byNumber.get(number).push(file);

  const versions = recordedVersions(stripSqlComments(read(join(migrationsDir, file))));
  if (versions.has(version)) continue;

  if (versions.size > 0) {
    misrecorded.push(`${file} records ${[...versions].map((v) => `'${v}'`).join(', ')}`);
  } else if (!runnerRecords) {
    unrecorded.push(file);
  }
}

if (unrecorded.length > 0) {
  failures.push(
    `${unrecorded.length} migration(s) are recorded by nobody:\n` +
      unrecorded.map((f) => `      ${f}`).join('\n') +
      `\n    The runner does not write the ledger (rule 1 above failed), so each file\n` +
      `    must end with:\n` +
      `      insert into schema_migrations (version) values ('<its own version>');\n` +
      `    A migration nothing records is re-applied on every run, forever.`,
  );
}

if (misrecorded.length > 0) {
  failures.push(
    `${misrecorded.length} migration(s) record a version that is not their own:\n` +
      misrecorded.map((m) => `      ${m}`).join('\n') +
      `\n    A transposed version number reads as compliant: the file re-applies on\n` +
      `    every run and the migration it names is skipped forever. Record the file's\n` +
      `    own version; recording others in addition (a repair migration) is fine.`,
  );
}

const duplicates = [];
for (const [number, group] of byNumber) {
  if (group.length < 2) continue;
  const allowed = GRANDFATHERED_DUPLICATES[number] || [];
  const unexpected = group.filter((file) => !allowed.includes(file));
  if (group.length > allowed.length || unexpected.length > 0) {
    duplicates.push(`${number}: ${group.join(', ')}`);
  }
}

if (duplicates.length > 0) {
  failures.push(
    `${duplicates.length} migration number(s) are used more than once:\n` +
      duplicates.map((d) => `      ${d}`).join('\n') +
      `\n    NNNN is meant to be the total order. Two files sharing a number are\n` +
      `    ordered by the accident of their suffix sorting, so a dependency between\n` +
      `    them is silently wrong. Renumber the file that is NOT yet applied to any\n` +
      `    database - never one that is.`,
  );
}

// --- Rule 5: the /ready contract lists exactly what is on disk ----------
const requiredSource = read(requiredPath);
const listBody = /REQUIRED_MIGRATIONS[^=]*=\s*\[([\s\S]*?)\]/.exec(requiredSource);
if (!listBody) {
  failures.push(
    `Cannot find the REQUIRED_MIGRATIONS array in ${requiredPath}. /ready compares the\n` +
      `    live schema_migrations ledger against it; without the list the gate is blind.`,
  );
} else {
  const listed = [...listBody[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const expected = files.map((file) => file.replace(/\.sql$/, ''));
  const missing = expected.filter((v) => !listed.includes(v));
  const extra = listed.filter((v) => !expected.includes(v));
  const misordered =
    missing.length === 0 && extra.length === 0 && listed.join('\n') !== expected.join('\n');

  if (missing.length > 0 || extra.length > 0 || misordered) {
    failures.push(
      `${requiredPath} does not match ${migrationsDir}.\n` +
        (missing.length > 0 ? `      missing: ${missing.join(', ')}\n` : '') +
        (extra.length > 0 ? `      not on disk: ${extra.join(', ')}\n` : '') +
        (misordered ? `      same members, different order\n` : '') +
        `    /ready fails a deployment when a listed migration is absent from the live\n` +
        `    ledger. A migration missing from this list is a migration the deployment\n` +
        `    gate cannot see - which is how /ready stayed green on a database fourteen\n` +
        `    migrations behind the code.`,
    );
  }
}

// --- Report -------------------------------------------------------------
if (failures.length > 0) {
  console.error('Migration ledger check failed:\n');
  for (const failure of failures) console.error(`  - ${failure}\n`);
  if (fixtureDir) console.error(`(evaluated against fixture: ${fixtureDir})`);
  process.exit(1);
}

const duplicateCount = [...byNumber.values()].filter((group) => group.length > 1).length;
console.log(
  `Migration ledger check passed (${files.length} migration(s); runner records the ledger; ` +
    `${duplicateCount} grandfathered duplicate number(s); required-migrations.ts in sync).` +
    (fixtureDir ? ` [fixture: ${fixtureDir}]` : ''),
);
