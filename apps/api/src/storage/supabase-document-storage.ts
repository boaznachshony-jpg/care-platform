import type { DocumentStorage, PutObjectInput } from '@caredesk/application';

type FetchLike = typeof globalThis.fetch;

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/** Server-only adapter for a private Supabase Storage bucket. */
export class SupabaseDocumentStorage implements DocumentStorage {
  constructor(
    private readonly supabaseUrl: string,
    private readonly serviceRoleKey: string,
    private readonly bucket: string,
    private readonly fetchImpl: FetchLike = globalThis.fetch,
  ) {}

  private headers(contentType?: string): Record<string, string> {
    return {
      apikey: this.serviceRoleKey,
      authorization: `Bearer ${this.serviceRoleKey}`,
      ...(contentType ? { 'content-type': contentType } : {}),
    };
  }

  private objectPath(storageKey: string): string {
    return `${encodeURIComponent(this.bucket)}/${encodePath(storageKey)}`;
  }

  async putObject(input: PutObjectInput): Promise<{ storageKey: string }> {
    const storageKey = `${input.tenantId}/${input.key}`;
    const response = await this.fetchImpl(
      `${this.supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${this.objectPath(storageKey)}`,
      {
        method: 'POST',
        headers: {
          ...this.headers(input.contentType),
          'x-upsert': 'false',
          'cache-control': 'no-store',
        },
        body: input.body,
      },
    );
    if (!response.ok) throw new Error(`Private object upload failed (${response.status}).`);
    return { storageKey };
  }

  async getSignedUrl(storageKey: string, ttlSeconds: number): Promise<string> {
    const baseUrl = this.supabaseUrl.replace(/\/$/, '');
    const response = await this.fetchImpl(
      `${baseUrl}/storage/v1/object/sign/${this.objectPath(storageKey)}`,
      {
        method: 'POST',
        headers: this.headers('application/json'),
        body: JSON.stringify({ expiresIn: ttlSeconds }),
      },
    );
    if (!response.ok) throw new Error(`Private signed URL creation failed (${response.status}).`);
    const body = (await response.json()) as { signedURL?: unknown; signedUrl?: unknown };
    const signed = typeof body.signedURL === 'string' ? body.signedURL : body.signedUrl;
    if (typeof signed !== 'string' || !signed) throw new Error('Storage returned no signed URL.');
    if (signed.startsWith('http')) return signed;
    if (signed.startsWith('/storage/v1/')) return `${baseUrl}${signed}`;
    return `${baseUrl}/storage/v1${signed.startsWith('/') ? signed : `/${signed}`}`;
  }

  async deleteObject(storageKey: string): Promise<void> {
    const response = await this.fetchImpl(
      `${this.supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${this.objectPath(storageKey)}`,
      { method: 'DELETE', headers: this.headers() },
    );
    if (!response.ok && response.status !== 404) {
      throw new Error(`Private object deletion failed (${response.status}).`);
    }
  }
}
