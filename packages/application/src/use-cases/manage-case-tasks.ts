import type { Task, TaskPriority, TimelineEvent } from '@caredesk/domain';
import type { AuditService } from '../ports/audit-service.js';
import type { AuthorizationService } from '../ports/authorization-service.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { TaskRepository, TimelineRepository } from '../ports/task-repository.js';
import type { TimelineService } from '../ports/timeline-service.js';
import type { Actor } from './actor.js';
import { authorizeOrThrow } from './authorize.js';

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  /** ISO date (YYYY-MM-DD), or null to clear a previously set due date. */
  dueDate?: string | null;
}

/**
 * The one browser-only local id (`MvpTask.id`) an import carries. Everything
 * else about the task is the same shape CreateCaseTask already accepts —
 * importing is "create, but idempotent on this key" rather than a distinct
 * data shape.
 */
export interface ImportTaskInput extends CreateTaskInput {
  legacyLocalId: string;
  /**
   * The browser store's own status. A completed local task must not silently
   * reopen just because the import path re-derives it as 'open' — the import
   * marks it completed immediately after creating it, using the client's
   * completion time when known.
   */
  status: 'open' | 'completed';
  completedAt?: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  /** ISO date (YYYY-MM-DD). */
  dueDate?: string;
}

export interface CaseTaskDeps {
  authorization: AuthorizationService;
  tasks: TaskRepository;
  audit: AuditService;
  timeline: TimelineService;
  clock: Clock;
  ids: IdGenerator;
}

export class CreateCaseTask {
  constructor(private readonly deps: CaseTaskDeps) {}

  async execute(actor: Actor, caseId: string, input: CreateTaskInput): Promise<Task> {
    await authorizeOrThrow(this.deps, actor, {
      resourceType: 'task',
      action: 'create',
      caseId,
      sensitivity: 'employment_sensitive',
    });

    const now = this.deps.clock.now().toISOString();
    const task = await this.deps.tasks.createTask({
      id: this.deps.ids.next(),
      tenantId: actor.tenantId,
      employmentCaseId: caseId,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? 'normal',
      // A due date is a calendar day; store it at day start so no timezone
      // shift can move a deadline to the previous day.
      dueAt: input.dueDate ? `${input.dueDate}T00:00:00.000Z` : null,
      createdBy: actor.userId,
    });

    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'task.created',
      resourceType: 'task',
      resourceId: task.id,
      correlationId: actor.correlationId,
      occurredAt: now,
      sensitivity: 'employment_sensitive',
    });

    await this.deps.timeline.record({
      tenantId: actor.tenantId,
      employmentCaseId: caseId,
      eventTypeKey: 'timeline.task.created',
      occurredAt: now,
      summaryKey: 'timeline.task.created.summary',
      sensitivity: 'general',
    });

    return task;
  }
}

export class CompleteCaseTask {
  constructor(private readonly deps: CaseTaskDeps) {}

  /** Returns null when the task does not exist, is in another tenant, or is already complete. */
  async execute(actor: Actor, caseId: string, taskId: string): Promise<Task | null> {
    await authorizeOrThrow(this.deps, actor, {
      resourceType: 'task',
      action: 'update',
      caseId,
      resourceId: taskId,
      sensitivity: 'employment_sensitive',
    });

    const now = this.deps.clock.now().toISOString();
    const task = await this.deps.tasks.completeTask(actor.tenantId, taskId, now, actor.userId);
    if (!task) {
      return null;
    }

    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'task.completed',
      resourceType: 'task',
      resourceId: task.id,
      correlationId: actor.correlationId,
      occurredAt: now,
      changeSummary: 'Task status changed to completed.',
      sensitivity: 'employment_sensitive',
    });

    await this.deps.timeline.record({
      tenantId: actor.tenantId,
      employmentCaseId: caseId,
      eventTypeKey: 'timeline.task.completed',
      occurredAt: now,
      summaryKey: 'timeline.task.completed.summary',
      sensitivity: 'general',
    });

    return task;
  }
}

export class UpdateCaseTask {
  constructor(private readonly deps: CaseTaskDeps) {}

  /** Returns null when the task does not exist, is in another tenant, or is already closed. */
  async execute(
    actor: Actor,
    caseId: string,
    taskId: string,
    input: UpdateTaskInput,
  ): Promise<Task | null> {
    await authorizeOrThrow(this.deps, actor, {
      resourceType: 'task',
      action: 'update',
      caseId,
      resourceId: taskId,
      sensitivity: 'employment_sensitive',
    });

    const now = this.deps.clock.now().toISOString();
    const task = await this.deps.tasks.updateTask(
      actor.tenantId,
      taskId,
      {
        title: input.title,
        description: input.description,
        priority: input.priority,
        dueAt:
          input.dueDate === undefined
            ? undefined
            : input.dueDate === null
              ? null
              : `${input.dueDate}T00:00:00.000Z`,
      },
      actor.userId,
    );
    if (!task) return null;

    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'task.updated',
      resourceType: 'task',
      resourceId: task.id,
      correlationId: actor.correlationId,
      occurredAt: now,
      // Field names only — never the edited values themselves.
      changeSummary: `Task fields updated: ${Object.keys(input).join(', ') || 'none'}.`,
      sensitivity: 'employment_sensitive',
    });

    return task;
  }
}

