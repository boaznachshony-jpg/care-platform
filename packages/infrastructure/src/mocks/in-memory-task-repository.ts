import type {
  CreateTaskRecord,
  TaskRepository,
  TimelineRepository,
  UpdateTaskRecord,
} from '@caredesk/application';
import { brandId, type Task, type TimelineEvent } from '@caredesk/domain';
import type { InMemoryTimelineService } from './in-memory-timeline-service.js';

export class InMemoryTaskRepository implements TaskRepository {
  private readonly tasksByTenant = new Map<string, Task[]>();

  async createTask(input: CreateTaskRecord): Promise<Task> {
    const task: Task = {
      id: brandId(input.id),
      tenantId: brandId(input.tenantId),
      employmentCaseId: brandId(input.employmentCaseId),
      title: input.title,
      titleKey: null,
      description: input.description,
      status: 'open',
      priority: input.priority,
      dueAt: input.dueAt,
      completedAt: null,
      sourceType: 'manual',
      legacyLocalId: input.legacyLocalId ?? null,
    };
    const tasks = this.tasksByTenant.get(input.tenantId) ?? [];
    tasks.push(task);
    this.tasksByTenant.set(input.tenantId, tasks);
    return task;
  }

  async listTasks(tenantId: string, employmentCaseId: string): Promise<Task[]> {
    return (this.tasksByTenant.get(tenantId) ?? []).filter(
      (task) => task.employmentCaseId === employmentCaseId,
    );
  }

  async findTask(tenantId: string, taskId: string): Promise<Task | null> {
    return (this.tasksByTenant.get(tenantId) ?? []).find((task) => task.id === taskId) ?? null;
  }

  async findTaskByLegacyLocalId(
    tenantId: string,
    employmentCaseId: string,
    legacyLocalId: string,
  ): Promise<Task | null> {
    return (
      (this.tasksByTenant.get(tenantId) ?? []).find(
        (task) =>
          task.employmentCaseId === employmentCaseId && task.legacyLocalId === legacyLocalId,
      ) ?? null
    );
  }

  async completeTask(
    tenantId: string,
    taskId: string,
    completedAt: string,
    _completedBy: string,
  ): Promise<Task | null> {
    const tasks = this.tasksByTenant.get(tenantId) ?? [];
    const index = tasks.findIndex((task) => task.id === taskId && task.status !== 'completed');
    if (index === -1) {
      return null;
    }
    const existing = tasks[index];
    if (!existing) {
      return null;
    }
    const updated: Task = { ...existing, status: 'completed', completedAt };
    tasks[index] = updated;
    return updated;
  }

  async updateTask(
    tenantId: string,
    taskId: string,
    changes: UpdateTaskRecord,
    _updatedBy: string,
  ): Promise<Task | null> {
    const tasks = this.tasksByTenant.get(tenantId) ?? [];
    const index = tasks.findIndex(
      (task) => task.id === taskId && task.status !== 'completed' && task.status !== 'cancelled',
    );
    if (index === -1) return null;
    const existing = tasks[index];
    if (!existing) return null;
    const updated: Task = {
      ...existing,
      title: changes.title ?? existing.title,
      description: changes.description !== undefined ? changes.description : existing.description,
      priority: changes.priority ?? existing.priority,
      dueAt: changes.dueAt !== undefined ? changes.dueAt : existing.dueAt,
    };
    tasks[index] = updated;
    return updated;
  }

  async archiveTask(tenantId: string, taskId: string, _updatedBy: string): Promise<Task | null> {
    const tasks = this.tasksByTenant.get(tenantId) ?? [];
    const index = tasks.findIndex(
      (task) => task.id === taskId && task.status !== 'completed' && task.status !== 'cancelled',
    );
    if (index === -1) return null;
    const existing = tasks[index];
    if (!existing) return null;
    const updated: Task = { ...existing, status: 'cancelled' };
    tasks[index] = updated;
    return updated;
  }
}

/** Reads back what InMemoryTimelineService recorded, so the pair mirrors the Pg one. */
export class InMemoryTimelineRepository implements TimelineRepository {
  constructor(private readonly service: InMemoryTimelineService) {}

  async listTimeline(tenantId: string, employmentCaseId: string): Promise<TimelineEvent[]> {
    return this.service.events
      .filter((event) => event.tenantId === tenantId && event.employmentCaseId === employmentCaseId)
      .map((event, index): TimelineEvent => ({
        id: brandId(`in-memory-timeline-${index}`),
        tenantId: brandId(event.tenantId),
        employmentCaseId: brandId(event.employmentCaseId),
        eventTypeKey: event.eventTypeKey,
        summaryKey: event.summaryKey,
        occurredAt: event.occurredAt,
        actorDisplay: null,
        sensitivity: event.sensitivity,
      }))
      .reverse();
  }
}
