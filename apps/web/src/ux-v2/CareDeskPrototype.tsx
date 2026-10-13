import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@caredesk/ui';
import copy from './he.json';

type View = 'today' | 'medication' | 'obligation';
type Category = 'daily' | 'medication' | 'obligation';
type Due = 'today' | 'tomorrow' | 'later';
type Filter = 'open' | 'completed' | 'all';
interface DemoTask {
  id: string;
  category: Category;
  title: string;
  description: string;
  owner: string;
  due: Due;
  completed: boolean;
  reason?: string;
}
const categories: Category[] = ['daily', 'medication', 'obligation'];
const dueOptions: Due[] = ['today', 'tomorrow', 'later'];
const views: View[] = ['today', 'medication', 'obligation'];
const categoryLabel = (category: Category) =>
  category === 'daily' ? copy.form.daily : copy.nav[category];
// Fixtures are UI-only, deliberately unrelated to persisted domain aggregates.
function initialTasks(): DemoTask[] {
  return copy.fixtures.map((task) => ({
    ...task,
    category: categories.find((value) => value === task.category) ?? 'daily',
    due: dueOptions.find((value) => value === task.due) ?? 'today',
    completed: false,
  }));
}

export function CareDeskPrototype() {
  const [tasks, setTasks] = useState(initialTasks);
  const [view, setView] = useState<View>('today');
  const [filter, setFilter] = useState<Filter>('open');
  const [search, setSearch] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(''), 5000);
    return () => window.clearTimeout(timer);
  }, [message]);
  const addButton = useRef<HTMLButtonElement>(null);
  const visible = tasks.filter(
    (task) =>
      (view === 'today' || task.category === view) &&
      (filter === 'all' || task.completed === (filter === 'completed')) &&
      `${task.title} ${task.owner} ${task.description}`.includes(search.trim()),
  );
  const upcoming = tasks.filter((task) => task.category === 'obligation' && !task.completed);
  function navigate(next: View) {
    setView(next);
    setFilter('open');
    setSearch('');
  }
  function toggle(id: string) {
    const task = tasks.find((item) => item.id === id);
    setTasks((items) =>
      items.map((item) => (item.id === id ? { ...item, completed: !item.completed } : item)),
    );
    setMessage(task?.completed ? copy.taskReopened : copy.taskDone);
  }
  function closeForm() {
    setIsAdding(false);
    addButton.current?.focus();
  }

  return (
    <div className="ux-v2" dir="rtl">
      <a className="ux-skip" href="#ux-main">
        {copy.skip}
      </a>
      <aside className="ux-sidebar" aria-label={copy.workspace}>
        <div className="ux-brand">
          <span className="ux-brand-mark" aria-hidden="true">
            c.
          </span>
          <span dir="ltr">
            {copy.brand}
            <small>{copy.version}</small>
          </span>
        </div>
        <p className="ux-tagline">{copy.tagline}</p>
        <div className="ux-family">
          <span className="ux-avatar" aria-hidden="true">
            {copy.familyInitial}
          </span>
          <div>
            <small>{copy.workspace}</small>
            <strong>{copy.family}</strong>
          </div>
        </div>
        <nav aria-label={copy.navLabel}>
          {views.map((item, index) => (
            <button
              key={item}
              type="button"
              aria-current={view === item ? 'page' : undefined}
              onClick={() => navigate(item)}
            >
              <span className="ux-nav-number" aria-hidden="true">
                0{index + 1}
              </span>
              {copy.nav[item]}
              <span className="ux-nav-dot" aria-hidden="true" />
            </button>
          ))}
        </nav>
        <div className="ux-sidebar-bottom">
          <span className="ux-live-dot" />
          {copy.demo}
          <p>{copy.demoNote}</p>
        </div>
      </aside>
      <div className="ux-content">
        <header className="ux-topbar">
          <span>{copy.greeting}</span>
          <span className="ux-demo-pill">{copy.demo}</span>
        </header>
        <main id="ux-main" tabIndex={-1}>
          <div className="ux-heading">
            <div>
              <p className="ux-eyebrow">
                {copy.nav[view]} <span aria-hidden="true">/</span> {copy.family}
              </p>
              <h1>{copy.titles[view]}</h1>
              <p>{copy.subtitles[view]}</p>
            </div>
            <Button ref={addButton} className="ux-add" onClick={() => setIsAdding(true)}>
              {copy.newTask}
            </Button>
          </div>
          {isAdding && (
            <TaskForm
              onCancel={closeForm}
              onAdd={(task) => {
                setTasks((items) => [...items, task]);
                navigate('today');
                setMessage(copy.taskAdded);
                closeForm();
              }}
            />
          )}
          {view === 'today' && tasks.some((task) => task.id === 'med-1' && !task.completed) && (
            <section className="ux-focus" aria-labelledby="focus-title">
              <div>
                <span className="ux-focus-label">{copy.focus}</span>
                <h2 id="focus-title">{copy.focusTitle}</h2>
                <p>{copy.focusDescription}</p>
                <Button onClick={() => navigate('medication')}>
                  {copy.focusAction}
                  <span aria-hidden="true"> ←</span>
                </Button>
              </div>
              <div className="ux-focus-art" aria-hidden="true">
                <div className="ux-orbit" />
                <span className="ux-pill-art" />
                <span className="ux-art-caption">{copy.artCaption}</span>
              </div>
            </section>
          )}
          <div className="ux-columns">
            <section className="ux-list" aria-labelledby="list-title">
              <div className="ux-section-heading">
                <h2 id="list-title">{view === 'today' ? copy.daily : copy.nav[view]}</h2>
                <span className="ux-count">{visible.length}</span>
              </div>
              <div className="ux-toolbar">
                <div className="ux-filters" aria-label={copy.daily}>
                  {(['open', 'completed', 'all'] as const).map((item) => (
                    <button
                      type="button"
                      key={item}
                      aria-pressed={filter === item}
                      onClick={() => setFilter(item)}
                    >
                      {copy[item]}
                    </button>
                  ))}
                </div>
                <label className="ux-search">
                  <span className="ux-sr-only">{copy.search}</span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={copy.searchPlaceholder}
                    type="search"
                  />
                </label>
              </div>
              <div className="ux-task-list">
                {visible.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onToggle={() => toggle(task.id)}
                    onDefer={(reason) => {
                      setTasks((items) =>
                        items.map((item) =>
                          item.id === task.id ? { ...item, due: 'tomorrow', reason } : item,
                        ),
                      );
                      setMessage(copy.taskDeferred);
                    }}
                  />
                ))}
              </div>
              {visible.length === 0 && (
                <div className="ux-empty">
                  <span aria-hidden="true">✓</span>
                  <h3>{copy.empty}</h3>
                  <p>{copy.emptyHint}</p>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setFilter('all');
                      setSearch('');
                    }}
                  >
                    {copy.clearFilters}
                  </Button>
                </div>
              )}
            </section>
            <aside className="ux-context" aria-label={copy.upcoming}>
              <section className="ux-upcoming">
                <p className="ux-eyebrow">{copy.nextUp}</p>
                <h2>{copy.upcoming}</h2>
                <p>{copy.upcomingHint}</p>
                {upcoming.map((task) => (
                  <div className="ux-upcoming-item" key={task.id}>
                    <span>{copy[task.due]}</span>
                    <strong>{task.title}</strong>
                    <small>
                      {copy.owner}: {task.owner}
                    </small>
                  </div>
                ))}
                {upcoming.length === 0 && <p>{copy.empty}</p>}
                <Button variant="quiet" onClick={() => navigate('obligation')}>
                  {copy.viewObligations}
                  <span aria-hidden="true"> ←</span>
                </Button>
              </section>
              <section className="ux-team">
                <div className="ux-avatars" aria-hidden="true">
                  <span>{copy.form.dana[0]}</span>
                  <span>{copy.form.ori[0]}</span>
                </div>
                <h3>{copy.team}</h3>
                <p>{copy.teamHint}</p>
                <small>{copy.teamMembers}</small>
              </section>
            </aside>
          </div>
          <footer>
            {copy.notice}
            <br />
            {copy.demoNote}
          </footer>
        </main>
      </div>
      <div
        className="ux-announcement"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        key={message}
      >
        {message}
      </div>
    </div>
  );
}

