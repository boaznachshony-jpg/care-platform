import { connectionHost, LOOPBACK_HOSTS } from './rls-check-target.js';
import { extractSupabaseProjectRef } from './supabase-project-ref.js';

/**
 * Environment guard for `pnpm db:migrate`.
 *
 * This is deliberately NOT the same rule as `assertRlsTestTargetIsSafe`. That
 * guard refuses the production project unconditionally, because the RLS check
 * has no business touching customer data. Migrations are the opposite: running
 * them against production is the whole point. So the shape here is "state your
 * target and mean it", not "never".
 *
 * The primitives are shared rather than reimplemented - `connectionHost` and
 * `extractSupabaseProjectRef` are the same functions the RLS guard uses, and
 * the ref comparison is the same comparison. Only the verdict differs.
 *
 * The rules, in the order they are evaluated:
 *
 *   1. A loopback target is always allowed - a local container is disposable.
 *   2. Any other host requires PRODUCTION_SUPABASE_PROJECT_REF to be set, so
 *      rule 3 is armed. Without it the runner cannot tell production from a
 *      sandbox, and an unclassifiable target is refused rather than assumed
 *      harmless.
 *   3. Any other host requires CAREDESK_MIGRATE_PROJECT_REF - the ref the
 *      operator believes they are pointing at - and it must match the ref the
 *      connection string actually resolves to. This is the check that catches
 *      the .env.local left open in the other window.
 *   4. When the target IS production, it additionally requires
 *      CAREDESK_MIGRATE_ALLOW_PRODUCTION=1. Typing the production ref by
 *      itself is not enough; production needs a second, separate act.
 */
export interface MigrationTarget {
  /** The connection string the run will open, labelled for the error text. */
  readonly name: string;
  readonly url: string;
  readonly source: Record<string, string | undefined>;
}

/**
 * Throws when the migration run must not proceed against the configured
 * target. Returns the resolved project ref (or undefined for a non-Supabase
 * target) when it may, so the caller can print what it is about to touch.
 */
export function assertMigrationTargetIsAllowed({
  name,
  url,
  source,
}: MigrationTarget): string | undefined {
  const host = connectionHost(url);
  const ref = extractSupabaseProjectRef(url);

  if (host !== undefined && LOOPBACK_HOSTS.has(host)) {
    return ref;
  }

  const productionRef = source.PRODUCTION_SUPABASE_PROJECT_REF?.trim().toLowerCase();
  if (!productionRef) {
    throw new Error(
      `db:migrate refuses a non-loopback database (${name} -> ${host ?? 'unreadable host'}) while ` +
        `PRODUCTION_SUPABASE_PROJECT_REF is unset: without it the production project cannot be ` +
        `recognised, so the run cannot be proved to be going where you think it is.`,
    );
  }

  const expectedRef = source.CAREDESK_MIGRATE_PROJECT_REF?.trim().toLowerCase();
  if (!expectedRef) {
    throw new Error(
      `db:migrate requires CAREDESK_MIGRATE_PROJECT_REF for a remote run (${name}): state which ` +
        `Supabase project ref you expect to migrate before the runner applies any DDL.`,
    );
  }

  if (ref !== expectedRef) {
    throw new Error(
      `db:migrate refuses to run: ${name} resolves to project ref ${ref ?? '(unrecognised)'}, but ` +
        `CAREDESK_MIGRATE_PROJECT_REF expects ${expectedRef}. Check which .env file is loaded.`,
    );
  }

  if (ref === productionRef && source.CAREDESK_MIGRATE_ALLOW_PRODUCTION !== '1') {
    throw new Error(
      `db:migrate refuses to migrate production (${productionRef}) without an explicit opt-in. ` +
        `Take a backup, run with --dry-run first, then set CAREDESK_MIGRATE_ALLOW_PRODUCTION=1.`,
    );
  }

  return ref;
}
