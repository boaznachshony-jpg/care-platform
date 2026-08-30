/**
 * The Supabase project ref is the only identifier that survives every form a
 * connection string takes, which is why the environment guards compare it
 * rather than comparing hosts, usernames or whole URLs.
 *
 * The same project is reachable as all of these, and a guard that only knew
 * one shape would wave the other two through:
 *
 *   postgresql://postgres.<ref>:<pw>@aws-1-eu-central-1.pooler.supabase.com:5432/postgres
 *   postgresql://caredesk_app.<ref>:<pw>@aws-1-eu-central-1.pooler.supabase.com:6543/postgres
 *   postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres
 *   https://<ref>.supabase.co
 *
 * Parsing is done with regular expressions on the raw string rather than with
 * `new URL()`, because a password containing an unescaped `#` or `/` makes URL
 * parsing throw or silently mis-split - and a guard that throws on a malformed
 * string it was asked to classify is a guard that can be defeated by a typo.
 */

/**
 * Supabase refs are twenty lowercase alphanumerics. The bound is kept loose so
 * a future change to the ref format degrades into "unrecognised" rather than
 * into a wrong match.
 */
const REF = '[a-z0-9]{16,32}';

/** `postgres.<ref>` or `caredesk_app.<ref>` as the connection username. */
const POOLER_USERNAME = new RegExp(`//[a-z0-9_]+\\.(${REF})[:@]`);

/** `db.<ref>.supabase.co` as the direct-connection host. */
const DIRECT_HOST = new RegExp(`(?:^|[@./])db\\.(${REF})\\.supabase\\.`);

/** `<ref>.supabase.co` as an API or storage host. */
const API_HOST = new RegExp(`(?:^|[@./])(${REF})\\.supabase\\.`);

/**
 * Returns the Supabase project ref a connection string or Supabase URL points
 * at, or `undefined` when the target is not a recognisable Supabase project
 * (a local Postgres container, for example).
 *
 * `undefined` means "not the production project" for every caller: production
 * is a Supabase project, so a target whose ref cannot be read is by definition
 * a different target.
 */
export function extractSupabaseProjectRef(connectionString: string): string | undefined {
  const value = connectionString.trim().toLowerCase();
  if (value.length === 0) return undefined;
  for (const pattern of [POOLER_USERNAME, DIRECT_HOST, API_HOST]) {
    const match = pattern.exec(value);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

/**
 * True when `connectionString` resolves to `productionRef`. Kept separate from
 * the extractor so call sites read as an assertion rather than as a comparison
 * whose `undefined` case has to be reasoned about at every site.
 */
export function pointsAtProject(connectionString: string, productionRef: string): boolean {
  const ref = extractSupabaseProjectRef(connectionString);
  return ref !== undefined && ref === productionRef.trim().toLowerCase();
}