function TaskCard({
  task,
  onToggle,
  onDefer,
}: {
  task: DemoTask;
  onToggle: () => void;
  onDefer: (reason: string) => void;
}) {
  const [isDeferring, setIsDeferring] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(false);
  const deferButton = useRef<HTMLButtonElement>(null);
  return (
    <article className={`ux-task ${task.completed ? 'ux-task-done' : ''}`}>
      <button
        type="button"
        className="ux-check"
        aria-label={`${task.completed ? copy.undo : task.category === 'medication' ? copy.purchased : copy.complete}: ${task.title}`}
        aria-pressed={task.completed}
        onClick={onToggle}
      >
        <span aria-hidden="true">{task.completed ? '✓' : ''}</span>
      </button>
      <div className="ux-task-body">
        <div className="ux-task-meta">
          <span>{categoryLabel(task.category)}</span>
          <span className={task.due === 'today' ? 'ux-due-today' : ''}>
            {task.completed ? copy.done : task.reason ? copy.deferred : copy[task.due]}
          </span>
        </div>
        <h3>{task.title}</h3>
        <p className="ux-owner">
          {copy.owner}: <strong>{task.owner}</strong>
        </p>
        <details>
          <summary>{copy.details}</summary>
          <p>{task.description}</p>
          <small>
            {copy.source}: {copy.sourceValue}
          </small>
          {task.reason && (
            <p>
              {copy.reason}: {task.reason}
            </p>
          )}
        </details>
        {!task.completed && (
          <Button
            ref={deferButton}
            variant="quiet"
            onClick={() => setIsDeferring(!isDeferring)}
            aria-expanded={isDeferring}
          >
            {copy.defer}
          </Button>
        )}
        {isDeferring && (
          <form
            className="ux-defer-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!reason.trim()) {
                setError(true);
                return;
              }
              onDefer(reason.trim());
              setIsDeferring(false);
              setError(false);
              deferButton.current?.focus();
            }}
          >
            <label htmlFor={`reason-${task.id}`}>{copy.reason}</label>
            <input
              id={`reason-${task.id}`}
              value={reason}
              maxLength={160}
              onChange={(event) => setReason(event.target.value)}
              aria-invalid={error}
              aria-describedby={error ? `error-${task.id}` : undefined}
            />
            {error && (
              <p id={`error-${task.id}`} role="alert">
                {copy.reasonRequired}
              </p>
            )}
            <Button type="submit">{copy.saveDefer}</Button>
          </form>
        )}
      </div>
    </article>
  );
}

