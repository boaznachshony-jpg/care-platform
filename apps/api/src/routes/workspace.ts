import type { FastifyInstance } from 'fastify';
import {
  AuthorizationError,
  DOWNLOAD_URL_TTL_SECONDS,
  WorkspaceShrinkRejectedError,
} from '@caredesk/application';
import {
  MAX_WORKSPACE_FILE_BYTES,
  saveWorkspaceRequestSchema,
  uploadWorkspaceFileRequestSchema,
  type WorkspaceFileUrlResponse,
  type WorkspaceResponse,
  type WorkspaceSnapshot,
} from '@caredesk/schemas';
import { z } from 'zod';
import type { Container } from '../container.js';
import { makeAuthenticate } from '../plugins/authenticate.js';
import { sendError, sendValidationError } from './http-errors.js';

const MAX_WORKSPACE_BYTES = 2 * 1024 * 1024;
const MAX_WORKSPACE_FILE_BODY_BYTES = Math.ceil((MAX_WORKSPACE_FILE_BYTES * 4) / 3) + 64 * 1024;
const fileParamsSchema = z.object({ clientId: z.string().uuid(), documentId: z.string().uuid() });

function emptyWorkspace(): WorkspaceResponse {
  const snapshot: WorkspaceSnapshot = { schemaVersion: 1, entries: {} };
  return { version: 0, snapshot, updatedAt: new Date(0).toISOString() };
}

export function registerWorkspaceRoutes(app: FastifyInstance, container: Container): void {
  const authenticate = makeAuthenticate(container.auth, container.actorResolver);
  const options = { preHandler: authenticate };

  app.get('/workspace', options, async (request, reply) => {
    const actor = request.actor;
    if (!actor) return;
    try {
      const row = await container.getWorkspace.execute(actor);
      if (!row) return reply.send(emptyWorkspace());
      const body: WorkspaceResponse = {
        version: row.version,
        snapshot: { schemaVersion: 1, entries: row.payload },
        updatedAt: row.updatedAt,
      };
      reply.send(body);
    } catch (error) {
      if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
      throw error;
    }
  });

  app.put('/workspace', { ...options, bodyLimit: MAX_WORKSPACE_BYTES }, async (request, reply) => {
    const actor = request.actor;
    if (!actor) return;
    const parsed = saveWorkspaceRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(request, reply, parsed.error);

    try {
      const saved = await container.saveWorkspace.execute(actor, {
        schemaVersion: parsed.data.snapshot.schemaVersion,
        payload: parsed.data.snapshot.entries,
        expectedVersion: parsed.data.expectedVersion,
        allowShrink: parsed.data.allowShrink === true,
      });
      if (!saved) return sendError(request, reply, 409, 'VERSION_CONFLICT');
      const body: WorkspaceResponse = {
        version: saved.version,
        snapshot: { schemaVersion: 1, entries: saved.payload },
        updatedAt: saved.updatedAt,
      };
      reply.send(body);
    } catch (error) {
      if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
      if (error instanceof WorkspaceShrinkRejectedError) {
        // 409, not 400: the request is well formed, it just conflicts with
        // what is already stored. The client shows the customer a warning and
        // keeps the pending save rather than discarding it.
        request.log.warn(
          { currentEntries: error.currentEntries, incomingEntries: error.incomingEntries },
          'workspace save rejected as destructive',
        );
        return sendError(request, reply, 409, 'WORKSPACE_SHRINK_REJECTED');
      }
      throw error;
    }
  });

  app.put<{ Params: { clientId: string; documentId: string } }>(
    '/workspace/files/:clientId/:documentId',
    { ...options, bodyLimit: MAX_WORKSPACE_FILE_BODY_BYTES },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      const params = fileParamsSchema.safeParse(request.params);
      const body = uploadWorkspaceFileRequestSchema.safeParse(request.body);
      if (!params.success) return sendValidationError(request, reply, params.error);
      if (!body.success) return sendValidationError(request, reply, body.error);
      try {
        const saved = await container.putWorkspaceFile.execute(
          actor,
          params.data.clientId,
          params.data.documentId,
          body.data,
        );
        reply.send({ version: saved.version, sizeBytes: saved.sizeBytes });
      } catch (error) {
        if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
        throw error;
      }
    },
  );

  app.get<{ Params: { clientId: string; documentId: string } }>(
    '/workspace/files/:clientId/:documentId',
    options,
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      const params = fileParamsSchema.safeParse(request.params);
      if (!params.success) return sendValidationError(request, reply, params.error);
      try {
        const url = await container.getWorkspaceFileUrl.execute(
          actor,
          params.data.clientId,
          params.data.documentId,
        );
        if (!url) return sendError(request, reply, 404, 'NOT_FOUND');
        const body: WorkspaceFileUrlResponse = {
          url,
          expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
        };
        reply.send(body);
      } catch (error) {
        if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
        throw error;
      }
    },
  );

  app.delete<{ Params: { clientId: string; documentId: string } }>(
    '/workspace/files/:clientId/:documentId',
    options,
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      const params = fileParamsSchema.safeParse(request.params);
      if (!params.success) return sendValidationError(request, reply, params.error);
      try {
        const removed = await container.deleteWorkspaceFile.execute(
          actor,
          params.data.clientId,
          params.data.documentId,
        );
        if (!removed) return sendError(request, reply, 404, 'NOT_FOUND');
        reply.status(204).send();
      } catch (error) {
        if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
        throw error;
      }
    },
  );
}
