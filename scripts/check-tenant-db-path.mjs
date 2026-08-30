/* global console, process */
/**
 * Root 6 - tenant isolation is enforced unevenly.
 *
 * The root covers seven findings: API-01, API-02, API-14, DB-01, DB-09, DB-13,
 * DB-18. docs/reviews/2026-08-30-code-review/FINDINGS.md is not present in this
 * repository, so the mapping from each id to each symptom below is taken from
 * the root's own description in docs/governance/REVIEW-REMEDIATION-PLAN.md and
 * from the code, not from the finding text. The symptoms are measured; the
 * labels are inferred.
 *
 * ONE PATH TO THE DATABASE. This check fails when code reaches the database
 * outside it.
 *
 * WHAT WENT WRONG
 * ---------------
 * `withTenant()` in packages/db/src/pool.ts opens a transaction, runs
 * `set local role caredesk_app`, and sets `app.tenant_id` transaction-locally.
 * All three matter, and the role matters most: an administrative role carries
 * BYPASSRLS, and a connection with BYPASSRLS skips every row-level security
 * policy in the schema silently. The tenant setting is still applied; it is
 * simply read by policies that never run. There is no error, no warning, and
 * no visible difference until one tenant sees another tenant's rows.
 *
 * Eight services did not call it. Each had grown its own private copy:
 *
 *   private async tx(tenantId, work) {
 *     const c = await this.pool.connect();
 *     await c.query('begin');
 *     await c.query("select set_config('app.tenant_id',$1,true)", [tenantId]);
 *     ...
 *
 * Every copy set the tenant. No copy set the role. Between them they covered
 * payroll entries, the leave ledger, scenario expenses, worker-portal
 * collaboration, binder exports, regulation rules and monthly close - which is
 * to say every canonical write in the product. The copies were correct-looking
 * enough that four separate reviews passed over them.
 *
 * A fix that edits those eight files closes eight instances. It does not close
 * the class: the ninth copy is one `this.pool.connect()` away, and nothing
 * would notice. This check is what notices.
 *
 * WHAT IS CHECKED
 * ---------------
 * In every non-test TypeScript source under apps/ and packages/, except the
 * files listed in EXEMPT_FILES:
 *
 *   new Pool(              only packages/db/src/pool.ts creates pools
 *   .connect()             only pool.ts borrows a client from a pool
 *   'begin'/'commit'/'rollback'   only pool.ts controls transactions
 *   set local role         only pool.ts chooses the role
 *   set_config('app.tenant_id'    only pool.ts establishes tenant context
 *   pool.query( / this.pool.query(   a statement outside any transaction, and
 *                          therefore outside any tenant context
 *
 * The last rule is the subtle one. A bare `pool.query()` cannot have tenant
 * context, because `set_config(..., true)` is transaction-local and there is no
 * transaction. Under RLS such a query matches nothing, which is the safe
 * direction - but it is also how a route silently returns an empty list
 * forever, and it is how a SECURITY DEFINER function gets called from a place
 * nobody expected. Both need a human decision, so both need a waiver.
 *
 * WAIVERS
 * -------
 * A line is waived by a comment containing `db-path-exception:` within the 15
 * lines above it, stating why. Legitimate cases exist and are all the same
 * shape: a lookup that must happen BEFORE the tenant is known, through a narrow
 * SECURITY DEFINER function (worker portal sign-in, actor resolution, the
 * Cardcom webhook), or a read of global reference data that has no tenant_id at
 * all. The waiver is not a bypass of the rule - it is the rule demanding that
 * the reason be written down where the next reader will see it.
 *
 * VERIFYING THE GUARD
 * -------------------
 *   node scripts/check-tenant-db-path.mjs
 *     -> passes against the repository as it stands
 *
 *   pnpm lint:tenant-db-path:demo-failure
 *   node scripts/check-tenant-db-path.mjs
 *     --fixture scripts/fixtures/tenant-db-path-violations
 *     -> fails, reporting a private transaction helper, an unwaived bare
 *        pool.query, and a second pool being constructed
 *
 * Fixture sources use the `.ts.txt` suffix so the synthetic code stays out of
 * eslint and typecheck, the same way scripts/fixtures/adr-006-freeze-violation
 * does. CHECK_TENANT_DB_PATH_FIXTURE=<dir> does the same on a POSIX shell - the
 * flag exists because `VAR=value cmd` is not valid syntax in PowerShell and this
 * repository is developed on Windows.
 *
 * Run: node scripts/check-tenant-db-path.mjs   (wired into `pnpm lint`)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, posix, sep } from 'node:path';

const ROOTS = ['apps', 'packages'];

/**
 * The one path, plus the administrative tools that legitimately do not take it.
 *
 * Everything here connects with DATABASE_ADMIN_URL and runs from a terminal, not
 * from a request: migrations, role provisioning, the pilot-account seeder and
 * the RLS test harness itself. None of them serves a tenant, and the RLS harness
 * exists precisely to run queries the application must not be able to run.
 *
 * Adding a file here is a decision about the architecture. Adding an inline
 * `db-path-exception:` waiver is a decision about one statement. Prefer the
 * waiver.
 */
