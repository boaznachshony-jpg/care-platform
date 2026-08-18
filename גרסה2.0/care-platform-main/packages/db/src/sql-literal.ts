import pg from 'pg';

/**
 * Safe quoting for the one place we cannot use a bind parameter.
 *
 * `ALTER ROLE ... PASSWORD` is utility (not DML) syntax, so PostgreSQL will
 * not accept `$1` there — the password has to be embedded in the statement
 * text. That makes this the single highest-risk string in the repository: a
 * naive concatenation of a punctuation-heavy (or attacker-influenced)
 * password would be a SQL-injection hole executed with owner privileges.
 *
 * These helpers are deliberately pure and kept out of the CLI module so they
 * can be unit-tested without a database (see sql-literal.test.ts).
 */

/** The least-privilege application role created by migration 0005. */
export const APP_ROLE_NAME = 'caredesk_app';

/**
 * Short passwords are a configuration mistake, not a policy nuance: this role
 * is reachable from the public internet through the Supabase pooler.
 */
export const MIN_APP_ROLE_PASSWORD_LENGTH = 24;

/** Unquoted-safe role names only; anything else is a caller bug, not input. */
const SAFE_ROLE_NAME = /^[a-z_][a-z0-9_]*$/;

/** PostgreSQL cannot store NUL in a text value at all. */
const NUL = String.fromCharCode(0);

/** Unicode "control" category — C0 and C1 control characters. */
const CONTROL_CHARACTER = /\p{Cc}/u;

/**
 * Quotes a string as a PostgreSQL literal using node-postgres' own escaper,
 * which doubles single quotes and switches to the `E'...'` form when the value
 * contains a backslash — so `standard_conforming_strings` cannot change the
 * meaning of the statement.
 *
 * NUL is rejected rather than escaped: silently truncating a password there
 * would provision a credential that is not what the operator set.
 */
export function quoteSqlLiteral(value: string): string {
  if (value.includes(NUL)) {
    throw new Error('Value contains a NUL byte, which PostgreSQL cannot store in a text value.');
  }
  return pg.escapeLiteral(value);
}

/** Quotes an identifier, doubling any embedded double quote. */
export function quoteSqlIdentifier(name: string): string {
  return pg.escapeIdentifier(name);
}

/**
 * Validates a candidate password for the application role. Throws with an
 * operator-readable message; the message never contains the password itself.
 */
export function assertUsableRolePassword(password: string): void {
  if (password.length < MIN_APP_ROLE_PASSWORD_LENGTH) {
    throw new Error(
      `Password is too short (${String(password.length)} characters); at least ` +
        `${String(MIN_APP_ROLE_PASSWORD_LENGTH)} are required.`,
    );
  }
  if (password.includes(NUL)) {
    throw new Error('Password contains a NUL byte, which PostgreSQL cannot store.');
  }
  // Any other control character is almost always an env-file quoting accident
  // (a stray newline, a pasted tab). Fail loudly rather than provision a
  // credential the operator cannot reproduce.
  if (CONTROL_CHARACTER.test(password)) {
    throw new Error(
      'Password contains a control character — check for a stray newline or tab in .env.local.',
    );
  }
}

/**
 * Builds the idempotent statement that turns the app role into a real login.
 *
 * `nobypassrls` is reasserted in the same statement on purpose: the entire
 * point of this role is that it cannot skip RLS, so re-running provisioning
 * should repair that attribute if anything ever flipped it.
 *
 * The returned string contains the password in clear text — never log it and
 * never put it in an error message.
 */
export function buildGrantLoginSql(roleName: string, password: string): string {
  assertSafeRoleName(roleName);
  assertUsableRolePassword(password);
  return (
    `alter role ${quoteSqlIdentifier(roleName)} ` +
    `with login nobypassrls password ${quoteSqlLiteral(password)}`
  );
}

/**
 * Grants CONNECT on the current database to the role, written the way
 * migration 0005 discovered it has to be written: the identifier is
 * interpolated server-side by `format('%I', ...)` inside a DO block, because
 * spelling `current_user` / `current_database()` directly into a GRANT makes
 * Supabase's Supavisor pooler drop the connection mid-statement.
 *
 * PUBLIC normally already holds CONNECT, so this is belt-and-braces for
 * databases where that default was revoked.
 */
export function buildGrantConnectSql(roleName: string): string {
  assertSafeRoleName(roleName);
  return `do $$
begin
  execute format('grant connect on database %I to %I', current_database(), ${quoteSqlLiteral(
    roleName,
  )});
end
$$`;
}

/**
 * Through the Supavisor pooler the username is `<role>.<project-ref>`, so the
 * application username is derived from the administrative one. Returns
 * undefined when the admin URL is not in the pooler form (a plain local
 * Postgres, say), in which case the bare role name is the username.
 *
 * Only the username is parsed; the password in the URL is never touched.
 */
export function derivePoolerUsername(
  adminConnectionString: string,
  roleName: string,
): string | undefined {
  let adminUser: string;
  try {
    adminUser = decodeURIComponent(new URL(adminConnectionString).username);
  } catch {
    return undefined;
  }
  const separator = adminUser.indexOf('.');
  if (separator <= 0 || separator === adminUser.length - 1) {
    return undefined;
  }
  return `${roleName}${adminUser.slice(separator)}`;
}

function assertSafeRoleName(roleName: string): void {
  if (!SAFE_ROLE_NAME.test(roleName)) {
    throw new Error(`Refusing to build SQL for unexpected role name: ${JSON.stringify(roleName)}`);
  }
}
