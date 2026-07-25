import { createPool } from './pool.js';
import {
  APP_ROLE_NAME,
  assertUsableRolePassword,
  buildGrantConnectSql,
  buildGrantLoginSql,
  derivePoolerUsername,
} from './sql-literal.js';

/**
 * `pnpm db:provision-app-role` — gives the least-privilege `caredesk_app` role
 * (migration 0005) its own LOGIN and password, so the application can connect
 * *as* it instead of connecting as the owner and assuming it per transaction
 * (ADR-002 acceptance evidence).
 *
 * Why this is a script and not a migration: the password must never enter a
 * tracked file. Migrations are committed; this reads the secret from the
 * environment at run time and writes it only to the server.
 *
 * Both inputs come from the environment (load them with
 * `node --env-file=.env.local`, as db:migrate does), never from an argument —
 * a command-line password would land in shell history and in `ps` output.
 *
 *   DATABASE_ADMIN_URL        owner connection (postgres.<project-ref>)
 *   CAREDESK_APP_DB_PASSWORD  the new password for caredesk_app
 *
 * Idempotent: re-running simply re-sets the same attributes and password.
 */

/** Never let a driver error carry the statement text — it holds the password. */
function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_ADMIN_URL;
  const password = process.env.CAREDESK_APP_DB_PASSWORD;

  if (!connectionString) {
    console.error(
      'DATABASE_ADMIN_URL is not set. It must be the owner connection ' +
        '(postgres.<project-ref> through the session pooler on port 5432). ' +
        'Put it in .env.local (gitignored) and retry.',
    );
    process.exit(1);
  }
  if (!password) {
    console.error(
      'CAREDESK_APP_DB_PASSWORD is not set. Generate a strong password, put it ' +
        'in .env.local (gitignored) and retry. Never pass it as an argument.',
    );
    process.exit(1);
  }

  try {
    assertUsableRolePassword(password);
  } catch (error) {
    console.error(`CAREDESK_APP_DB_PASSWORD is unusable: ${safeMessage(error)}`);
    process.exit(1);
  }

  const pool = createPool(connectionString);
  try {
    const existing = await pool.query('select 1 from pg_roles where rolname = $1', [APP_ROLE_NAME]);
    if (existing.rowCount === 0) {
      console.error(
        `Role ${APP_ROLE_NAME} does not exist. Run \`pnpm db:migrate\` first ` +
          '(migration 0005_app_role creates it), then re-run this script.',
      );
      process.exit(1);
    }

    try {
      await pool.query(buildGrantLoginSql(APP_ROLE_NAME, password));
      await pool.query(buildGrantConnectSql(APP_ROLE_NAME));
    } catch (error) {
      // Deliberately re-thrown without the SQL: it embeds the password.
      throw new Error(`Provisioning ${APP_ROLE_NAME} failed: ${safeMessage(error)}`);
    }

    const verified = await pool.query<{ rolcanlogin: boolean; rolbypassrls: boolean }>(
      'select rolcanlogin, rolbypassrls from pg_roles where rolname = $1',
      [APP_ROLE_NAME],
    );
    const row = verified.rows[0];
    if (!row?.rolcanlogin) {
      throw new Error(`${APP_ROLE_NAME} still cannot log in after provisioning.`);
    }
    if (row.rolbypassrls) {
      throw new Error(
        `${APP_ROLE_NAME} holds BYPASSRLS — it would skip every policy. Refusing to report success.`,
      );
    }

    const appUsername = derivePoolerUsername(connectionString, APP_ROLE_NAME) ?? APP_ROLE_NAME;
    console.log(`${APP_ROLE_NAME}: LOGIN granted, NOBYPASSRLS confirmed.`);
    console.log('Now point DATABASE_URL at this role. Through the Supavisor session pooler the');
    console.log(`username is "${appUsername}" (role name + project-ref suffix), port 5432:`);
    console.log(
      `  DATABASE_URL=postgresql://${appUsername}:<password>@<pooler-host>:5432/postgres`,
    );
    console.log('Keep DATABASE_ADMIN_URL for migrations only; the application must not use it.');
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(safeMessage(error));
  process.exit(1);
});
