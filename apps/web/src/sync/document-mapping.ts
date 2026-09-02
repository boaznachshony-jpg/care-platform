/* eslint-disable no-restricted-syntax -- these are literal legacy data values
   (MvpDocument.category, exactly as DocumentsPage.tsx's own select options
   and stored records already contain them), not UI copy — same rationale as
   the disable comment at the top of DocumentsPage.tsx itself. */
import { DOCUMENT_TYPES, type DocumentType } from '@caredesk/domain';
import {
  ALLOWED_DOCUMENT_MEDIA_TYPES,
  MAX_DOCUMENT_BYTES,
  type DocumentResponse,
} from '@caredesk/schemas';
import { readLocalDocumentFileForImport } from '../storage/document-file-store.js';
import type { MvpDocument, MvpDocumentStatus } from '../storage/mvp-storage.js';

/**
 * Known mapping problem #2: the local `category` field is a free Hebrew
 * string picked from a fixed select (see DocumentsPage.tsx's option list),
 * not the canonical `documentType` enum. This table is the one place the
 * translation lives, in both directions, so upload and display use the same
 * mapping and can't drift apart.
 *
 * "אישור בנק" (bank confirmation) has no canonical twin — DOCUMENT_TYPES has
 * nothing about banking — so it folds into `'other'` like any category the
 * table doesn't recognise. That is a lossy upload (the specific "it's a bank
 * letter" nuance is not preserved server-side), which is disclosed here
 * rather than silently invented as a new enum value that would need its own
 * migration and its own i18n keys for a single legacy label.
 */
const CATEGORY_TO_DOCUMENT_TYPE: Record<string, DocumentType> = {
  דרכון: 'passport',
  'אשרת עבודה': 'visa',
  'ביטוח רפואי': 'insurance_policy',
  'חוזה העסקה': 'employment_contract',
  'תלוש שכר': 'payroll',
};

const DOCUMENT_TYPE_TO_CATEGORY: Record<DocumentType, string> = {
  passport: 'דרכון',
  visa: 'אשרת עבודה',
  insurance_policy: 'ביטוח רפואי',
  employment_contract: 'חוזה העסקה',
  payroll: 'תלוש שכר',
  medical: 'ביטוח רפואי',
  other: 'מסמך אחר',
};

export function localCategoryToDocumentType(category: string): DocumentType {
  return CATEGORY_TO_DOCUMENT_TYPE[category] ?? 'other';
}

export function documentTypeToLocalCategory(documentType: string): string {
  return (DOCUMENT_TYPE_TO_CATEGORY as Record<string, string>)[documentType] ?? 'מסמך אחר';
}

/**
 * Known mapping problem #2, continued: `dateLabel` is a pre-formatted
 * display string ("בתוקף עד DD.MM.YYYY"), not the canonical ISO `expiresOn`.
 * Mirrors `toDateInputValue`/`formatExpiryDate` in DocumentsPage.tsx — kept
 * here instead of imported from the page so this module has no dependency on
 * a React component.
 */
export function dateLabelToIsoDate(dateLabel: string): string {
  const isoMatch = dateLabel.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const displayMatch = dateLabel.match(/\b(\d{2})[./](\d{2})[./](\d{4})\b/);
  if (displayMatch) return `${displayMatch[3]}-${displayMatch[2]}-${displayMatch[1]}`;
  return '';
}

export function isoDateToDateLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  if (!year || !month || !day) return '';
  return `בתוקף עד ${day}.${month}.${year}`;
}

export function isAllowedDocumentMediaType(
  value: string,
): value is (typeof ALLOWED_DOCUMENT_MEDIA_TYPES)[number] {
  return (ALLOWED_DOCUMENT_MEDIA_TYPES as readonly string[]).includes(value);
}

/**
 * Known mapping problem #2, file bytes — now closed. `MvpDocument.dataUrl` is
 * the inline field the oldest local records may still carry; newer local
 * documents keep their file in a separate device cache instead
 * (document-file-store.ts — IndexedDB, or a server-side "workspace file" once
 * signed in on a `/clients/:clientId` route). `resolveDocumentImportFile`
 * below tries both, in that order, so either shape reaches the server. A
 * record with neither uploads as metadata only, exactly like a document
 * nobody has attached a file to yet — the explicitly-supported shape
 * `importDocumentRequestSchema.file` being optional exists for.
 */
