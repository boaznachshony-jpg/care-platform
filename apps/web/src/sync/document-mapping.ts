/* eslint-disable no-restricted-syntax -- these are literal legacy data values
   (MvpDocument.category, exactly as DocumentsPage.tsx's own select options
   and stored records already contain them), not UI copy — same rationale as
   the disable comment at the top of DocumentsPage.tsx itself. */
import { DOCUMENT_TYPES, type DocumentType } from '@caredesk/domain';
import { ALLOWED_DOCUMENT_MEDIA_TYPES, type DocumentResponse } from '@caredesk/schemas';
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
 * Known mapping problem #2, file bytes: newer local documents keep their
 * file in a separate device cache (document-file-store.ts — IndexedDB, or a
 * server-side "workspace file" once signed in) rather than inline on the
 * record. Reading that cache into the import call would mean an extra async
 * binary fetch (and, for the signed-in case, a round trip to a *different*
 * server endpoint) per document, which is a bigger and separately-testable
 * change than this cutover. `MvpDocument.dataUrl` — the inline field older
 * records may still carry — is the one this import uses; a record with no
 * `dataUrl` uploads as metadata only, exactly like a document nobody has
 * attached a file to yet, which is the explicitly-supported shape
 * `importDocumentRequestSchema.file` being optional exists for.
 */
export function parseDataUrl(dataUrl: string): { mediaType: string; content: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mediaType: match[1]!, content: match[2]! };
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
