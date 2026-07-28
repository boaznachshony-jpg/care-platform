import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

export function DashboardPage() {
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => { fetch(`${API_BASE_URL}/health`).then(r => setOnline(r.ok)).catch(() => setOnline(false)); }, []);
  return <div className="page-stack">
    <section className="hero-row"><div><p className="eyebrow">מרכז הבקרה האישי</p><h1>הכול נראה תקין</h1><p>יש פעולה אחת מומלצת השבוע. שאר הנושאים מעודכנים.</p></div><div className={`connection ${online === false ? 'warn' : ''}`}><span></span>{online === null ? 'בודק חיבור' : online ? 'המערכת מחוברת' : 'מצב הדגמה'}</div></section>
    <section className="status-card good"><div className="status-icon">✓</div><div><span>סטטוס כללי</span><h2>ההעסקה מנוהלת היטב</h2><p>השכר שולם, המסמכים בתוקף ואין מועד דחוף ב־7 הימים הקרובים.</p></div><Link className="text-link" to="/timeline">לכל המועדים ←</Link></section>
    <div className="dashboard-grid">
      <section className="card next-action"><div className="section-heading"><div><span>הפעולה הבאה</span><h2>בדיקת תוקף ביטוח רפואי</h2></div><span className="pill amber">בעוד 6 ימים</span></div><p>כדאי לוודא שהפוליסה לשנה הבאה הוזמנה. ניתן לסמן כבוצע או לצרף מסמך.</p><div className="button-row"><button className="primary-button">סמן כבוצע</button><Link className="secondary-button" to="/documents">פתח מסמכים</Link></div></section>
      <section className="card summary-card"><div className="section-heading"><h2>תמונת מצב</h2><span>יולי 2026</span></div><div className="metric-list"><div><span className="metric-icon green">✓</span><div><strong>שכר חודשי</strong><small>שולם ב־09.07.2026</small></div></div><div><span className="metric-icon blue">4</span><div><strong>משימות פעילות</strong><small>אחת מומלצת השבוע</small></div></div><div><span className="metric-icon purple">7</span><div><strong>מסמכים שמורים</strong><small>כולם נגישים ומסודרים</small></div></div></div></section>
    </div>
    <section><div className="section-title-row"><div><span>משימות</span><h2>מה דורש תשומת לב</h2></div><Link to="/tasks">לכל המשימות</Link></div><div className="task-grid"><article className="task-card"><span className="task-date">3 באוגוסט</span><h3>בדיקת ביטוח רפואי</h3><p>וודא שהפוליסה הבאה מוכנה לפני החידוש.</p><div><span className="pill amber">מומלץ</span><button>סמן כבוצע</button></div></article><article className="task-card"><span className="task-date">10 באוגוסט</span><h3>הכנת תשלום שכר</h3><p>בדיקת רכיבי השכר והכנת אישור תשלום.</p><div><span className="pill neutral">רגיל</span><button>פתח</button></div></article><article className="task-card done"><span className="task-date">בוצע</span><h3>תשלום ביטוח לאומי</h3><p>התשלום לרבעון הנוכחי תועד במערכת.</p><div><span className="pill green">הושלם</span><button>פרטים</button></div></article></div></section>
    <section><div className="section-title-row"><div><span>תאריכים קרובים</span><h2>להמשך החודש</h2></div><Link to="/timeline">פתח ציר זמן</Link></div><div className="date-strip"><div><strong>03</strong><span>אוג׳</span><p>ביטוח רפואי</p></div><div><strong>09</strong><span>אוג׳</span><p>הכנת שכר</p></div><div><strong>15</strong><span>אוג׳</span><p>יום חופשה</p></div><div><strong>31</strong><span>אוג׳</span><p>סיכום חודש</p></div></div></section>
  </div>;
}