export class ArchiveCaseTask {
  constructor(private readonly deps: CaseTaskDeps) {}

  /** Returns null when the task does not exist, is in another tenant, or is already closed. */
  async execute(actor: Actor, caseId: string, taskId: string): Promise<Task | null> {
    await authorizeOrThrow(this.deps, actor, {
      resourceType: 'task',
      action: 'update',
      caseId,
      resourceId: taskId,
      sensitivity: 'employment_sensitive',
    });

    const now = this.deps.clock.now().toISOString();
    const task = await this.deps.tasks.archiveTask(actor.tenantId, taskId, actor.userId);
    if (!task) return null;

    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'task.archived',
      resourceType: 'task',
      resourceId: task.id,
      correlationId: actor.correlationId,
      occurredAt: now,
      changeSummary: 'Task status changed to cancelled.',
      sensitivity: 'employment_sensitive',
    });

    await this.deps.timeline.record({
      tenantId: actor.tenantId,
      employmentCaseId: caseId,
      eventTypeKey: 'timeline.task.archived',
      occurredAt: now,
      summaryKey: 'timeline.task.archived.summary',
      sensitivity: 'general',
    });

    return task;
  }
}

/**
 * Idempotent create for the UI cutover: the web client uploads what is on the
 * device, and the upload must be safe to run twice. `legacyLocalId` is looked
 * up before any write; if the case already has a task from that local record,
 * it is returned unchanged rather than duplicated. The database's partial
 * unique index (migration 0046) is the second line for a race between two
 * concurrent imports of the same local id.
 */
export class ImportCaseTask {
  constructor(private readonly deps: CaseTaskDeps) {}

  async execute(actor: Actor, caseId: string, input: ImportTaskInput): Promise<Task> {
    await authorizeOrThrow(this.deps, actor, {
      resourceType: 'task',
      action: 'create',
      caseId,
      sensitivity: 'employment_sensitive',
    });

    const existing = await this.deps.tasks.findTaskByLegacyLocalId(
      actor.tenantId,
      caseId,
      input.legacyLocalId,
    );
    if (existing) return existing;

    const now = this.deps.clock.now().toISOString();
    const task = await this.deps.tasks.createTask({
      id: this.deps.ids.next(),
      tenantId: actor.tenantId,
      employmentCaseId: caseId,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? 'normal',
      dueAt: input.dueDate ? `${input.dueDate}T00:00:00.000Z` : null,
      createdBy: actor.userId,
      legacyLocalId: input.legacyLocalId,
    });

    const finalTask =
      input.status === 'completed'
        ? await this.deps.tasks.completeTask(
            actor.tenantId,
            task.id,
            input.completedAt ?? now,
            actor.userId,
          )
        : task;

    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'task.imported',
      resourceType: 'task',
      resourceId: task.id,
      correlationId: actor.correlationId,
      occurredAt: now,
      changeSummary: `Task imported from local device record; status ${input.status}.`,
      sensitivity: 'employment_sensitive',
    });

    await this.deps.timeline.record({
      tenantId: actor.tenantId,
      employmentCaseId: caseId,
      eventTypeKey: 'timeline.task.imported',
      occurredAt: now,
      summaryKey: 'timeline.task.imported.summary',
      sensitivity: 'general',
    });

    // completeTask never returns null on a freshly created, non-completed
    // task — the guard is here only to satisfy the null-returning contract.
    return finalTask ?? task;
  }
}

export class ListCaseTasks {
  constructor(
    private readonly deps: Pick<CaseTaskDeps, 'authorization' | 'tasks' | 'audit' | 'clock'>,
  ) {}

  async execute(actor: Actor, caseId: string): Promise<Task[]> {
    await authorizeOrThrow(this.deps, actor, {
      resourceType: 'task',
      action: 'read',
      caseId,
      sensitivity: 'employment_sensitive',
    });
    return this.deps.tasks.listTasks(actor.tenantId, caseId);
  }
}

export class ListCaseTimeline {
  constructor(
    private readonly deps: {
      authorization: AuthorizationService;
      timeline: TimelineRepository;
      audit: AuditService;
      clock: Clock;
    },
  ) {}

  async execute(actor: Actor, caseId: string): Promise<TimelineEvent[]> {
    await authorizeOrThrow(this.deps, actor, {
      resourceType: 'timeline',
      action: 'read',
      caseId,
    });
    return this.deps.timeline.listTimeline(actor.tenantId, caseId);
  }
}
