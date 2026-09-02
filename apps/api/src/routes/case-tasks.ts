import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthorizationError } from '@caredesk/application';
import type { Task } from '@caredesk/domain';
import {
  createTaskRequestSchema,
  updateTaskRequestSchema,
  importTaskRequestSchema,
  type TaskResponse,
} from '@caredesk/schemas';
import type { Container } from '../container.js';
import { makeAuthenticate } from '../plugins/authenticate.js';
import { sendError, sendValidationError } from './http-errors.js';

interface CaseParams {
  caseId: string;
}

interface TaskParams extends CaseParams {
  taskId: string;
}

const taskParamsSchema = z.object({
  caseId: z.string().uuid(),
  taskId: z.string().uuid(),
});

function toResponse(task: Task): TaskResponse {
  return {
    id: task.id,
    title: task.title,
    titleKey: task.titleKey,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt,
    completedAt: task.completedAt,
    sourceType: task.sourceType,
    legacyLocalId: task.legacyLocalId,
  };
}

/**
 * Case tasks. Milestone 1 already had CreateCaseTask/CompleteCaseTask/
 * ListCaseTasks (packages/application/src/use-cases/manage-case-tasks.ts) and
 * PgTaskRepository (packages/db/src/task-repository.ts) — the gap this file
 * closes was purely that nothing ever registered an HTTP route in front of
 * them, so `caredesk.mvp.tasks.v1` stayed the only place a task could be
 * created from the product's actual UI.
 */
export function registerCaseTaskRoutes(app: FastifyInstance, container: Container): void {
  const authenticate = makeAuthenticate(container.auth, container.actorResolver);
  const options = { preHandler: authenticate };

  app.get<{ Params: CaseParams }>('/cases/:caseId/tasks', options, async (request, reply) => {
    const actor = request.actor;
    if (!actor) return;
    try {
      const tasks = await container.listTasks.execute(actor, request.params.caseId);
      reply.send(tasks.map(toResponse));
    } catch (error) {
      if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
      throw error;
    }
  });

  app.post<{ Params: CaseParams }>('/cases/:caseId/tasks', options, async (request, reply) => {
    const actor = request.actor;
    if (!actor) return;
    const parsed = createTaskRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(request, reply, parsed.error);
    try {
      const created = await container.createTask.execute(actor, request.params.caseId, parsed.data);
      reply.status(201).send(toResponse(created));
    } catch (error) {
      if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
      throw error;
    }
  });

  /**
   * Idempotent import for the UI cutover — see ImportCaseTask. A caller that
   * retries the same `legacyLocalId` gets the same task back rather than a
   * duplicate, so the web client can upload a device's local tasks without
   * first checking whether it already did.
   */
  app.post<{ Params: CaseParams }>(
    '/cases/:caseId/tasks/import',
    options,
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      const parsed = importTaskRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(request, reply, parsed.error);
      try {
        const imported = await container.importTask.execute(
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

  app.patch<{ Params: TaskParams }>(
    '/cases/:caseId/tasks/:taskId',
    options,
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      const params = taskParamsSchema.safeParse(request.params);
      if (!params.success) return sendValidationError(request, reply, params.error);
      const body = updateTaskRequestSchema.safeParse(request.body);
      if (!body.success) return sendValidationError(request, reply, body.error);
      try {
        const updated = await container.updateTask.execute(
          actor,
          params.data.caseId,
          params.data.taskId,
          body.data,
        );
        if (!updated) return sendError(request, reply, 404, 'NOT_FOUND');
        reply.send(toResponse(updated));
      } catch (error) {
        if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
        throw error;
      }
    },
  );

  app.post<{ Params: TaskParams }>(
    '/cases/:caseId/tasks/:taskId/complete',
    options,
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      const params = taskParamsSchema.safeParse(request.params);
      if (!params.success) return sendValidationError(request, reply, params.error);
      try {
        const completed = await container.completeTask.execute(
          actor,
          params.data.caseId,
          params.data.taskId,
        );
        // Idempotent by design (CompleteCaseTask): null means either the task
        // is unknown or was already completed, and both are reported as 404
        // to a caller who does not hold the task's current state.
        if (!completed) return sendError(request, reply, 404, 'NOT_FOUND');
        reply.send(toResponse(completed));
      } catch (error) {
        if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
        throw error;
      }
    },
  );

  /** Soft-close (status -> 'cancelled'). There is no delete route — see ArchiveCaseTask. */
  app.post<{ Params: TaskParams }>(
    '/cases/:caseId/tasks/:taskId/archive',
    options,
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      const params = taskParamsSchema.safeParse(request.params);
      if (!params.success) return sendValidationError(request, reply, params.error);
      try {
        const archived = await container.archiveTask.execute(
          actor,
          params.data.caseId,
          params.data.taskId,
        );
        if (!archived) return sendError(request, reply, 404, 'NOT_FOUND');
        reply.send(toResponse(archived));
      } catch (error) {
        if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
        throw error;
      }
    },
  );
}
