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
  dueDate: z.preprocess((value) => (value === '' ? undefined : value), isoDateSchema.optional()),
});

export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

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