function TaskForm({ onAdd, onCancel }: { onAdd: (task: DemoTask) => void; onCancel: () => void }) {
  const titleInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleInput.current?.focus();
  }, []);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<Category>('daily');
  const [due, setDue] = useState<Due>('today');
  const [owner, setOwner] = useState(copy.form.me);
  const [error, setError] = useState(false);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || title.length > 100) {
      setError(true);
      return;
    }
    onAdd({
      id: crypto.randomUUID(),
      title: title.trim(),
      description: copy.sourceValue,
      owner,
      category,
      due,
      completed: false,
    });
  }
  return (
    <form className="ux-new-form" onSubmit={submit} aria-labelledby="new-task-title">
      <h2 id="new-task-title">{copy.form.title}</h2>
      <label htmlFor="task-title">{copy.form.name}</label>
      <input
        id="task-title"
        ref={titleInput}
        value={title}
        maxLength={100}
        onChange={(event) => setTitle(event.target.value)}
        aria-invalid={error}
        aria-describedby={error ? 'task-error' : undefined}
      />
      {error && (
        <p id="task-error" role="alert">
          {copy.form.error}
        </p>
      )}
      <div className="ux-form-fields">
        <label>
          {copy.form.category}
          <select
            value={category}
            onChange={(event) =>
              setCategory(categories.find((value) => value === event.target.value) ?? 'daily')
            }
          >
            {categories.map((item) => (
              <option key={item} value={item}>
                {categoryLabel(item)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {copy.form.owner}
          <select value={owner} onChange={(event) => setOwner(event.target.value)}>
            {[copy.form.me, copy.form.dana, copy.form.ori].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          {copy.form.due}
          <select
            value={due}
            onChange={(event) =>
              setDue(dueOptions.find((value) => value === event.target.value) ?? 'today')
            }
          >
            {dueOptions.map((item) => (
              <option key={item} value={item}>
                {copy[item]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="ux-form-actions">
        <Button type="submit">{copy.form.save}</Button>
        <Button variant="quiet" onClick={onCancel}>
          {copy.cancel}
        </Button>
      </div>
    </form>
  );
}