const EXEMPT_FILES = new Set([
  'packages/db/src/pool.ts', // the one path
  'packages/db/src/migrate.ts',
  'packages/db/src/migrate-idempotency-ci.ts',
  'packages/db/src/migration-safety-cli.ts',
  'packages/db/src/rls-check.ts',
  'packages/db/src/rls-check-ci.ts',
  'packages/db/src/ci-postgres-roles.ts',
  'packages/db/src/provision-app-role.ts',
  'packages/db/src/provision-pilot-account.ts',
  'packages/db/src/activate-product-subscription.ts',
  'packages/db/src/cli.ts',
]);

const RULES = [
  {
    id: 'pool-construction',
    pattern: /\bnew\s+Pool\s*\(/,
    message:
      'constructs a connection pool. Only packages/db/src/pool.ts may; use createPool() so the\n' +
      '      TLS settings, the date type parser and the pool size stay in one place.',
  },
  {
    id: 'raw-client',
    pattern: /\.connect\s*\(\s*\)/,
    message:
      'borrows a raw client from a pool. A raw client has no role and no tenant context until\n' +
      '      somebody remembers to set them - which is exactly what the eight private tx() helpers\n' +
      '      forgot. Use withTenant(pool, tenantId, work).',
  },
  {
    id: 'transaction-control',
    pattern: /(['"`])(begin|commit|rollback)\1/i,
    message:
      'issues transaction control directly. withTenant() owns begin/commit/rollback so that the\n' +
      '      role and the tenant context can never be set on one and missing on the other.',
  },
  {
    id: 'role-switch',
    pattern: /set\s+local\s+role/i,
    message:
      'sets the database role. Only withTenant()/withAppRole() may, because the role is the control\n' +
      '      that survives a DATABASE_URL pointed at an administrative account (ADR-002).',
  },
  {
    id: 'tenant-context',
    pattern: /set_config\s*\(\s*['"`]app\.tenant_id/i,
    message:
      'sets app.tenant_id itself. Establishing tenant context without also establishing the role is\n' +
      '      the precise shape of API-01: every policy still reads the setting, and none of them run.',
  },
  {
    id: 'transactionless-query',
    pattern: /\b(?:this\.)?(?:pool|admin|adminPool)\.query\s*[(<]/,
    message:
      'queries the pool outside any transaction, so it has no tenant context at all. Under RLS it\n' +
      '      matches nothing; over a SECURITY DEFINER function it matches everything. Use\n' +
      '      withTenant(), or state why not with a db-path-exception comment.',
  },
];

const WAIVER = /db-path-exception:/;
const WAIVER_LOOKBACK = 15;

function flag(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

const fixtureDir = flag('fixture') || process.env.CHECK_TENANT_DB_PATH_FIXTURE || '';

/** Fixture sources carry a .ts.txt suffix; real sources are .ts / .tsx. */
const SOURCE = fixtureDir ? /\.tsx?\.txt$/ : /\.tsx?$/;
const TEST_SOURCE = /\.(test|spec)\.tsx?(\.txt)?$/;
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', '.next', 'coverage']);

function collect(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.isDirectory()) continue;
    const child = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) collect(child, files);
    } else if (SOURCE.test(entry.name) && !TEST_SOURCE.test(entry.name)) {
      files.push(child);
    }
  }
  return files;
}

const files = fixtureDir
  ? collect(fixtureDir)
  : ROOTS.flatMap((root) => collect(root)).filter(
      (file) => !EXEMPT_FILES.has(file.split(sep).join(posix.sep)),
    );

/**
 * Blanks the contents of comments so that a rule discussed in prose - this file
 * and the eight `Root 6 (API-01)` comments do exactly that - is not reported as
 * the thing it warns against. Line and block comments only; string contents are
 * deliberately left intact, because the SQL this checks for lives in strings.
 */
function withoutComments(line) {
  return line
    .replace(/\/\/.*$/, '')
    .replace(/\/\*.*?\*\//g, '')
    .replace(/^\s*\*.*$/, '');
}

const violations = [];

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const display = file.split(sep).join(posix.sep);
  for (let index = 0; index < lines.length; index += 1) {
    const code = withoutComments(lines[index]);
    if (!code.trim()) continue;
    for (const rule of RULES) {
      if (!rule.pattern.test(code)) continue;
      const context = lines.slice(Math.max(0, index - WAIVER_LOOKBACK), index + 1).join('\n');
      if (WAIVER.test(context)) continue;
      violations.push({ file: display, line: index + 1, rule, text: lines[index].trim() });
    }
  }
}

if (violations.length > 0) {
  console.error('Tenant database-path check failed:\n');
  for (const { file, line, rule, text } of violations) {
    console.error(`  - ${file}:${line} [${rule.id}]`);
    console.error(`      ${text}`);
    console.error(`      ${rule.message}\n`);
  }
  console.error(
    '  Every tenant-scoped read and write goes through withTenant() in\n' +
      '  packages/db/src/pool.ts. If this statement genuinely cannot - a lookup that\n' +
      '  must run before the tenant is known, or global reference data with no\n' +
      '  tenant_id - put a comment containing "db-path-exception: <reason>" within 15\n' +
      '  lines above it. See the header of this file for why the rule exists.\n',
  );
  if (fixtureDir) console.error(`(evaluated against fixture: ${fixtureDir})`);
  process.exit(1);
}

console.log(
  `Tenant database-path check passed (${files.length} source file(s); ` +
    `${EXEMPT_FILES.size} exempt path(s); one path to the database).` +
    (fixtureDir ? ` [fixture: ${fixtureDir}]` : ''),
);
