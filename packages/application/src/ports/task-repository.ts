import type { Task, TimelineEvent } from '@caredesk/domain';

/**
 * What the repository needs to persist a task — ids and resolved values,
 * distinct from the use case's `CreateTaskInput`, which is the caller-facing
 * shape (a due *date*, no ids, optional fields).
 */
export interface CreateTaskRecord {
  id: string;
  tenantId: string;
  employmentCaseId: string;
  title: string;
  description: string | null;
  priority: Task['priority'];
  dueAt: string | null;
  createdBy: string;
}

export interface TaskRepository {
  createTask(input: CreateTaskRecord): Promise<Task>;
  listTasks(tenantId: string, employmentCaseId: string): Promise<Task[]>;
  findTask(tenantId: string, taskId: string): Promise<Task | null>;
  /** Returns null when the task does not exist or is already completed. */
  completeTask(
    tenantId: string,
    taskId: string,
    completedAt: string,
    completedBy: string,
  ): Promise<Task | null>;
}

export interface TimelineRepository {
  listTimeline(tenantId: string, employmentCaseId: string): Promise<TimelineEvent[]>;
}
