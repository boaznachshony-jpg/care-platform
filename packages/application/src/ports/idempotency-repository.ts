/**
 * Tenant-scoped mutation replay contract. The eventual database adapter owns
 * the unique constraint and request-hash comparison; no API caller supplies a
 * tenant id.
 */
export interface IdempotencyRecord<T> {
  operation: string;
  key: string;
  requestHash: string;
  response: T;
}

export interface IdempotencyRepository {
  findIdempotency<T>(
    tenantId: string,
    operation: string,
    key: string,
  ): Promise<IdempotencyRecord<T> | null>;
  saveIdempotency<T>(tenantId: string, record: IdempotencyRecord<T>): Promise<void>;
}
