import type { Pool } from 'pg';
import { withTenant } from '@caredesk/db';
import type {
  AcceptedDocument,
  LegalAcceptanceContext,
  LegalAcceptanceRecord,
  LegalDocumentName,
} from '@caredesk/schemas';

/**
 * Recorded acceptance of the terms of service and the privacy policy
 * (`terms_acceptance`, migration 0043).
 *
 * WHAT THIS REPLACES
 * ------------------
 * `BillingPage` had a consent checkbox whose entire persistence was
 * `const [accepted, setAccepted] = useState(false)`. The customer ticked it,
 * the subscription was created, and the fact of the acceptance did not outlive
 * the component. This store is where it now goes, before the subscription is
 * created rather than after.
 *
 * APPEND-ONLY, BY GRANT
 * ---------------------
 * There is no update method and no delete method here, and there is no UPDATE
 * or DELETE grant behind them (0043). That is deliberate to the point of being
 * the reason the table exists: a record that the application can rewrite is not
 * evidence that anybody agreed to anything. Re-accepting the same version is a
 * no-op (`on conflict do nothing` against the unique constraint); accepting a
 * new version is a new row alongside the old one, never a replacement.
 *
 * Every statement goes through `withTenant()` - the one path to the database
 * enforced by scripts/check-tenant-db-path.mjs - so the row level security
 * policy on the table is actually in force.
 */
export interface RecordAcceptanceInput {
  userId: string;
  /** Each document with the version of it that was actually displayed. */
  documents: readonly AcceptedDocument[];
  context: LegalAcceptanceContext;
  correlationId: string;
}

export interface TermsAcceptanceStore {
  /** Idempotent. Returns the stored acceptance for each requested document. */
  record(tenantId: string, input: RecordAcceptanceInput): Promise<LegalAcceptanceRecord[]>;
  /** Every acceptance recorded for this user, newest first. */
  list(tenantId: string, userId: string): Promise<LegalAcceptanceRecord[]>;
}

interface AcceptanceRow {
  document: LegalDocumentName;
  version: string;
  accepted_at: Date;
  context: LegalAcceptanceContext;
}

const toRecord = (row: AcceptanceRow): LegalAcceptanceRecord => ({
  document: row.document,
  version: row.version,
  acceptedAt: row.accepted_at.toISOString(),
  context: row.context,
});

export class PgTermsAcceptanceStore implements TermsAcceptanceStore {
  constructor(private readonly pool: Pool) {}

  async record(tenantId: string, input: RecordAcceptanceInput): Promise<LegalAcceptanceRecord[]> {
    return withTenant(this.pool, tenantId, async (client) => {
      // One statement per document inside one transaction: either both
      // documents are recorded or neither is, so the billing flow cannot
      // proceed having captured the terms but not the privacy policy.
      for (const accepted of input.documents) {
        await client.query(
          `insert into terms_acceptance
             (tenant_id, user_id, document, version, context, correlation_id)
           values ($1, $2, $3, $4, $5, $6)
           on conflict (tenant_id, user_id, document, version) do nothing`,
          [
            tenantId,
            input.userId,
            accepted.document,
            accepted.version,
            input.context,
            input.correlationId,
          ],
        );
      }
      // Read back rather than use `returning`: `do nothing` returns no row for
      // a replay, and the caller is entitled to the same answer either way. The
      // row returned is therefore the FIRST acceptance of that version, which is
      // also the one with evidentiary value.
      const stored = await client.query<AcceptanceRow>(
        `select t.document, t.version, t.accepted_at, t.context
           from terms_acceptance t
           join unnest($2::text[], $3::text[]) as requested (document, version)
             on requested.document = t.document and requested.version = t.version
          where t.user_id = $1
          order by t.accepted_at desc`,
        [
          input.userId,
          input.documents.map((entry) => entry.document),
          input.documents.map((entry) => entry.version),
        ],
      );
      return stored.rows.map(toRecord);
    });
  }

  async list(tenantId: string, userId: string): Promise<LegalAcceptanceRecord[]> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<AcceptanceRow>(
        `select document, version, accepted_at, context
           from terms_acceptance
          where user_id = $1
          order by accepted_at desc`,
        [userId],
      );
      return result.rows.map(toRecord);
    });
  }
}

/**
 * Development/test fallback with the identical contract, including the
 * idempotence. It has no update or delete either: a fallback that allowed a
 * mutation the real store forbids would let a route be written that passes its
 * tests and fails against Postgres.
 */
export class InMemoryTermsAcceptanceStore implements TermsAcceptanceStore {
  private readonly rows: Array<LegalAcceptanceRecord & { tenantId: string; userId: string }> = [];
  private sequence = 0;

  async record(tenantId: string, input: RecordAcceptanceInput): Promise<LegalAcceptanceRecord[]> {
    const matches = (row: { tenantId: string; userId: string }) =>
      row.tenantId === tenantId && row.userId === input.userId;
    for (const accepted of input.documents) {
      const existing = this.rows.find(
        (row) =>
          matches(row) && row.document === accepted.document && row.version === accepted.version,
      );
      if (existing) continue;
      this.rows.push({
        tenantId,
        userId: input.userId,
        document: accepted.document,
        version: accepted.version,
        context: input.context,
        // Monotonic and deterministic so that "newest first" is stable in tests
        // without depending on the resolution of the system clock.
        acceptedAt: new Date(Date.UTC(2026, 0, 1) + this.sequence++ * 1000).toISOString(),
      });
    }
    return this.rows
      .filter(
        (row) =>
          matches(row) &&
          input.documents.some(
            (accepted) => accepted.document === row.document && accepted.version === row.version,
          ),
      )
      .map(({ document, version, acceptedAt, context }) => ({
        document,
        version,
        acceptedAt,
        context,
      }))
      .reverse();
  }

  async list(tenantId: string, userId: string): Promise<LegalAcceptanceRecord[]> {
    return this.rows
      .filter((row) => row.tenantId === tenantId && row.userId === userId)
      .map(({ document, version, acceptedAt, context }) => ({
        document,
        version,
        acceptedAt,
        context,
      }))
      .reverse();
  }
}
