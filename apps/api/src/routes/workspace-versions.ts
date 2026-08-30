import {
  AuthorizationError,
  WorkspaceRestoreNotConfirmedError,
  WorkspaceVersionNotFoundError,
} from '@caredesk/application';
import {
  restoreWorkspaceVersionRequestSchema,
  type WorkspaceResponse,
  type WorkspaceVersionListResponse,
} from '@caredesk/schemas';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../container.js';
import type { Env } from '../env.js';
import { makeAuthenticate } from '../plugins/authenticate.js';
import { requireMfa } from '../plugins/mfa.js';
import { sendError, sendValidationError } from './http-errors.js';

const versionParamsSchema = z.object({ version: z.coerce.number().int().positive() });

/**
 * The read side of migration 0035, exposed as an operation.
 *
 * Restore is gated three ways and each one covers a different mistake:
 *   - `workspace:restore` in the role map, so it can be withheld from a manager
 *     who is nevertheless allowed to save;
 *   - MFA at the route, matching how billing and membership changes are
 *     treated, because this is the write that reaches furthest back;
 *   - the version confirmed in the body, so a stale list cannot restore a
 *     version the caller was not looking at.
 */
export function registerWorkspaceVersionRoutes(
  app: FastifyInstance,
  container: Container,
  env: Env,
): void {
  const authenticate = makeAuthenticate(container.auth, container.actorResolver);
  const restoreOptions = {
    preHandler: [authenticate, requireMfa(env, 'workspace.restore')],
  };

  app.get('/workspace/versions', { preHandler: authenticate }, async (request, reply) => {
    const actor = request.actor;
    if (!actor) return;
    try {
      const versions = await container.listWorkspaceVersions.execute(actor);
      const body: WorkspaceVersionListResponse = { versions };
      reply.send(body);
    } catch (error) {
      if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
      throw error;
    }
  });

  app.post<{ Params: { version: string } }>(
    '/workspace/versions/:version/restore',
    restoreOptions,
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      const params = versionParamsSchema.safeParse(request.params);
      if (!params.success) return sendValidationError(request, reply, params.error);
      const body = restoreWorkspaceVersionRequestSchema.safeParse(request.body);
      if (!body.success) return sendValidationError(request, reply, body.error);

      try {
        const restored = await container.restoreWorkspaceVersion.execute(actor, {
          version: params.data.version,
          confirmVersion: body.data.confirmVersion,
        });
        // Null is optimistic-concurrency loss: someone saved between reading
        // the live version and writing the restore. A conflict, not a retry -
        // silently racing a live save is the inconsistent-merge failure this
        // operation exists to replace.
        if (!restored) return sendError(request, reply, 409, 'VERSION_CONFLICT');
        const response: WorkspaceResponse = {
          version: restored.version,
          snapshot: { schemaVersion: 1, entries: restored.payload },
          updatedAt: restored.updatedAt,
        };
        reply.send(response);
      } catch (error) {
        if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
        if (error instanceof WorkspaceVersionNotFoundError) {
          return sendError(request, reply, 404, 'WORKSPACE_VERSION_NOT_FOUND');
        }
        if (error instanceof WorkspaceRestoreNotConfirmedError) {
          return sendError(request, reply, 400, 'WORKSPACE_RESTORE_NOT_CONFIRMED');
        }
        throw error;
      }
    },
  );
}
