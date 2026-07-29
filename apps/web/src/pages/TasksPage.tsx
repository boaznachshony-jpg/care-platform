import { useState } from 'react';
const seed = [
  ['בדיקת ביטוח רפואי', '03.08.2026', 'מומלץ'],
  ['הכנת תשלום שכר', '09.08.2026', 'השבוע'],
  ['בדיקת יתרת חופשה', '15.08.2026', 'רגיל'],
  ['תשלום ביטוח לאומי', '30.09.2026', 'רבעוני'],
] as const;
export function TasksPage() {
  const [done, setDone] = useState<string[]>([]);
  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">משימות</p>
          <h1>מה צריך לבצע</h1>
          <p>רשימה פשוטה לפי עדיפות ומועד.</p>
        </div>
        <button className="primary-button">＋ משימה חדשה</button>
      </header>
      <div className="filter-row">
        <button className="active">פתוחות</button>
        <button>השבוע</button>
        <button>הושלמו</button>
      </div>
      <section className="list-card">
        {seed.map(([title, date, tag]) => (
          <article className={`list-task ${done.includes(title) ? 'completed' : ''}`} key={title}>
            <button
              className="check"
              onClick={() =>
                setDone((d) => (d.includes(title) ? d.filter((x) => x !== title) : [...d, title]))
              }
            >
              {done.includes(title) ? '✓' : ''}
            </button>
            <div>
              <h3>{title}</h3>
              <p>מועד יעד: {date}</p>
            </div>
            <span className="pill neutral">{tag}</span>
            <button className="more">•••</button>
          </article>
        ))}
      </section>
    </div>
  );
}
