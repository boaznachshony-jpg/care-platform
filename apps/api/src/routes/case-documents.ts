import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthorizationError, type DocumentWithCurrentVersion } from '@caredesk/application';
import { withTenant } from '@caredesk/db';
import {
  MAX_DOCUMENT_BYTES,
  uploadDocumentRequestSchema,
  importDocumentRequestSchema,
  type DocumentResponse,
  type DocumentDownloadUrlResponse,
} from '@caredesk/schemas';
import type { Container } from '../container.js';
import { makeAuthenticate } from '../plugins/authenticate.js';
import { sendError, sendValidationError } from './http-errors.js';

interface CaseParams {
  caseId: string;
}

interface DocumentParams extends CaseParams {
  documentId: string;
}

const documentParamsSchema = z.object({
  caseId: z.string().uuid(),
  documentId: z.string().uuid(),
});

/**
 * The human decision that closes a document-AI intake proposal. Deliberately
 * metadata-only: field *keys*, validation outcomes and provenance are durable
 * evidence; the extracted values themselves (names, dates) are never stored in
 * the review receipt — raw OCR/AI output stays out of durable records
 * (migration 0024's contract).
 */
const intakeReviewBodySchema = z
  .object({
    classification: z.object({
      family: z.string().trim().min(1).max(80),
      confidence: z.number().min(0).max(1),
      provenance: z.enum(['ocr', 'ai', 'user']),
    }),
    reviewState: z.enum(['user_confirmed', 'cancelled']),
    fields: z
      .array(
        z
          .object({
            key: z.enum(['holder_name', 'issue_date', 'expiry_date']),
            validationStatus: z.enum(['valid', 'invalid', 'ambiguous', 'unverified']),
            provenance: z.enum(['ocr', 'ai', 'user']),
            userConfirmed: z.boolean(),
          })
          .strict(),
      )
      .max(10)
      .default([]),
    providerName: z.string().trim().min(1).max(100).optional(),
    providerRequestId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

interface IntakeReviewResponse {
  id: string;
  caseId: string;
  documentId: string;
  documentVersionId: string;
  classification: string;
  reviewState: 'user_confirmed' | 'cancelled';
  confirmedFields: unknown;
  providerName: string | null;
  providerRequestId: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  createdAt: string;
}

/**
 * Projection boundary: the storage key and checksum exist on the entity but are
 * deliberately absent here. A client never learns where a file physically
 * lives — it only ever receives a short-lived signed link (Constitution §16).
 */
function toResponse(entry: DocumentWithCurrentVersion): DocumentResponse {
  const { document, currentVersion } = entry;
  return {
    id: document.id,
    documentType: document.documentType,
    sensitivity: document.sensitivity,
    complianceStatus: document.complianceStatus,
    expiresAt: document.expiresAt,
    status: document.status,
    currentVersionNumber: currentVersion?.versionNumber ?? null,
    verificationStatus: currentVersion?.verificationStatus ?? null,
    mediaType: currentVersion?.mediaType ?? null,
    sizeBytes: currentVersion?.sizeBytes ?? null,
    uploadedAt: currentVersion?.createdAt ?? null,
    legacyLocalId: document.legacyLocalId,
  };
}

/**
 * Case documents. Every route authenticates, then the use case runs the
 * deny-by-default authorization check — the route never decides access itself.
 */
export function registerCaseDocumentRoutes(app: FastifyInstance, container: Container): void {
  const authenticate = makeAuthenticate(container.auth, container.actorResolver);
  const options = { preHandler: authenticate };

  /**
   * Base64 inflates bytes by ~4/3, and Fastify's default body limit is 1 MiB —
   * without raising it here every upload over ~750 KiB would fail as a bare 413
   * before Zod could produce a field-level message. Scoped to this one route so
   * no other endpoint accepts a large body.
   */
  const uploadOptions = {
    preHandler: authenticate,
    bodyLimit: Math.ceil((MAX_DOCUMENT_BYTES * 4) / 3) + 64 * 1024,
  };

  app.get<{ Params: CaseParams }>('/cases/:caseId/documents', options, async (request, reply) => {
    const actor = request.actor;
    if (!actor) return;
    try {
      const rows = await container.listDocuments.execute(actor, request.params.caseId);
      reply.send(rows.map(toResponse));
    } catch (error) {
      if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
      throw error;
    }
  });

  app.post<{ Params: CaseParams }>(
    '/cases/:caseId/documents',
    uploadOptions,
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;

      const parsed = uploadDocumentRequestSchema.safeParse(request.body);
      // The failing body is never echoed back or logged: it contains file bytes.
      if (!parsed.success) return sendValidationError(request, reply, parsed.error);

      try {
        const created = await container.uploadDocument.execute(
          actor,
          request.params.caseId,
          parsed.data,
        );
        reply.status(201).send(toResponse(created));
      } catch (error) {
        if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
        throw error;
      }
    },
  );

  /**
   * Idempotent import for the UI cutover — see ImportCaseDocument. Reuses the
   * upload route's raised body limit: an imported record may carry the same
   * base64 file content an upload would.
   */
  app.post<{ Params: CaseParams }>(
    '/cases/:caseId/documents/import',
    uploadOptions,
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      const parsed = importDocumentRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(request, reply, parsed.error);
      try {
        const imported = await container.importDocument.execute(
          actor,
          request.params.caseId,
          parsed.data,
        );
        reply.status(200).send(toResponse(imported));
      } catch (error) {
        if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
        throw error;
      }
    },
  );

  app.get<{ Params: DocumentParams }>(
    '/cases/:caseId/documents/:documentId/download-url',
    options,
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      try {
        const link = await container.getDocumentDownloadUrl.execute(
          actor,
          request.params.caseId,
          request.params.documentId,
        );
        // null means unknown, other tenant, other case, or no file yet — all
        // reported identically so no caller can probe for document ids.
        if (!link) return sendError(request, reply, 404, 'NOT_FOUND');
        const body: DocumentDownloadUrlResponse = link;
        reply.send(body);
      } catch (error) {
        if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
        throw error;
      }
    },
  );

  // Development fallback store (no DATABASE_URL): append-only, never exposed.
  const memoryIntakeReviews: IntakeReviewResponse[] = [];

  /**
   * Document-AI review confirmation receipt (capability #10 gap): the human
   * decision that confirmed or cancelled an AI/OCR intake proposal becomes
   * durable evidence in `document_intake_review` (migration 0024), and the
   * decision itself is synchronized to `audit_event` + `timeline_event` so the
   * confirmation is fully evidenced. Metadata only — extracted values, file
   * bytes and provider payloads never enter the receipt.
   */
  app.post<{ Params: DocumentParams }>(
    '/cases/:caseId/documents/:documentId/intake-reviews',
    options,
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      const params = documentParamsSchema.safeParse(request.params);
      if (!params.success) return sendValidationError(request, reply, params.error);
      const body = intakeReviewBodySchema.safeParse(request.body);
      if (!body.success) return sendValidationError(request, reply, body.error);
      try {
        // The list read runs the deny-by-default authorization check; a
        // document outside the case (or tenant) is an indistinguishable 404.
        const rows = await container.listDocuments.execute(actor, params.data.caseId);
        const entry = rows.find((row) => row.document.id === params.data.documentId);
        if (!entry || !entry.currentVersion) return sendError(request, reply, 404, 'NOT_FOUND');
        const currentVersion = entry.currentVersion;

        const now = new Date().toISOString();
        const confirmed = body.data.reviewState === 'user_confirmed';
        const confirmedFields = {
          classification: {
            confidence: body.data.classification.confidence,
            provenance: body.data.classification.provenance,
          },
          fields: body.data.fields,
        };

        let review: IntakeReviewResponse;
        if (container.pool) {
          review = await withTenant(
            container.pool,
            actor.tenantId,
            async (client) =>
              (
                await client.query<IntakeReviewResponse>(
                  `insert into document_intake_review
                     (tenant_id, id, employment_case_id, document_id, document_version_id,
                      classification, review_state, confirmed_fields, provider_name,
                      provider_request_id, confirmed_by, confirmed_at)
                   values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                   returning id, employment_case_id as "caseId", document_id as "documentId",
                     document_version_id as "documentVersionId", classification,
                     review_state as "reviewState", confirmed_fields as "confirmedFields",
                     provider_name as "providerName", provider_request_id as "providerRequestId",
                     confirmed_by as "confirmedBy", confirmed_at as "confirmedAt",
                     created_at as "createdAt"`,
                  [
                    actor.tenantId,
                    randomUUID(),
                    params.data.caseId,
                    params.data.documentId,
                    currentVersion.id,
                    body.data.classification.family,
                    body.data.reviewState,
                    JSON.stringify(confirmedFields),
                    body.data.providerName ?? null,
                    body.data.providerRequestId ?? null,
                    confirmed ? actor.userId : null,
                    confirmed ? now : null,
                  ],
                )
              ).rows[0]!,
          );
        } else {
          review = {
            id: randomUUID(),
            caseId: params.data.caseId,
            documentId: params.data.documentId,
            documentVersionId: currentVersion.id,
            classification: body.data.classification.family,
            reviewState: body.data.reviewState,
            confirmedFields,
            providerName: body.data.providerName ?? null,
            providerRequestId: body.data.providerRequestId ?? null,
            confirmedBy: confirmed ? actor.userId : null,
            confirmedAt: confirmed ? now : null,
            createdAt: now,
          };
          memoryIntakeReviews.push(review);
        }

        await container.audit.record({
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: confirmed
            ? 'document.intake_review_confirmed'
            : 'document.intake_review_cancelled',
          resourceType: 'document_intake_review',
          resourceId: review.id,
          correlationId: actor.correlationId,
          occurredAt: now,
          // Document *type* and outcome only — never extracted values.
          changeSummary: `Document AI review ${confirmed ? 'confirmed' : 'cancelled'} for document type ${entry.document.documentType}.`,
          sensitivity: entry.document.sensitivity,
        });
        await container.timeline.record({
          tenantId: actor.tenantId,
          employmentCaseId: params.data.caseId,
          eventTypeKey: 'timeline.document.intake_reviewed',
          occurredAt: now,
          summaryKey: 'timeline.document.intake_reviewed.summary',
          sensitivity: 'general',
        });

        reply.status(201).send(review);
      } catch (error) {
        if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
        throw error;
      }
    },
  );

  app.get<{ Params: DocumentParams }>(
    '/cases/:caseId/documents/:documentId/intake-reviews',
    options,
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      const params = documentParamsSchema.safeParse(request.params);
      if (!params.success) return sendValidationError(request, reply, params.error);
      try {
        const rows = await container.listDocuments.execute(actor, params.data.caseId);
        if (!rows.some((row) => row.document.id === params.data.documentId))
          return sendError(request, reply, 404, 'NOT_FOUND');
        if (container.pool) {
          const reviews = await withTenant(
            container.pool,
            actor.tenantId,
            async (client) =>
              (
                await client.query<IntakeReviewResponse>(
                  `select id, employment_case_id as "caseId", document_id as "documentId",
                     document_version_id as "documentVersionId", classification,
                     review_state as "reviewState", confirmed_fields as "confirmedFields",
                     provider_name as "providerName", provider_request_id as "providerRequestId",
                     confirmed_by as "confirmedBy", confirmed_at as "confirmedAt",
                     created_at as "createdAt"
                   from document_intake_review
                   where document_id=$1 and employment_case_id=$2
                   order by created_at desc limit 100`,
                  [params.data.documentId, params.data.caseId],
                )
              ).rows,
          );
          return reply.send(reviews);
        }
        reply.send(
          memoryIntakeReviews.filter(
            (review) =>
              review.documentId === params.data.documentId && review.caseId === params.data.caseId,
          ),
        );
      } catch (error) {
        if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
        throw error;
      }
    },
  );
}
