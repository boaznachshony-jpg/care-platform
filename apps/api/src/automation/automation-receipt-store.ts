import type { Pool } from 'pg';
import { withTenant } from '@caredesk/db';

/**
 * Durable replay receipt for automation execution (migration 0029). The store
 * follows the visa/monthly-close receipt convention (tenant + operation +
 * idempotency key with a request hash), but adds a claim-first phase because
 * plan steps run through the canonical task service on separate connections:
 * the unique constraint on the claim row — not the response insert — is what
 * makes concurrent duplicates safe.
 */
export type AutomationOperation = 'checklist_confirmation' | 'event_plan_commit';

export interface AutomationReceipt<T = unknown> {
  id: string;
  operation: AutomationOperation;
  idempotencyKey: string;
  requestHash: string;
  status: 'in_progress' | 'completed' | 'failed';
  response: T | null;
}

export interface AutomationClaimInput {
  operation: AutomationOperation;
  idempotencyKey: string;
  requestHash: string;
  employmentCaseId: string;
  createdBy: string;
}

export type AutomationClaimResult<T> =
  /** This request owns execution and must complete or fail the receipt. */
  | { outcome: 'claimed'; receiptId: string }
  /** Same request replayed: return the stored receipt, execute nothing. */
  | { outcome: 'replay'; receipt: AutomationReceipt<T> }
  /** A concurrent duplicate is still executing. */
  | { outcome: 'in_progress' }
  /** The key was reused with a different request body. */
  | { outcome: 'hash_mismatch' };

export interface AutomationReceiptStore {
  claim<T>(tenantId: string, input: AutomationClaimInput): Promise<AutomationClaimResult<T>>;
  complete<T>(tenantId: string, receiptId: string, response: T): Promise<void>;
  fail(tenantId: string, receiptId: string): Promise<void>;
}

interface ReceiptRow {
  id: string;
  request_hash: string;
  status: 'in_progress' | 'completed' | 'failed';
  response: unknown;
}

export class PgAutomationReceiptStore implements AutomationReceiptStore {
  constructor(private readonly pool: Pool) {}

  async claim<T>(tenantId: string, input: AutomationClaimInput): Promise<AutomationClaimResult<T>> {
    return withTenant(this.pool, tenantId, async (client) => {
      const inserted = await client.query<{ id: string }>(
        `insert into automation_execution_receipt
           (tenant_id, operation, idempotency_key, employment_case_id, request_hash, created_by)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (tenant_id, operation, idempotency_key) do nothing
         returning id`,
        [
          tenantId,
          input.operation,
          input.idempotencyKey,
          input.employmentCaseId,
          input.requestHash,
          input.createdBy,
        ],
      );
      if (inserted.rows[0]) return { outcome: 'claimed', receiptId: inserted.rows[0].id };

      // A failed execution releases its claim for the retry that follows it.
      const reclaimed = await client.query<{ id: string }>(
        `update automation_execution_receipt
            set status = 'in_progress', request_hash = $3, created_by = $4, created_at = now()
          where operation = $1 and idempotency_key = $2 and status = 'failed'
          returning id`,
        [input.operation, input.idempotencyKey, input.requestHash, input.createdBy],
      );
      if (reclaimed.rows[0]) return { outcome: 'claimed', receiptId: reclaimed.rows[0].id };

      const existing = await client.query<ReceiptRow>(
        `select id, request_hash, status, response from automation_execution_receipt
          where operation = $1 and idempotency_key = $2`,
        [input.operation, input.idempotencyKey],
      );
      const row = existing.rows[0];
      if (!row || row.status === 'in_progress') return { outcome: 'in_progress' };
      if (row.request_hash !== input.requestHash) return { outcome: 'hash_mismatch' };
      return {
        outcome: 'replay',
        receipt: {
          id: row.id,
          operation: input.operation,
          idempotencyKey: input.idempotencyKey,
          requestHash: row.request_hash,
          status: row.status,
          response: row.response as T,
        },
      };
    });
  }

  async complete<T>(tenantId: string, receiptId: string, response: T): Promise<void> {
    await withTenant(this.pool, tenantId, async (client) => {
      await client.query(
        `update automation_execution_receipt
            set status = 'completed', response = $2, completed_at = now()
          where id = $1 and status = 'in_progress'`,
        [receiptId, JSON.stringify(response)],
      );
    });
  }

  async fail(tenantId: string, receiptId: string): Promise<void> {
    await withTenant(this.pool, tenantId, async (client) => {
      await client.query(
        `update automation_execution_receipt
            set status = 'failed'
          where id = $1 and status = 'in_progress'`,
        [receiptId],
      );
    });
  }
}

/**
 * Development/test fallback with identical claim semantics. The synchronous
 * map mutation before any await keeps the claim atomic on the event loop, so
 * route tests exercise the same concurrent-duplicate contract as Postgres.
 */
export class InMemoryAutomationReceiptStore implements AutomationReceiptStore {
  private readonly receipts = new Map<string, AutomationReceipt & { tenantId: string }>();
  private sequence = 0;

  private key(tenantId: string, operation: AutomationOperation, idempotencyKey: string): string {
    return `${tenantId}:${operation}:${idempotencyKey}`;
  }

  async claim<T>(tenantId: string, input: AutomationClaimInput): Promise<AutomationClaimResult<T>> {
    const key = this.key(tenantId, input.operation, input.idempotencyKey);
    const existing = this.receipts.get(key);
    if (!existing || existing.status === 'failed') {
      const receipt: AutomationReceipt & { tenantId: string } = {
        id:
          existing?.id ??
          `00000000-0000-4000-8000-9000000000${String(this.sequence++).padStart(2, '0')}`,
        tenantId,
        operation: input.operation,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        status: 'in_progress',
        response: null,
      };
      this.receipts.set(key, receipt);
      return { outcome: 'claimed', receiptId: receipt.id };
    }
    if (existing.status === 'in_progress') return { outcome: 'in_progress' };
    if (existing.requestHash !== input.requestHash) return { outcome: 'hash_mismatch' };
    return { outcome: 'replay', receipt: existing as AutomationReceipt<T> };
  }

  async complete<T>(tenantId: string, receiptId: string, response: T): Promise<void> {
    for (const receipt of this.receipts.values())
      if (
        receipt.tenantId === tenantId &&
        receipt.id === receiptId &&
        receipt.status === 'in_progress'
      ) {
        receipt.status = 'completed';
        receipt.response = response;
      }
  }

  async fail(tenantId: string, receiptId: string): Promise<void> {
    for (const receipt of this.receipts.values())
      if (
        receipt.tenantId === tenantId &&
        receipt.id === receiptId &&
        receipt.status === 'in_progress'
      )
        receipt.status = 'failed';
  }
}
