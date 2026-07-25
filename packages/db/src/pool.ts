import pg, { Pool, type PoolClient } from 'pg';

/**
 * Return `date` columns as the plain 'YYYY-MM-DD' string Postgres stores.
 *
 * By default node-postgres parses them into a JS Date at local midnight, which
 * then serializes to UTC and can shift the calendar day — a visa expiring on
 * 2026-09-01 came back as 2026-08-31T21:00:00Z. For employment start dates and
 * permit expiry dates a one-day drift is a compliance defect, not a display
 * quirk, so no date value is ever given timezone semantics it doesn't have.
 */
const DATE_OID = 1082;
pg.types.setTypeParser(DATE_OID, (value: string) => value);

/**
 * A single shared pool per process. Supabase's pooler terminates SSL, so we
 * require TLS but don't pin a CA here (the managed endpoint is trusted);
 * tighten to a pinned CA before production.
 */
export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });
}

/**
 * Runs `work` inside a transaction as the least-privilege `caredesk_app` role
 * with the tenant context set, so RLS is actually enforced.
 *
 * Both `SET LOCAL ROLE` and `set_config(..., true)` are transaction-local, so
 * neither can leak to the next borrower of this pooled connection (ADR-002).
 *
 * The role switch is not cosmetic: the connecting role (`postgres` on
 * Supabase) carries BYPASSRLS, which silently skips every policy — a live
 * isolation check caught exactly that. `caredesk_app` is NOBYPASSRLS, so the
 * policies apply. See database/migrations/0005_app_role.sql.
 */
export async function withTenant<T>(
  pool: Pool,
  tenantId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role caredesk_app');
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
