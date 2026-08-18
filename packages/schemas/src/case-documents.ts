import { z } from 'zod';
import { DOCUMENT_TYPES, SENSITIVITY_CLASSES } from '@caredesk/domain';
import { isoDateSchema } from './date.js';

/**
 * Milestone 1 uploads carry the file inline as base64. Real multipart/form-data
 * streaming straight to object storage is the production shape but needs its
 * own decision (size limits, virus scanning, resumable uploads), so it is not
 * invented here.
 *
 * 5 MiB of raw bytes; base64 inflates by ~4/3, so the encoded string bound is
 * larger than the byte bound it enforces.
 */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const MAX_BASE64_LENGTH = Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4;

/**
 * Deliberately narrow: only formats a family actually uploads for a compliance
 * file, and only ones that render inertly. No SVG (it is a script container),
 * no archives, no office macros.
 */
export const ALLOWED_DOCUMENT_MEDIA_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
] as const;

export const uploadDocumentRequestSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
  sensitivity: z.enum(SENSITIVITY_CLASSES).default('identity_sensitive'),
  mediaType: z.enum(ALLOWED_DOCUMENT_MEDIA_TYPES),
  /** Base64-encoded file bytes. Never logged, never echoed back. */
  content: z.string().min(1).max(MAX_BASE64_LENGTH),
  /**
   * ISO date (YYYY-MM-DD) the document expires, when it has an expiry.
   *
   * An untouched `<input type="date">` submits "", not undefined, so the empty
   * string is normalised away first — otherwise leaving this optional field
   * blank fails the regex and silently blocks the whole form.
   */
  expiresOn: z
    .string()
    .optional()
    .transform((v) => (v === '' ? undefined : v))
    .pipe(isoDateSchema.optional()),
});

export type UploadDocumentRequest = z.infer<typeof uploadDocumentRequestSchema>;

/**
 * List/read projection. Carries no storage key, no checksum and no bytes —
 * a client gets the file only via the separate signed-link endpoint.
 */
export const documentResponseSchema = z.object({
  id: z.string(),
  documentType: z.string(),
  sensitivity: z.string(),
  complianceStatus: z.string(),
  expiresAt: z.string().nullable(),
  status: z.string(),
  currentVersionNumber: z.number().nullable(),
  verificationStatus: z.string().nullable(),
  mediaType: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  uploadedAt: z.string().nullable(),
});

export type DocumentResponse = z.infer<typeof documentResponseSchema>;

export const documentDownloadUrlResponseSchema = z.object({
  /** Short-lived signed link. Issued only after the authorization check passes. */
  url: z.string(),
  expiresInSeconds: z.number(),
});

export type DocumentDownloadUrlResponse = z.infer<typeof documentDownloadUrlResponseSchema>;
