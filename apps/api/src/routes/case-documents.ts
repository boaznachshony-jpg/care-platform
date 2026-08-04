import type { FastifyInstance } from 'fastify';
import { AuthorizationError, type DocumentWithCurrentVersion } from '@caredesk/application';
import {
  MAX_DOCUMENT_BYTES,
  uploadDocumentRequestSchema,
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
}
