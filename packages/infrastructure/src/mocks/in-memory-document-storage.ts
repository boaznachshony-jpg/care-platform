import type { DocumentStorage, PutObjectInput } from '@caredesk/application';

/** In-memory only — every "URL" is a fake signed link, nothing is ever public. */
export class InMemoryDocumentStorage implements DocumentStorage {
  private readonly objects = new Map<string, PutObjectInput>();

  async putObject(input: PutObjectInput): Promise<{ storageKey: string }> {
    const storageKey = `${input.tenantId}/${input.key}`;
    this.objects.set(storageKey, input);
    return { storageKey };
  }

  async getSignedUrl(storageKey: string, ttlSeconds: number): Promise<string> {
    if (!this.objects.has(storageKey)) {
      throw new Error(`Unknown storage key: ${storageKey}`);
    }
    const expires = Date.now() + ttlSeconds * 1000;
    return `mock://signed/${encodeURIComponent(storageKey)}?expires=${expires}`;
  }

  async deleteObject(storageKey: string): Promise<void> {
    this.objects.delete(storageKey);
  }
}
