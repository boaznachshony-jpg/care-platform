/* eslint-disable no-restricted-syntax */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  readMvpTasks,
  saveMvpTasks,
  type MvpTask,
  type MvpTaskPriority,
  type MvpTaskSource,
} from '../storage/mvp-storage.js';
import { createQuarterlyInsuranceTask } from '../quarterly-national-insurance.js';
import { NATIONAL_INSURANCE_PAYMENT_URL } from '../upcoming-payments.js';
import { archiveCaseTask, completeCaseTask, importCaseTask, listCaseTasks } from '../api/client.js';
import { useLegacyClientId } from '../hooks/use-legacy-client-id.js';
import { useCaseForLegacyClient } from '../sync/use-case-for-legacy-client.js';
import {
  getUploadedServerId,
  rememberUploadedServerId,
  uploadUnsyncedRecords,
  type SyncStatus,
} from '../sync/legacy-upload.js';
import { localTaskPriorityToCanonical, taskResponseToLocal } from '../sync/task-mapping.js';

type TaskFilter = 'open' | 'week' | 'completed';

const emptyDraft = {
  title: '',
  dueDate: '',
  priority: 'normal' as MvpTaskPriority,
};

const priorityLabels: Record<MvpTaskPriority, string> = {
  normal: 'רגיל',
  important: 'חשוב',
  urgent: 'דחוף',
};

const automaticTaskNotes: Record<MvpTaskSource, string> = {
  'medical-insurance': 'נוצרה אוטומטית מתוקף הביטוח הרפואי שנשמר בתיק.',
  'employment-license': 'נוצרה אוטומטית ממועד חידוש רישיון ההעסקה שנשמר בתיק.',
  'visa-renewal': 'נוצרה אוטומטית ממועד חידוש הוויזה שנשמר בתיק.',
};

function isDueThisWeek(dueDate: string): boolean {
  const due = new Date(`${dueDate}T12:00:00`);
  const now = new Date();
  const weekFromNow = new Date();
  weekFromNow.setDate(now.getDate() + 7);
  return due >= now && due <= weekFromNow;
}

function displayDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

