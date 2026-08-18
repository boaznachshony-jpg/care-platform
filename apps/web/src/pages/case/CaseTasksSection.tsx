import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { TASK_PRIORITIES } from '@caredesk/domain';
import {
  createTaskRequestSchema,
  type CreateTaskRequest,
  type TaskResponse,
} from '@caredesk/schemas';
import { Alert, Button, EmptyState, Skeleton, StatusBadge, TextField } from '@caredesk/ui';
import { completeCaseTask, createCaseTask, listCaseTasks } from '../../api/client.js';

function statusTone(status: string): 'success' | 'warning' | 'neutral' {
  if (status === 'completed') return 'success';
  if (status === 'blocked') return 'warning';
  return 'neutral';
}

export function CaseTasksSection({ caseId }: { caseId: string }) {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<TaskResponse[] | null>(null);
  const [addFailed, setAddFailed] = useState(false);
  const [completeFailed, setCompleteFailed] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateTaskRequest>({
    resolver: zodResolver(createTaskRequestSchema),
    // Without this the select shows its first option ("low") while the schema
    // default is "normal" — a user who never touches the field would silently
    // file every task at the wrong priority.
    defaultValues: { priority: 'normal' },
  });

  useEffect(() => {
    let cancelled = false;
    listCaseTasks(caseId)
      .then((rows) => {
        if (!cancelled) setTasks(rows);
      })
      .catch(() => {
        if (!cancelled) setTasks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  const onSubmit = handleSubmit(async (data) => {
    setAddFailed(false);
    try {
      await createCaseTask(caseId, data);
      setTasks(await listCaseTasks(caseId));
      reset();
    } catch {
      setAddFailed(true);
    }
  });

  async function onComplete(taskId: string): Promise<void> {
    setCompleteFailed(false);
    setCompletingId(taskId);
    try {
      await completeCaseTask(caseId, taskId);
      setTasks(await listCaseTasks(caseId));
    } catch {
      setCompleteFailed(true);
    } finally {
      setCompletingId(null);
    }
  }

  return (
    <section>
      <h2>{t('tasks.heading')}</h2>
      {completeFailed ? <Alert variant="error" title={t('tasks.completeFailed')} /> : null}

      {tasks === null ? (
        <Skeleton loadingLabel={t('shell.loading')} height="1.5rem" width="14rem" />
      ) : tasks.length === 0 ? (
        <EmptyState title={t('tasks.empty')} body="" />
      ) : (
        <ul>
          {tasks.map((task) => (
            <li key={task.id}>
              <span>{task.title}</span>{' '}
              <StatusBadge
                tone={statusTone(task.status)}
                label={t(`tasks.status.${task.status}`)}
              />{' '}
              <StatusBadge tone="neutral" label={t(`tasks.priorityLevel.${task.priority}`)} />
              {task.dueAt ? (
                <span>
                  {' '}
                  {t('tasks.due')}: <span dir="ltr">{task.dueAt.slice(0, 10)}</span>
                </span>
              ) : null}
              {task.status !== 'completed' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={completingId === task.id}
                  onClick={() => void onComplete(task.id)}
                >
                  {completingId === task.id ? t('tasks.completing') : t('tasks.complete')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <h3>{t('tasks.addHeading')}</h3>
      {addFailed ? <Alert variant="error" title={t('tasks.addFailed')} /> : null}

      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        <TextField
          label={t('tasks.title')}
          required
          error={errors.title ? t('case.fieldRequired') : undefined}
          {...register('title')}
        />
        <TextField
          label={t('tasks.dueDate')}
          type="date"
          inputDir="ltr"
          error={errors.dueDate ? t('case.fieldRequired') : undefined}
          {...register('dueDate')}
        />

        <div className="cd-text-field">
          <label className="cd-text-field__label" htmlFor="taskPriority">
            {t('tasks.priority')}
          </label>
          <select id="taskPriority" className="cd-text-field__input" {...register('priority')}>
            {TASK_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {t(`tasks.priorityLevel.${priority}`)}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t('tasks.submitting') : t('tasks.submit')}
        </Button>
      </form>
    </section>
  );
}
