import { extractSupabaseProjectRef } from './supabase-project-ref.js';

/**
 * Environment guard for `pnpm db:rls-test`.
 *
 * The script it protects is not read-only. It inserts two synthetic tenants'
 * worth of rows across ~40 tables, runs `create table rls_probe_should_fail`,
 * and its `finally` block executes `drop table if exists rls_probe_should_fail`
 * followed by sixteen `delete from <table> where tenant_id = $1` statements -
 * all over `DATABASE_ADMIN_URL`, the owner credential that carries BYPASSRLS
 * and therefore ignores every row-level policy that would otherwise contain a
 * mistake. `PILOT_RELEASE.md` and `database/README.md` both instruct running it
 * against the live project as a release step.
 *
 * As written the deletes are scoped to `randomUUID()` fixtures, so no customer
 * row matches. That is a property of the current `WHERE` clauses, not of the
 * script - one careless edit and the same block is a mass delete on production
 * with an administrative connection. This guard is what stands between those
 * two states.
 *
 * The rules, in the order they are evaluated:
 *
 *   1. The production project ref is refused unconditionally. No opt-in, no
 *      override, no flag. This is the rule the caller cannot configure away.
 *   2. A loopback-only target is always allowed - that is the CI container and
 *      a developer's local Postgres, both disposable.
 *   3. Any other host requires BOTH an explicit `CAREDESK_RLS_TEST_ALLOW_REMOTE=1`
 *      opt-in AND a `CAREDESK_RLS_TEST_PROJECT_REF` that the operator typed and
 *      that matches every configured connection string.
 *   4. A remote run also requires `PRODUCTION_SUPABASE_PROJECT_REF` to be set,
 *      so rule 1 is always armed when it matters. Without it the run is refused
 *      rather than allowed on the assumption that the target is harmless.
 */

/**
 * Exported so `migrate-target.ts` classifies "disposable local database" with
 * the same list rather than with a second, drifting copy of it.
 */
export const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

/**
 * Reads the host out of a connection string without `new URL()`, which throws
 * on the unescaped characters real Postgres passwords contain. An unreadable
 * host is reported as `undefined` and treated as remote, so a string this
 * function cannot classify never earns the loopback exemption.
 */
export function connectionHost(connectionString: string): string | undefined {
  const afterScheme = connectionString.trim().replace(/^[a-z+]+:\/\//i, '');
  const authorityEnd = afterScheme.search(/[/?]/);
  const authority = authorityEnd === -1 ? afterScheme : afterScheme.slice(0, authorityEnd);
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  if (hostPort.length === 0) return undefined;
  const bracketed = /^\[([^\]]+)\]/.exec(hostPort);
  if (bracketed?.[1]) return bracketed[1].toLowerCase();
  const host = hostPort.split(':')[0];
  return host && host.length > 0 ? host.toLowerCase() : undefined;
}

export interface RlsTestTarget {
  /** Every connection string the run will open, labelled for the error text. */
  readonly connections: ReadonlyArray<{ readonly name: string; readonly url: string }>;
  readonly source: Record<string, string | undefined>;
}

/**
 * Throws when the RLS check must not run against the configured target.
 * Returns silently when it may.
 */
export function assertRlsTestTargetIsSafe({ connections, source }: RlsTestTarget): void {
  const productionRef = source.PRODUCTION_SUPABASE_PROJECT_REF?.trim().toLowerCase();

  for (const connection of connections) {
    const ref = extractSupabaseProjectRef(connection.url);
    if (productionRef && ref === productionRef) {
      throw new Error(
        `db:rls-test refuses to run: ${connection.name} points at the production Supabase project ` +
          `(${productionRef}). This script writes and deletes with a BYPASSRLS connection and has ` +
          `no business touching customer data. There is no override for this check.`,
      );
    }
  }

  const remote = connections.filter((connection) => {
    const host = connectionHost(connection.url);
    return host === undefined || !LOOPBACK_HOSTS.has(host);
  });
  if (remote.length === 0) return;

  const named = remote.map((connection) => connection.name).join(', ');

  if (source.CAREDESK_RLS_TEST_ALLOW_REMOTE !== '1') {
    throw new Error(
      `db:rls-test refuses a non-loopback database (${named}). Point it at a disposable database, ` +
        `or set CAREDESK_RLS_TEST_ALLOW_REMOTE=1 together with CAREDESK_RLS_TEST_PROJECT_REF and ` +
        `PRODUCTION_SUPABASE_PROJECT_REF to run it against a named non-production project.`,
    );
  }

  if (!productionRef) {
    throw new Error(
      `db:rls-test refuses a remote run while PRODUCTION_SUPABASE_PROJECT_REF is unset: without it ` +
        `the production project cannot be recognised, so the run cannot be proved safe.`,
    );
  }

  const expectedRef = source.CAREDESK_RLS_TEST_PROJECT_REF?.trim().toLowerCase();
  if (!expectedRef) {
    throw new Error(
      `db:rls-test requires CAREDESK_RLS_TEST_PROJECT_REF for a remote run (${named}): the operator ` +
        `must state which project ref they expect before the script writes anything.`,
    );
  }

  for (const connection of remote) {
    const ref = extractSupabaseProjectRef(connection.url);
    if (ref !== expectedRef) {
      throw new Error(
        `db:rls-test refuses to run: ${connection.name} resolves to project ref ` +
          `${ref ?? '(unrecognised)'}, but CAREDESK_RLS_TEST_PROJECT_REF expects ${expectedRef}.`,
      );
    }
  }
}
