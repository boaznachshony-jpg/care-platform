import type { FastifyError, FastifyInstance } from 'fastify';
import type { ApiError } from '@caredesk/schemas';

/**
 * The one error shape every response uses (Constitution §14). Never expose
 * a stack trace or internal message to the client — those go to the log
 * only, keyed by correlationId so they can still be found.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    request.log.error({ err: error, correlationId: request.correlationId }, 'request failed');

    const body: ApiError = {
      code: statusCode === 500 ? 'INTERNAL_ERROR' : (error.code ?? 'REQUEST_ERROR'),
      message: statusCode === 500 ? 'Unable to complete the request' : error.message,
      correlationId: request.correlationId,
    };

    reply.status(statusCode).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const body: ApiError = {
      code: 'NOT_FOUND',
      message: 'Unable to complete the request',
      correlationId: request.correlationId,
    };
    reply.status(404).send(body);
  });
}