export function TasksPage({ today }: { today?: Date } = {}) {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState(readMvpTasks);
  const [filter, setFilter] = useState<TaskFilter>('open');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [message, setMessage] = useState('');
  const quarterlyInsurance = useMemo(() => createQuarterlyInsuranceTask(today), [today]);

  // The case this device's local tasks belong to, if setup has gone far
  // enough to have opened one. Nothing below runs until this resolves, and
  // 'none'/'unavailable' both leave this screen exactly as it always
  // behaved — pure local storage, no network involved.
  const legacyClientId = useLegacyClientId();
  const caseLookup = useCaseForLegacyClient(legacyClientId);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ phase: 'checking' });
  const [syncAttempt, setSyncAttempt] = useState(0);

  useEffect(() => {
    if (caseLookup.status === 'checking') {
      setSyncStatus({ phase: 'checking' });
      return;
    }
    if (caseLookup.status !== 'found') {
      setSyncStatus({ phase: 'no-case' });
      return;
    }
    const caseId = caseLookup.caseId;
    let active = true;

    async function run() {
      // Step 1: upload whatever this browser holds locally and has not
      // already sent for this case. Idempotent on legacyLocalId (migration
      // 0046) — safe to attempt on every mount, every retry, every tab.
      const localNow = readMvpTasks();
      const outcome = await uploadUnsyncedRecords('tasks', caseId, localNow, (task) =>
        importCaseTask(caseId, {
          legacyLocalId: task.id,
          title: task.title,
          priority: localTaskPriorityToCanonical(task.priority),
          dueDate: task.dueDate || undefined,
          status: task.status,
        }),
      );
      if (!active) return;
      if (outcome.failedIds.length > 0) {
        setSyncStatus({ phase: 'upload-failed', failedCount: outcome.failedIds.length });
        return;
      }

      // Step 2: read the canonical list back. This is what makes a second
      // device (or a task someone else added straight on /cases/:caseId)
      // show up here — local storage alone can never know about it.
      try {
        const serverTasks = await listCaseTasks(caseId);
        if (!active) return;
        const byLocalId = new Map(
          serverTasks
            .filter((task) => task.legacyLocalId)
            .map((task) => [task.legacyLocalId as string, task] as const),
        );
        const merged = readMvpTasks().map((task) => {
          const match = byLocalId.get(task.id);
          return match ? taskResponseToLocal(match, task.createdAt) : task;
        });
        // Tasks that exist on the server but were never created on this
        // device (legacyLocalId null — created on another device, or
        // directly via CaseTasksSection) are appended and pre-marked as
        // already-uploaded so the next sync pass never tries to "import"
        // something that is already canonical.
        for (const serverTask of serverTasks) {
          if (serverTask.legacyLocalId) continue;
          if (merged.some((task) => task.id === serverTask.id)) continue;
          rememberUploadedServerId('tasks', caseId, serverTask.id, serverTask.id);
          merged.push(taskResponseToLocal(serverTask, new Date().toISOString()));
        }
        saveMvpTasks(merged);
        setTasks(merged);
        setSyncStatus({ phase: 'synced' });
      } catch {
        // Uploaded successfully but could not read the list back — the
        // local copy (already reflecting the upload attempt) stays on
        // screen, honestly labelled as possibly stale rather than canonical.
        setSyncStatus({ phase: 'offline' });
      }
    }

    void run();
    return () => {
      active = false;
    };
  }, [caseLookup, syncAttempt]);

  const visibleTasks = useMemo(
    () =>
      tasks
        .filter((task) => {
          if (filter === 'completed') return task.status === 'completed';
          if (filter === 'week') return task.status === 'open' && isDueThisWeek(task.dueDate);
          return task.status === 'open';
        })
        .sort((first, second) => first.dueDate.localeCompare(second.dueDate)),
    [filter, tasks],
  );

  function persist(next: MvpTask[]) {
    saveMvpTasks(next);
    setTasks(next);
  }

  function openNewTask() {
    setDraft(emptyDraft);
    setEditingId(null);
    setShowForm(true);
    setMessage('');
  }

  function editTask(task: MvpTask) {
    setDraft({ title: task.title, dueDate: task.dueDate, priority: task.priority });
    setEditingId(task.id);
    setShowForm(true);
    setMessage('');
  }

  function saveTask(event: React.FormEvent) {
    event.preventDefault();
    const existing = tasks.find((task) => task.id === editingId);
    const saved: MvpTask = {
      id: existing?.id ?? crypto.randomUUID(),
      title: draft.title.trim(),
      dueDate: draft.dueDate,
      priority: draft.priority,
      status: existing?.status ?? 'open',
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      source: existing?.source,
      sourceDate: existing?.sourceDate,
    };
    const next = existing
      ? tasks.map((task) => (task.id === existing.id ? saved : task))
      : [saved, ...tasks];
    persist(next);
    setShowForm(false);
    setFilter(saved.status === 'completed' ? 'completed' : 'open');
    setMessage(existing ? 'המשימה עודכנה ונשמרה.' : 'המשימה נוספה ונשמרה.');
    // A brand-new task is not yet on the server; re-running the sync pass
    // (rather than importing inline here) reuses the same idempotent,
    // failure-visible path instead of a second, parallel upload codepath.
    if (!existing && caseLookup.status === 'found') setSyncAttempt((count) => count + 1);
  }

  function toggleTask(task: MvpTask) {
    const nextStatus = task.status === 'completed' ? 'open' : 'completed';
    persist(tasks.map((item) => (item.id === task.id ? { ...item, status: nextStatus } : item)));
    // Forwarded best-effort only in the open->completed direction: the
    // server has a `complete` action but no `reopen` one, so an uncheck
    // here cannot be mirrored server-side. The task stays reopened locally
    // regardless — Constitution §13, local input is never rolled back
    // because a server call has nowhere to go.
    if (nextStatus === 'completed' && caseLookup.status === 'found') {
      const serverId = getUploadedServerId('tasks', caseLookup.caseId, task.id);
      if (serverId) void completeCaseTask(caseLookup.caseId, serverId).catch(() => undefined);
    }
  }

  function removeTask(task: MvpTask) {
    if (!window.confirm(`למחוק את המשימה "${task.title}"?`)) return;
    // Local delete only — this is the pre-existing behaviour, unchanged. The
    // server side is soft-closed (archived), never deleted (there is no
    // delete route for tasks), which is the safer of the two possible
    // outcomes: a device removing its own local copy never erases the case's
    // history on the server or on any other device.
    if (caseLookup.status === 'found') {
      const serverId = getUploadedServerId('tasks', caseLookup.caseId, task.id);
      if (serverId) void archiveCaseTask(caseLookup.caseId, serverId).catch(() => undefined);
    }
    persist(tasks.filter((item) => item.id !== task.id));
    setMessage('המשימה נמחקה.');
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">משימות</p>
          <h1>מה צריך לבצע</h1>
          <p>משימות שהזנתם, מסודרות לפי מועד יעד.</p>
        </div>
        <button className="primary-button" type="button" onClick={openNewTask}>
          ＋ משימה חדשה
        </button>
      </header>

      {message ? (
        <p className="info-box" role="status">
          {message}
        </p>
      ) : null}

      {/*
        Honest labelling of which copy is on screen (see cutover brief §2):
        'offline'/'no-case' say plainly that this is the device's own copy,
        never presented as if it were confirmed synced. 'upload-failed' names
        a real count and offers a retry that reuses the same idempotent path.
        'synced'/'checking' render nothing — a quiet success is the right
        amount of noise for a screen the user opens many times a day.
      */}
      {syncStatus.phase === 'offline' ? (
        <p className="info-box" role="status">
          {t('tasks.sync.localCopy')}
        </p>
      ) : syncStatus.phase === 'upload-failed' ? (
        <p className="action-notice error" role="alert">
          {t('tasks.sync.uploadFailed', { count: syncStatus.failedCount })}{' '}
          <button
            className="text-link"
            type="button"
            onClick={() => setSyncAttempt((count) => count + 1)}
          >
            {t('tasks.sync.retry')}
          </button>
        </p>
      ) : null}

      {showForm ? (
        <form className="card readable-form task-editor" onSubmit={saveTask}>
          <div className="section-heading">
            <h2>{editingId ? 'עריכת משימה' : 'משימה חדשה'}</h2>
            <button className="text-link" type="button" onClick={() => setShowForm(false)}>
              סגירה
            </button>
          </div>
          <div className="form-grid">
            <label>
              מה צריך לבצע?
              <input
                required
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </label>
            <label>
              מועד יעד
              <input
                required
                type="date"
                value={draft.dueDate}
                onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })}
              />
            </label>
            <label>
              עדיפות
              <select
                value={draft.priority}
                onChange={(event) =>
                  setDraft({ ...draft, priority: event.target.value as MvpTaskPriority })
                }
              >
                <option value="normal">רגיל</option>
                <option value="important">חשוב</option>
                <option value="urgent">דחוף</option>
              </select>
            </label>
          </div>
          <button className="primary-button" type="submit">
            שמירת המשימה
          </button>
        </form>
      ) : null}

      <section
        className={`card quarterly-insurance-card ${quarterlyInsurance.status}`}
        aria-label="משימת ביטוח לאומי רבעונית"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">משימה רבעונית</p>
            <h2>{quarterlyInsurance.title}</h2>
          </div>
          <span className={`pill quarterly-status ${quarterlyInsurance.status}`}>
            {quarterlyInsurance.statusLabel}
          </span>
        </div>
        <div className="quarterly-insurance-details">
          <p>{quarterlyInsurance.periodRange}</p>
          <p>{quarterlyInsurance.paymentWindow}</p>
          <strong>{quarterlyInsurance.deadlineLabel}</strong>
        </div>
        {/* The quarterly window and deadline are computed, not stored facts. */}
        <p className="legal-note">{t('liability.reminder')}</p>
        {quarterlyInsurance.preparationOnly ? (
          <p className="form-note">
            היום מכינים ומרכזים את נתוני שלושת חודשי הרבעון. אפשרות הדיווח והתשלום תיפתח מחר.
          </p>
        ) : quarterlyInsurance.status === 'not_open' ? (
          <p className="form-note">אפשרות הדיווח והתשלום עדיין אינה פתוחה.</p>
        ) : null}
        <a
          className="secondary-button national-insurance-link"
          href={NATIONAL_INSURANCE_PAYMENT_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          מעבר לאתר הביטוח הלאומי לדיווח ולתשלום
        </a>
      </section>

      <div className="filter-row" aria-label="סינון משימות">
        <button
          className={filter === 'open' ? 'active' : ''}
          type="button"
          onClick={() => setFilter('open')}
        >
          פתוחות
        </button>
        <button
          className={filter === 'week' ? 'active' : ''}
          type="button"
          onClick={() => setFilter('week')}
        >
          השבוע
        </button>
        <button
          className={filter === 'completed' ? 'active' : ''}
          type="button"
          onClick={() => setFilter('completed')}
        >
          הושלמו
        </button>
      </div>

      <section className="list-card" aria-live="polite">
        {visibleTasks.length === 0 ? (
          <div className="empty-panel">
            <h2>{filter === 'completed' ? 'אין משימות שהושלמו' : 'אין משימות להצגה'}</h2>
            <p>לחצו על „משימה חדשה” כדי להוסיף משימה ומועד יעד.</p>
          </div>
        ) : (
          visibleTasks.map((task) => (
            <article
              className={`list-task ${task.status === 'completed' ? 'completed' : ''}`}
              key={task.id}
            >
              <button
                className="check"
                type="button"
                aria-label={
                  task.status === 'completed' ? `החזרת ${task.title}` : `השלמת ${task.title}`
                }
                onClick={() => toggleTask(task)}
              >
                {task.status === 'completed' ? '✓' : ''}
              </button>
              <div>
                <h3>{task.title}</h3>
                <p>מועד יעד: {displayDate(task.dueDate)}</p>
                {task.source ? <small>{automaticTaskNotes[task.source]}</small> : null}
              </div>
              <span className={`pill ${task.priority === 'urgent' ? 'amber' : 'neutral'}`}>
                {priorityLabels[task.priority]}
              </span>
              {task.source ? null : (
                <div className="task-actions">
                  <button className="secondary-button" type="button" onClick={() => editTask(task)}>
                    עריכה
                  </button>
                  <button className="danger-button" type="button" onClick={() => removeTask(task)}>
                    מחיקה
                  </button>
                </div>
              )}
            </article>
          ))
        )}
      </section>
    </div>
  );
}
