import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { REQUIRED_MIGRATIONS } from './required-migrations.js';

const migrationUrl = new URL(
  '../../../database/migrations/0045_money_is_a_model.sql',
  import.meta.url,
);
const billing0036Url = new URL(
  '../../../database/migrations/0036_billing_lifecycle_recovery.sql',
  import.meta.url,
);

async function sql(): Promise<string> {
  return readFile(migrationUrl, 'utf8');
}

/**
 * The SQL the database actually executes, with comments removed.
 *
 * Migrations in this repo quote the defect they remove, verbatim: 0045's
 * header prints `next_charge_on = (v_period + interval '1 month')::date` while
 * explaining DOM-16, and 0043 discusses grants it does not make. An assertion
 * of the form "this migration must no longer contain X" therefore has to read
 * the executable half, or the paragraph explaining the fix is what fails the
 * test for the fix — which is exactly what happened here.
 *
 * Same helper, and the same reason, as
 * packages/testing/src/tenant-isolation-coverage.test.ts.
 */
function executableSql(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\r\n]*/g, ' ');
}

async function executable(): Promise<string> {
  return executableSql(await sql());
}

describe('0045 — money is a model', () => {
  it('is registered in the ledger the runner and /ready read', async () => {
    expect(REQUIRED_MIGRATIONS).toContain('0045_money_is_a_model');
    expect(await sql()).toContain(
      "insert into schema_migrations (version) values ('0045_money_is_a_model');",
    );
  });

  it('revokes PUBLIC execute on every function it creates', async () => {
    const text = await sql();
    const created = [...text.matchAll(/^create function ([a-z_]+)\(/gm)].map((match) => match[1]);
    expect(created.length).toBeGreaterThan(0);
    for (const name of created) {
      // Postgres grants EXECUTE to PUBLIC by default; this schema has been
      // bitten by that five times.
      expect(text).toMatch(new RegExp(`revoke all privileges on function ${name}\\(`));
    }
  });

  it('is additive: it drops no column, deletes no row and rewrites no existing value', async () => {
    const text = await sql();
    const code = await executable();
    expect(code).not.toMatch(/drop column/i);
    expect(code).not.toMatch(/delete from/i);
    // The single UPDATE writes only the new column, and only where it is unset.
    const updates = [...text.matchAll(/^update ([a-z_]+)$/gm)];
    expect(updates).toHaveLength(1);
    expect(text).toContain('set billing_anchor_day = extract(day from');
    expect(text).toContain('where billing_anchor_day is null');
  });

  it('adds the payroll reconciliation constraint NOT VALID so history is not re-judged', async () => {
    const text = await sql();
    expect(text).toContain('add constraint payroll_entry_total_reconciles_agorot');
    expect(text).toMatch(/payroll_entry_total_reconciles_agorot[\s\S]*?not valid;/);
  });

  /** DOM-04: the money arithmetic in the database is integer agorot. */
  it('computes the expected payroll total in bigint agorot with one rounding step', async () => {
    const text = await sql();
    expect(text).toContain('create function caredesk_payroll_expected_total_agorot(');
    const body = text.slice(
      text.indexOf('create function caredesk_payroll_expected_total_agorot('),
      text.indexOf('alter table payroll_entry'),
    );
    expect(body).toContain('returns bigint');
    // The only round() left is the fractional rest-day product.
    expect([...body.matchAll(/round\(/g)]).toHaveLength(1);
    expect(body).toContain('round(caredesk_agorot(rest_day_rate) * paid_rest_days)');
    // And no `round(…, 2)` anywhere — that was the shape 0041 had to use.
    expect(body).not.toMatch(/round\([^)]*,\s*2\)/);
  });

  /** DOM-09: a partial discount is charged rather than skipped. */
  it('claims due charges by effective price instead of filtering on a zero discount', async () => {
    const text = await sql();
    const legacy = await readFile(billing0036Url, 'utf8');
    expect(legacy).toContain('s.launch_discount_percent = 0');
    expect(await executable()).not.toContain('s.launch_discount_percent = 0');
    expect(text).toContain(
      'caredesk_effective_price_agorot(s.price_agorot, s.launch_discount_percent) > 0',
    );
    expect(text).toContain(
      'caredesk_effective_price_agorot(d.price_agorot, d.launch_discount_percent)',
    );
  });

  it('defines the effective price with the same rule as packages/domain', async () => {
    expect(await sql()).toContain(
      'select round(price_agorot::numeric * (100 - discount_percent) / 100.0)::integer',
    );
  });

  /** DOM-16: the anniversary is anchored, not chained. */
  it('advances next_charge_on from the stored anchor day', async () => {
    const text = await sql();
    const legacy = await readFile(billing0036Url, 'utf8');
    expect(
      await readFile(
        new URL('../../../database/migrations/0014_product_billing.sql', import.meta.url),
        'utf8',
      ),
    ).toContain("next_charge_on = (v_period + interval '1 month')::date");
    expect(await executable()).not.toContain(
      "next_charge_on = (v_period + interval '1 month')::date",
    );
    expect(text).toContain(
      'next_charge_on = caredesk_next_charge_on(v_period, billing_anchor_day)',
    );
    expect(text).toContain('add column if not exists billing_anchor_day smallint');
    // The G-5 attempt-cycle exit from migration 0036 survives the rewrite.
    expect(legacy).toContain('product_billing_charge.attempt_cycle < 10');
    expect(text).toContain('product_billing_charge.attempt_cycle < 10');
  });

  /** DOM-20: the rest day becomes a stored per-case fact with no silent default. */
  it('adds weekly_rest_day as nullable with no Saturday default', async () => {
    const text = await sql();
    expect(text).toContain('add column if not exists weekly_rest_day smallint');
    expect(text).toContain('check (weekly_rest_day is null or weekly_rest_day in (0, 5, 6))');
    expect(await executable()).not.toMatch(/weekly_rest_day\s+smallint[^;]*default/);
  });
});
