import type { Task, TaskPriority, TimelineEvent } from '@caredesk/domain';
import type { AuditService } from '../ports/audit-service.js';
import type { AuthorizationService } from '../ports/authorization-service.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { TaskRepository, TimelineRepository } from '../ports/task-repository.js';
import type { TimelineService } from '../ports/timeline-service.js';
import { AuthorizationError, type Actor } from './open-employment-case.js';

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
    const decision = await this.deps.authorization.check({
      userId: actor.userId,
      tenantId: actor.tenantId,
      caseId,
      resourceType: 'task',
      action: 'create',
    });
    if (!decision.allowed) {
      throw new AuthorizationError(decision.reason);
    }

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
    const decision = await this.deps.authorization.check({
      userId: actor.userId,
      tenantId: actor.tenantId,
      caseId,
      resourceType: 'task',
      action: 'update',
    });
    if (!decision.allowed) {
      throw new AuthorizationError(decision.reason);
    }

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

export class ListCaseTasks {
  constructor(private readonly deps: Pick<CaseTaskDeps, 'authorization' | 'tasks'>) {}

  async execute(actor: Actor, caseId: string): Promise<Task[]> {
    const decision = await this.deps.authorization.check({
      userId: actor.userId,
      tenantId: actor.tenantId,
      caseId,
      resourceType: 'task',
      action: 'read',
    });
    if (!decision.allowed) {
      throw new AuthorizationError(decision.reason);
    }
    return this.deps.tasks.listTasks(actor.tenantId, caseId);
  }
}

export class ListCaseTimeline {
  constructor(
    private readonly deps: { authorization: AuthorizationService; timeline: TimelineRepository },
  ) {}

  async execute(actor: Actor, caseId: string): Promise<TimelineEvent[]> {
    const decision = await this.deps.authorization.check({
      userId: actor.userId,
      tenantId: actor.tenantId,
      caseId,
      resourceType: 'timeline',
      action: 'read',
    });
    if (!decision.allowed) {
      throw new AuthorizationError(decision.reason);
    }
    return this.deps.timeline.listTimeline(actor.tenantId, caseId);
  }
}
