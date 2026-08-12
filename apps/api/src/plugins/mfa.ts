import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Env } from '../env.js';
import { sendError } from '../routes/http-errors.js';

export type SensitiveOperation = 'billing.manage' | 'membership.manage';

export function requireMfa(env: Env, operation: SensitiveOperation): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.actor || request.actor.mfaSatisfied) return;

    request.log.warn(
      {
        securityEvent: 'mfa_required',
        operation,
        enforcement: env.SENSITIVE_OPERATION_MFA_MODE,
        correlationId: request.correlationId,
      },
      'sensitive operation attempted without MFA',
    );

    if (env.SENSITIVE_OPERATION_MFA_MODE === 'enforce') {
      sendError(request, reply, 403, 'MFA_REQUIRED');
    }
  };
}
