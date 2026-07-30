/* eslint-disable no-restricted-syntax */
const events = [
  ['03 אוג׳', 'בדיקת ביטוח רפואי', 'פעולה מומלצת', 'amber'],
  ['09 אוג׳', 'הכנת שכר יולי', 'פעולה חודשית', 'blue'],
  ['15 אוג׳', 'יום חופשה מתוכנן', 'מידע', 'green'],
  ['31 אוג׳', 'סיכום חודש', 'בדיקה אוטומטית', 'neutral'],
  [
    '15 אוק׳',
    'תשלום ביטוח לאומי',
    'מועד טיפול פנימי עבור יולי–ספטמבר · המועד הרשמי 20.10',
    'purple',
  ],
];

export function TimelinePage() {
  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">ציר זמן</p>
          <h1>המועדים הבאים</h1>
          <p>מבט כרונולוגי פשוט על פעולות, תשלומים ותוקפים.</p>
        </div>
      </header>
      <section className="timeline">
        {events.map(([date, title, description, tone]) => (
          <article key={title}>
            <div className="timeline-date">{date}</div>
            <span className={`timeline-dot ${tone}`} />
            <div className="timeline-content">
              <h3>{title}</h3>
              <p>{description}</p>
              <button type="button">פרטים</button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
