/**
 * Private-object-storage port (database-blueprint.md §4.5). No public URLs,
 * ever — only short-lived signed links issued after an authorization check.
 */
export interface PutObjectInput {
  tenantId: string;
  key: string;
  contentType: string;
  body: Uint8Array;
}

export interface DocumentStorage {
  putObject(input: PutObjectInput): Promise<{ storageKey: string }>;
  getSignedUrl(storageKey: string, ttlSeconds: number): Promise<string>;
}
