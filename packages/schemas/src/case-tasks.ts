import { z } from 'zod';
import { TASK_PRIORITIES } from '@caredesk/domain';
import { isoDateSchema } from './date.js';

export const createTaskRequestSchema = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).optional(),
  priority: z.enum(TASK_PRIORITIES).default('normal'),
  /**
   * ISO date (YYYY-MM-DD); the API stores it as a timestamp at day start.
   *
   * An untouched `<input type="date">` submits "", not undefined, so the empty
   * string is normalised away first — otherwise leaving this optional field
   * blank fails the regex and blocks the whole form.
   */
  dueDate: z
    .string()
    .optional()
    .transform((v) => (v === '' ? undefined : v))
    .pipe(isoDateSchema.optional()),
});

export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

/** Every field optional — a PATCH sends only what changed. `dueDate: null` clears it. */
export const updateTaskRequestSchema = z
  .object({
    title: z.string().trim().min(2).max(160).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    dueDate: isoDateSchema.nullable().optional(),
  })
  .strict();

export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>;

/**
 * Upload of one browser-only task (`MvpTask` in mvp-storage.ts). `legacyLocalId`
 * is the client's own id — the field the server keys idempotency on (migration
 * 0046) — so replaying the same import twice must send the same value both
 * times.
 */
export const importTaskRequestSchema = z.object({
  legacyLocalId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).optional(),
  priority: z.enum(TASK_PRIORITIES).default('normal'),
  dueDate: z
    .string()
    .optional()
    .transform((v) => (v === '' ? undefined : v))
    .pipe(isoDateSchema.optional()),
  status: z.enum(['open', 'completed']).default('open'),
  /** The device's own completion timestamp, when known; otherwise the import moment is used. */
  completedAt: z.string().datetime().optional(),
});

export type ImportTaskRequest = z.infer<typeof importTaskRequestSchema>;

export const taskResponseSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  titleKey: z.string().nullable(),
  description: z.string().nullable(),
  status: z.string(),
  priority: z.string(),
  dueAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  sourceType: z.string(),
  legacyLocalId: z.string().nullable(),
});

export type TaskResponse = z.infer<typeof taskResponseSchema>;

export const timelineEventResponseSchema = z.object({
  id: z.string(),
  eventTypeKey: z.string(),
  summaryKey: z.string(),
  occurredAt: z.string(),
  actorDisplay: z.string().nullable(),
  sensitivity: z.string(),
});

export type TimelineEventResponse = z.infer<typeof timelineEventResponseSchema>;
