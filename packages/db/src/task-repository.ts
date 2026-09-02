import type {
  CreateTaskRecord,
  TaskRepository,
  TimelineEventInput,
  TimelineRepository,
  TimelineService,
  UpdateTaskRecord,
} from '@caredesk/application';
import { brandId, type Task, type TimelineEvent } from '@caredesk/domain';
import type { Pool } from 'pg';
import { withTenant } from './pool.js';

interface TaskRow {
  id: string;
  tenant_id: string;
  employment_case_id: string;
  title: string | null;
  title_key: string | null;
  description: string | null;
  status: string;
  priority: string;
  due_at: Date | null;
  completed_at: Date | null;
  source_type: string;
  legacy_local_id: string | null;
  source_key: string | null;
}

function toTask(row: TaskRow): Task {
  return {
    id: brandId(row.id),
    tenantId: brandId(row.tenant_id),
    employmentCaseId: brandId(row.employment_case_id),
    title: row.title,
    titleKey: row.title_key,
    description: row.description,
    status: row.status as Task['status'],
    priority: row.priority as Task['priority'],
    dueAt: row.due_at ? row.due_at.toISOString() : null,
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    sourceType: row.source_type as Task['sourceType'],
    legacyLocalId: row.legacy_local_id,
    sourceKey: row.source_key,
  };
}

const TASK_COLUMNS = `id, tenant_id, employment_case_id, title, title_key, description,
  status, priority, due_at, completed_at, source_type, legacy_local_id, source_key`;

export class PgTaskRepository implements TaskRepository {
  constructor(private readonly pool: Pool) {}

  async createTask(input: CreateTaskRecord): Promise<Task> {
    return withTenant(this.pool, input.tenantId, async (client) => {
      const result = await client.query<TaskRow>(
        `insert into task
           (id, tenant_id, employment_case_id, title, title_key, description, priority, due_at,
            created_by, legacy_local_id, source_key, source_type)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, coalesce($12, 'manual'))
         returning ${TASK_COLUMNS}`,
        [
          input.id,
          input.tenantId,
          input.employmentCaseId,
          input.title ?? null,
          input.titleKey ?? null,
          input.description,
          input.priority,
          input.dueAt,
          input.createdBy,
          input.legacyLocalId ?? null,
          input.sourceKey ?? null,
          input.sourceType ?? null,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error('Task insert returned no row.');
      }
      return toTask(row);
    });
  }

  async listTasks(tenantId: string, employmentCaseId: string): Promise<Task[]> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<TaskRow>(
        `select ${TASK_COLUMNS} from task
         where employment_case_id = $1
         order by (status = 'completed'), due_at nulls last, created_at asc`,
        [employmentCaseId],
      );
      return result.rows.map(toTask);
    });
  }

  async findTask(tenantId: string, taskId: string): Promise<Task | null> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<TaskRow>(`select ${TASK_COLUMNS} from task where id = $1`, [
        taskId,
      ]);
      const row = result.rows[0];
      return row ? toTask(row) : null;
    });
  }

  async findTaskByLegacyLocalId(
    tenantId: string,
    employmentCaseId: string,
    legacyLocalId: string,
  ): Promise<Task | null> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<TaskRow>(
        `select ${TASK_COLUMNS} from task
         where employment_case_id = $1 and legacy_local_id = $2`,
        [employmentCaseId, legacyLocalId],
      );
      const row = result.rows[0];
      return row ? toTask(row) : null;
    });
  }

  async findTaskBySourceKey(
    tenantId: string,
    employmentCaseId: string,
    sourceKey: string,
  ): Promise<Task | null> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<TaskRow>(
        `select ${TASK_COLUMNS} from task
         where employment_case_id = $1 and source_key = $2`,
        [employmentCaseId, sourceKey],
      );
      const row = result.rows[0];
      return row ? toTask(row) : null;
    });
  }

  async completeTask(
    tenantId: string,
    taskId: string,
    completedAt: string,
    completedBy: string,
  ): Promise<Task | null> {
    return withTenant(this.pool, tenantId, async (client) => {
      // `status <> 'completed'` makes this idempotent: a repeated request
      // matches no row rather than rewriting the original completion time.
      const result = await client.query<TaskRow>(
        `update task
            set status = 'completed', completed_at = $2, completed_by = $3,
                updated_at = now(), updated_by = $3, version = version + 1
          where id = $1 and status <> 'completed'
         returning ${TASK_COLUMNS}`,
        [taskId, completedAt, completedBy],
      );
      const row = result.rows[0];
      return row ? toTask(row) : null;
    });
  }

  async updateTask(
    tenantId: string,
    taskId: string,
    changes: UpdateTaskRecord,
    updatedBy: string,
  ): Promise<Task | null> {
    return withTenant(this.pool, tenantId, async (client) => {
      // coalesce($n, column) leaves a field untouched when the caller did not
      // send it, so a partial PATCH body cannot blank out fields it never
      // mentioned. Closed/cancelled tasks are excluded — editing a done task
      // is not a supported operation, matching completeTask's own guard.
      const result = await client.query<TaskRow>(
        `update task
            set title = coalesce($2, title),
                description = case when $3::boolean then $4 else description end,
                priority = coalesce($5, priority),
                due_at = case when $6::boolean then $7 else due_at end,
                updated_at = now(), updated_by = $8, version = version + 1
          where id = $1 and status not in ('completed', 'cancelled')
         returning ${TASK_COLUMNS}`,
        [
          taskId,
          changes.title ?? null,
          changes.description !== undefined,
          changes.description ?? null,
          changes.priority ?? null,
          changes.dueAt !== undefined,
          changes.dueAt ?? null,
          updatedBy,
        ],
      );
      const row = result.rows[0];
      return row ? toTask(row) : null;
    });
  }

  async archiveTask(tenantId: string, taskId: string, updatedBy: string): Promise<Task | null> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<TaskRow>(
        `update task
            set status = 'cancelled', updated_at = now(), updated_by = $2, version = version + 1
          where id = $1 and status not in ('completed', 'cancelled')
         returning ${TASK_COLUMNS}`,
        [taskId, updatedBy],
      );
      const row = result.rows[0];
      return row ? toTask(row) : null;
    });
  }
}

