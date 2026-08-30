import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { missingMigrations, REQUIRED_MIGRATIONS } from './required-migrations.js';

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../database/migrations',
);

describe('REQUIRED_MIGRATIONS', () => {
  it('lists exactly the migrations on disk, in order', () => {
    // The list is what /ready compares the live ledger against. A migration
    // missing from it is a migration the deployment gate cannot see - which is
    // how /ready reported ready on a database fourteen migrations behind.
    const onDisk = readdirSync(migrationsDir)
      .filter((name) => /^\d{4}_.*\.sql$/.test(name))
      .sort()
      .map((name) => name.replace(/\.sql$/, ''));

    expect([...REQUIRED_MIGRATIONS]).toEqual(onDisk);
  });

  it('includes the migrations the old to_regclass probe was blind to', () => {
    // The six probed objects all arrive by 0021. These are the tables the
    // customer-facing screens need and the gate never checked.
    expect(REQUIRED_MIGRATIONS).toContain('0023_monthly_payroll_close');
    expect(REQUIRED_MIGRATIONS).toContain('0030_human_escalation_lifecycle');
    expect(REQUIRED_MIGRATIONS).toContain('0037_close_workspace_delete_hole');
  });

  it('covers both migrations that share the number 0026', () => {
    // The ledger keys on the full filename, so the duplicate number must be
    // two entries here. One entry would let the other migration go unnoticed.
    expect(REQUIRED_MIGRATIONS).toContain('0026_canonical_product_intelligence');
    expect(REQUIRED_MIGRATIONS).toContain('0026_wave5_worker_authorization');
  });
});

describe('missingMigrations', () => {
  it('reports nothing when the ledger holds every required version', () => {
    expect(missingMigrations(REQUIRED_MIGRATIONS)).toEqual([]);
  });

  it('reports the three hand-applied migrations when they are absent', () => {
    // The production ledger may be exactly this shape: the schema has the
    // objects, the ledger does not have the rows. /ready must say so.
    const applied = REQUIRED_MIGRATIONS.filter(
      (version) =>
        ![
          '0024_wave4_automation',
          '0027_product_differentiation_completion',
          '0030_human_escalation_lifecycle',
        ].includes(version),
    );

    expect(missingMigrations(applied)).toEqual([
      '0024_wave4_automation',
      '0027_product_differentiation_completion',
      '0030_human_escalation_lifecycle',
    ]);
  });

  it('reports the oldest missing version first, in migration order', () => {
    expect(missingMigrations(['0001_baseline'])[0]).toBe('0002_identity_tenancy');
  });

  it('ignores ledger rows the code does not require', () => {
    // A database ahead of the deployed build is not a reason to fail /ready.
    expect(missingMigrations([...REQUIRED_MIGRATIONS, '0099_from_a_newer_build'])).toEqual([]);
  });
});
