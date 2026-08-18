import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodError } from 'zod';
import type { ApiError } from '@caredesk/schemas';

export function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  code: string,
  fieldErrors?: Record<string, string[]>,
): void {
  const body: ApiError = {
    code,
    // Deliberately generic: the code identifies the failure, the message never
    // leaks internals to the client (Constitution §14/§23).
    message: 'Unable to complete the request',
    ...(fieldErrors ? { fieldErrors } : {}),
    correlationId: request.correlationId,
  };
  reply.status(status).send(body);
}

export function sendValidationError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: ZodError,
): void {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '(root)';
    (fieldErrors[path] ??= []).push(issue.message);
  }
  sendError(request, reply, 400, 'VALIDATION_ERROR', fieldErrors);
}
