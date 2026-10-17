import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const guard = join(root, 'scripts/check-migration-ledger.mjs');
const fixturePrefix = 'caredesk-migration-ledger-';
const reviewed0049 = [
  '0049_national_insurance_report.sql',
  '0049_payroll_settlement_integrity.sql',
];
const historic0026 = [
  '0026_canonical_product_intelligence.sql',
  '0026_wave5_worker_authorization.sql',
];

function runGuard(fixture?: string) {
  const result = spawnSync(process.execPath, [guard, ...(fixture ? ['--fixture', fixture] : [])], {
    cwd: root,
    encoding: 'utf8',
    timeout: 20_000,
  });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function withMigrations(files: readonly string[], check: (fixture: string) => void) {
  const fixture = mkdtempSync(join(tmpdir(), fixturePrefix));
  try {
    mkdirSync(join(fixture, 'migrations'));
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      writeFileSync(
        join(fixture, 'migrations', file),
        `insert into schema_migrations(version) values ('${version}');\n`,
      );
    }
    // Match the fixture's entire sorted full-name ledger, so a negative case
    // fails for the collision itself rather than an unrelated readiness error.
    const versions = [...files].sort().map((file) => `'${file.replace(/\.sql$/, '')}'`);
    writeFileSync(
      join(fixture, 'required-migrations.ts.txt'),
      `export const REQUIRED_MIGRATIONS = [${versions.join(',')}];\n`,
    );
    check(fixture);
  } finally {
    // Remove only this test's freshly generated direct child of the temp root.
    expect(dirname(resolve(fixture))).toBe(resolve(tmpdir()));
    expect(basename(fixture).startsWith(fixturePrefix)).toBe(true);
    rmSync(fixture, { recursive: true, force: true });
  }
}

describe('migration ledger exact reviewed collisions', () => {
  it('accepts the real repository and its complete readiness list', () => {
    const result = runGuard();
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain('Migration ledger check passed');
  });

  it('accepts only the reviewed independent 0049 pair', () => {
    withMigrations(reviewed0049, (fixture) => {
      const result = runGuard(fixture);
      expect(result.status, result.output).toBe(0);
      expect(result.output).toContain('2 migration(s)');
      expect(result.output).toContain('1 grandfathered duplicate number(s)');
    });
  });

  it.each([
    [...reviewed0049, '0049_third_unreviewed.sql'],
    ['0049_national_insurance_report.sql', '0049_unreviewed_replacement.sql'],
    ['0049_unreviewed_first.sql', '0049_unreviewed_second.sql'],
    ['0098_unreviewed_first.sql', '0098_unreviewed_second.sql'],
    [...historic0026, '0026_third_unreviewed.sql'],
  ])('rejects an unreviewed collision: %j', (...files) => {
    withMigrations(files, (fixture) => {
      const result = runGuard(fixture);
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain('migration number(s) are used more than once');
      expect(result.output).not.toContain('does not match');
    });
  });

  it('preserves the existing exact 0026 exception', () => {
    withMigrations(historic0026, (fixture) => {
      const result = runGuard(fixture);
      expect(result.status, result.output).toBe(0);
    });
  });

  it('still rejects the existing demonstration of ledger violations', () => {
    const result = runGuard(join(root, 'scripts/fixtures/migration-ledger-violations'));
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain('Migration ledger check failed');
    expect(result.output).toContain('migration number(s) are used more than once');
    expect(result.output).toContain('record a version that is not their own');
    expect(result.output).toContain('migration(s) are recorded by nobody');
    expect(result.output).toContain('no longer inserts the applied version');
    expect(result.output).toContain('required-migrations.ts.txt does not match');
  });
});
