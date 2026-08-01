/* eslint-disable no-restricted-syntax */
import { useMemo, useState } from 'react';
import {
  readMvpTasks,
  saveMvpTasks,
  type MvpTask,
  type MvpTaskPriority,
} from '../storage/mvp-storage.js';
import { createQuarterlyInsuranceTask } from '../quarterly-national-insurance.js';

type TaskFilter = 'open' | 'week' | 'completed';

const NATIONAL_INSURANCE_PAYMENT_URL =
  'https://b2b.btl.gov.il/BTL.ILG.Payments/MeshekBaitInfoShort.aspx';

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
  const [tasks, setTasks] = useState(readMvpTasks);
  const [filter, setFilter] = useState<TaskFilter>('open');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [message, setMessage] = useState('');
  const quarterlyInsurance = useMemo(() => createQuarterlyInsuranceTask(today), [today]);

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
    };
    const next = existing
      ? tasks.map((task) => (task.id === existing.id ? saved : task))
      : [saved, ...tasks];
    persist(next);
    setShowForm(false);
    setFilter(saved.status === 'completed' ? 'completed' : 'open');
    setMessage(existing ? 'המשימה עודכנה ונשמרה.' : 'המשימה נוספה ונשמרה.');
  }

  function toggleTask(task: MvpTask) {
    persist(
      tasks.map((item) =>
        item.id === task.id
          ? { ...item, status: item.status === 'completed' ? 'open' : 'completed' }
          : item,
      ),
    );
  }

  function removeTask(task: MvpTask) {
    if (!window.confirm(`למחוק את המשימה "${task.title}"?`)) return;
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
              </div>
              <span className={`pill ${task.priority === 'urgent' ? 'amber' : 'neutral'}`}>
                {priorityLabels[task.priority]}
              </span>
              <div className="task-actions">
                <button className="secondary-button" type="button" onClick={() => editTask(task)}>
                  עריכה
                </button>
                <button className="danger-button" type="button" onClick={() => removeTask(task)}>
                  מחיקה
                </button>
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
