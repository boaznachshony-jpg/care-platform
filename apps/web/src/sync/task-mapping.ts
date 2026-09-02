import type { TaskPriority } from '@caredesk/domain';
import type { TaskResponse } from '@caredesk/schemas';
import type { MvpTask, MvpTaskPriority } from '../storage/mvp-storage.js';

/**
 * Known mapping problem #1 (see the cutover brief): the browser-only
 * priority vocabulary (`normal | important | urgent`) predates the canonical
 * one (`low | normal | high | urgent`) and has no exact match for
 * `'important'`. `'high'` is the closest in meaning and — critically — maps
 * back to the same Hebrew label ("חשוב") on `canonicalPriorityToLocal`, so a
 * task uploaded and then re-read shows the same priority on screen even
 * though the underlying enum value changed. `'low'` has no local twin at
 * all; it only ever appears on a task created directly on the server
 * (CaseTasksSection), and folds to `'normal'` for legacy-shaped display only
 * — it is never written back to the server as `'normal'`.
 */
export function localTaskPriorityToCanonical(priority: MvpTaskPriority): TaskPriority {
  return priority === 'important' ? 'high' : priority;
}

export function canonicalTaskPriorityToLocal(priority: TaskPriority): MvpTaskPriority {
  if (priority === 'high') return 'important';
  if (priority === 'low') return 'normal';
  return priority;
}

/**
 * A server-side task, reshaped so it can flow through the same legacy-typed
 * list/UI as a local `MvpTask` without a parallel rendering path. Used both
 * for records this browser uploaded itself (server row now authoritative)
 * and for records created elsewhere (another device, or directly via
 * CaseTasksSection) that this browser is seeing for the first time.
 *
 * `source`/`sourceDate` (the automatic-task machinery in mvp-storage.ts) has
 * no server equivalent — a server-origin task is never one of the three
 * profile-driven automatic tasks, so both are simply absent here, which is
 * exactly what makes the legacy UI treat it as an ordinary editable task.
 */
export function taskResponseToLocal(response: TaskResponse, fallbackCreatedAt: string): MvpTask {
  return {
    id: response.legacyLocalId ?? response.id,
    title: response.title ?? '',
    dueDate: response.dueAt ? response.dueAt.slice(0, 10) : '',
    priority: canonicalTaskPriorityToLocal(response.priority as TaskPriority),
    // The legacy screen only ever distinguishes open vs completed; the wider
    // canonical vocabulary (in_progress/blocked/deferred/cancelled) reads as
    // "still open" here rather than inventing a fourth bucket this UI has no
    // way to show.
    status: response.status === 'completed' ? 'completed' : 'open',
    createdAt: fallbackCreatedAt,
  };
}
