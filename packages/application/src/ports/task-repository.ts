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
  /** Set only by ImportCaseTask — see Task.legacyLocalId. */
  legacyLocalId?: string | null;
}

/** Only the fields a caller may edit; status transitions go through completeTask/archiveTask. */
export interface UpdateTaskRecord {
  title?: string;
  description?: string | null;
  priority?: Task['priority'];
  dueAt?: string | null;
}

export interface TaskRepository {
  createTask(input: CreateTaskRecord): Promise<Task>;
  listTasks(tenantId: string, employmentCaseId: string): Promise<Task[]>;
  findTask(tenantId: string, taskId: string): Promise<Task | null>;
  /**
   * The task previously imported from this local id, or null. Read before any
   * import write so a repeated import returns the existing row instead of the
   * application layer racing the database's own unique index.
   */
  findTaskByLegacyLocalId(
    tenantId: string,
    employmentCaseId: string,
    legacyLocalId: string,
  ): Promise<Task | null>;
  /** Returns null when the task does not exist or is already completed. */
  completeTask(
    tenantId: string,
    taskId: string,
    completedAt: string,
    completedBy: string,
  ): Promise<Task | null>;
  /** Returns null when the task does not exist or is already completed/cancelled. */
  updateTask(
    tenantId: string,
    taskId: string,
    changes: UpdateTaskRecord,
    updatedBy: string,
  ): Promise<Task | null>;
  /**
   * Soft-close: sets status to 'cancelled'. There is no delete verb — an
   * archived task must remain reconstructable in the same way a document or a
   * timeline entry does. Returns null when the task does not exist or is
   * already completed/cancelled.
   */
  archiveTask(tenantId: string, taskId: string, updatedBy: string): Promise<Task | null>;
}

export interface TimelineRepository {
  listTimeline(tenantId: string, employmentCaseId: string): Promise<TimelineEvent[]>;
}