export function parseDataUrl(dataUrl: string): { mediaType: string; content: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mediaType: match[1]!, content: match[2]! };
}

/**
 * Base64 is ~4/3 the raw byte size; this mirrors `MAX_BASE64_LENGTH` in
 * packages/schemas/src/case-documents.ts so an oversized attachment is
 * rejected client-side, before a network round trip, rather than only by the
 * server's Zod schema.
 */
const MAX_BASE64_CONTENT_LENGTH = Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4;

/**
 * The one place that decides what file bytes (if any) travel with a local
 * document's metadata during the legacy-upload cutover. Tries, in order:
 *
 *  1. an inline `dataUrl` on the record (oldest local shape);
 *  2. this browser's file caches — IndexedDB, or server-side workspace
 *     storage when the browser is signed in and the legacy client is known
 *     (see `readLocalDocumentFileForImport` in document-file-store.ts for why
 *     both exist and which documents end up in which one).
 *
 * A media type outside `ALLOWED_DOCUMENT_MEDIA_TYPES` or a payload over the
 * server's size cap degrades to "no file" (`undefined`) rather than blocking
 * the metadata import — the same "not an error" treatment as a document that
 * never had a file at all. A genuine fetch failure while retrieving bytes
 * that ARE known to exist is not swallowed here: it propagates so the
 * caller's `importOne` throws and the whole record (metadata included) is
 * marked failed and retryable, rather than silently importing metadata-only
 * when a real file was sitting right there and simply could not be reached
 * this time.
 */
export async function resolveDocumentImportFile(
  localDocument: Pick<MvpDocument, 'id' | 'dataUrl'>,
  legacyClientId: string | null,
): Promise<
  { mediaType: (typeof ALLOWED_DOCUMENT_MEDIA_TYPES)[number]; content: string } | undefined
> {
  const inline = localDocument.dataUrl ? parseDataUrl(localDocument.dataUrl) : null;
  if (
    inline &&
    isAllowedDocumentMediaType(inline.mediaType) &&
    inline.content.length <= MAX_BASE64_CONTENT_LENGTH
  ) {
    // Rebuilt as a fresh literal, not returned as `inline` directly: the type
    // guard above narrows the *access* `inline.mediaType`, not the static
    // type of the `inline` object itself, so returning `inline` verbatim
    // would still widen `mediaType` back to `string`.
    return { mediaType: inline.mediaType, content: inline.content };
  }

  const cached = await readLocalDocumentFileForImport(localDocument.id, legacyClientId);
  if (
    cached &&
    isAllowedDocumentMediaType(cached.mediaType) &&
    cached.content.length <= MAX_BASE64_CONTENT_LENGTH
  ) {
    return { mediaType: cached.mediaType, content: cached.content };
  }

  return undefined;
}

/**
 * `complianceStatus` is computed server-side from `expiresAt`; the local
 * `'valid' | 'attention'` field has no canonical input, only a display-side
 * approximation on the way back down (used when this browser is showing a
 * document it fetched from the server rather than one it holds locally).
 */
export function complianceStatusToLocalStatus(complianceStatus: string): MvpDocumentStatus {
  return complianceStatus === 'expired' || complianceStatus === 'expiring' ? 'attention' : 'valid';
}

export function documentResponseToLocal(response: DocumentResponse): MvpDocument {
  return {
    id: response.legacyLocalId ?? response.id,
    name: documentTypeToLocalCategory(response.documentType),
    category: documentTypeToLocalCategory(response.documentType),
    dateLabel: response.expiresAt ? isoDateToDateLabel(response.expiresAt.slice(0, 10)) : '',
    status: complianceStatusToLocalStatus(response.complianceStatus),
    // No filename travels in DocumentResponse (Constitution §16 — a client
    // never learns the storage key); the media type is the closest available
    // stand-in and is only ever used for the (currently empty) file-open flow.
    fileName: '',
    fileType: response.mediaType ?? '',
    updatedAt: response.uploadedAt ?? '',
  };
}

export { DOCUMENT_TYPES };