interface TimelineRow {
  id: string;
  tenant_id: string;
  employment_case_id: string;
  event_type_key: string;
  summary_key: string;
  occurred_at: Date;
  actor_display: string | null;
  sensitivity: string;
}

/** Writes timeline events (TimelineService) and reads them back (TimelineRepository). */
export class PgTimelineService implements TimelineService, TimelineRepository {
  constructor(private readonly pool: Pool) {}

  async record(event: TimelineEventInput): Promise<void> {
    await withTenant(this.pool, event.tenantId, async (client) => {
      await client.query(
        `insert into timeline_event
           (tenant_id, employment_case_id, event_type_key, summary_key, occurred_at, sensitivity)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          event.tenantId,
          event.employmentCaseId,
          event.eventTypeKey,
          event.summaryKey,
          event.occurredAt,
          event.sensitivity,
        ],
      );
    });
  }

  async listTimeline(tenantId: string, employmentCaseId: string): Promise<TimelineEvent[]> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<TimelineRow>(
        `select id, tenant_id, employment_case_id, event_type_key, summary_key,
                occurred_at, actor_display, sensitivity
           from timeline_event
          where employment_case_id = $1
          order by occurred_at desc`,
        [employmentCaseId],
      );
      return result.rows.map((row): TimelineEvent => ({
        id: brandId(row.id),
        tenantId: brandId(row.tenant_id),
        employmentCaseId: brandId(row.employment_case_id),
        eventTypeKey: row.event_type_key,
        summaryKey: row.summary_key,
        occurredAt: row.occurred_at.toISOString(),
        actorDisplay: row.actor_display,
        sensitivity: row.sensitivity as TimelineEvent['sensitivity'],
      }));
    });
  }
}
