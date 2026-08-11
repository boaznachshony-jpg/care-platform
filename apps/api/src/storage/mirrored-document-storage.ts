import type { DocumentStorage, PutObjectInput } from '@caredesk/application';

/**
 * Writes every object to an independent backup destination before reporting
 * success. Reads always use the primary. User deletion intentionally does not
 * delete the backup copy, preserving recovery from accidental deletion.
 */
export class MirroredDocumentStorage implements DocumentStorage {
  constructor(
    private readonly primary: DocumentStorage,
    private readonly backup: DocumentStorage,
  ) {}

  async putObject(input: PutObjectInput): Promise<{ storageKey: string }> {
    const primary = await this.primary.putObject(input);
    try {
      await this.backup.putObject(input);
    } catch (error) {
      await this.primary.deleteObject(primary.storageKey).catch(() => undefined);
      throw error;
    }
    return primary;
  }

  getSignedUrl(storageKey: string, ttlSeconds: number): Promise<string> {
    return this.primary.getSignedUrl(storageKey, ttlSeconds);
  }

  deleteObject(storageKey: string): Promise<void> {
    return this.primary.deleteObject(storageKey);
  }
}
