import { AuthorizationError } from '@caredesk/application';
import {
  FamilyMemberConflictError,
  FamilyMemberInvariantError,
  FamilyMemberNotFoundError,
} from '@caredesk/application';
import {
  inviteFamilyMemberRequestSchema,
  updateFamilyMemberRoleRequestSchema,
  type FamilyMemberResponse,
} from '@caredesk/schemas';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../container.js';
import type { Env } from '../env.js';
import { makeAuthenticate } from '../plugins/authenticate.js';
import { requireMfa } from '../plugins/mfa.js';
import { safeErrorDetails } from '../plugins/safe-error.js';
import { sendError, sendValidationError } from './http-errors.js';

const membershipParamsSchema = z.object({ membershipId: z.string().uuid() });

function toResponse(
  member: {
    membershipId: string;
    displayName: string;
    email: string;
    role: 'owner' | 'manager' | 'viewer';
    status: 'invited' | 'active';
    invitedAt: string;
    lastAuthenticatedAt: string | null;
  },
  isCurrentUser: boolean,
): FamilyMemberResponse {
  return {
    membershipId: member.membershipId,
    displayName: member.displayName,
    email: member.email,
    role: member.role,
    status: member.status,
    invitedAt: member.invitedAt,
    lastAuthenticatedAt: member.lastAuthenticatedAt,
    isCurrentUser,
  };
}

function handleKnownError(error: unknown): { statusCode: number } | null {
  if (error instanceof AuthorizationError) return { statusCode: 403 };
  if (error instanceof FamilyMemberConflictError) return { statusCode: 409 };
  if (error instanceof FamilyMemberNotFoundError) return { statusCode: 404 };
  if (error instanceof FamilyMemberInvariantError) return { statusCode: 409 };
  return null;
}

export function registerFamilyAccessRoutes(
  app: FastifyInstance,
  container: Container,
  env: Env,
): void {
  const authenticate = makeAuthenticate(container.auth, container.actorResolver);
  const options = { preHandler: authenticate };
  const manageOptions = { preHandler: [authenticate, requireMfa(env, 'membership.manage')] };

  app.get('/family/members', options, async (request, reply) => {
    const actor = request.actor;
    if (!actor) return;
    try {
      const result = await container.listFamilyMembers.execute(actor);
      reply.send({
        canManage: result.canManage,
        members: result.members.map((member) => toResponse(member, member.isCurrentUser)),
      });
    } catch (error) {
      const known = handleKnownError(error);
      if (known) return sendError(request, reply, known.statusCode, 'FORBIDDEN');
      throw error;
    }
  });

  app.post('/family/invitations', manageOptions, async (request, reply) => {
    const actor = request.actor;
    if (!actor) return;
    const parsed = inviteFamilyMemberRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(request, reply, parsed.error);
    try {
      const member = await container.inviteFamilyMember.execute(actor, parsed.data);
      reply.status(201).send(toResponse(member, false));
    } catch (error) {
      const known = handleKnownError(error);
      if (known) {
        const code =
          error instanceof FamilyMemberConflictError ? 'FAMILY_MEMBER_EXISTS' : 'FORBIDDEN';
        return sendError(request, reply, known.statusCode, code);
      }
      request.log.error(safeErrorDetails(error), 'Family invitation failed');
      return sendError(request, reply, 502, 'INVITATION_DELIVERY_FAILED');
    }
  });

  app.patch<{ Params: { membershipId: string } }>(
    '/family/members/:membershipId',
    manageOptions,
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      const params = membershipParamsSchema.safeParse(request.params);
      const body = updateFamilyMemberRoleRequestSchema.safeParse(request.body);
      if (!params.success) return sendValidationError(request, reply, params.error);
      if (!body.success) return sendValidationError(request, reply, body.error);
      try {
        const member = await container.updateFamilyMemberRole.execute(
          actor,
          params.data.membershipId,
          body.data.role,
        );
        reply.send(toResponse(member, false));
      } catch (error) {
        const known = handleKnownError(error);
        if (known) {
          const code =
            error instanceof FamilyMemberNotFoundError
              ? 'NOT_FOUND'
              : error instanceof FamilyMemberInvariantError
                ? 'FAMILY_MEMBER_INVARIANT'
                : 'FORBIDDEN';
          return sendError(request, reply, known.statusCode, code);
        }
        throw error;
      }
    },
  );

  app.delete<{ Params: { membershipId: string } }>(
    '/family/members/:membershipId',
    manageOptions,
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      const params = membershipParamsSchema.safeParse(request.params);
      if (!params.success) return sendValidationError(request, reply, params.error);
      try {
        await container.revokeFamilyMember.execute(actor, params.data.membershipId);
        reply.status(204).send();
      } catch (error) {
        const known = handleKnownError(error);
        if (known) {
          const code =
            error instanceof FamilyMemberNotFoundError
              ? 'NOT_FOUND'
              : error instanceof FamilyMemberInvariantError
                ? 'FAMILY_MEMBER_INVARIANT'
                : 'FORBIDDEN';
          return sendError(request, reply, known.statusCode, code);
        }
        throw error;
      }
    },
  );
}
