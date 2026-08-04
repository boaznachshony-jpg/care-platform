/* eslint-disable no-restricted-syntax */
import { Link } from 'react-router-dom';
import { createQuarterlyInsuranceTask } from '../quarterly-national-insurance.js';
import { useClientPath } from '../hooks/use-client-path.js';
import { useMvpProfile } from '../hooks/use-mvp-profile.js';

type TimelineEvent = [
  date: string,
  title: string,
  description: string,
  tone: string,
  detailsPath: string,
];

const fixedEvents: TimelineEvent[] = [
  ['09 אוג׳', 'הכנת שכר יולי', 'פעולה חודשית', 'blue', '/payroll'],
  ['15 אוג׳', 'יום חופשה מתוכנן', 'מידע', 'green', '/tasks'],
  ['31 אוג׳', 'סיכום חודש', 'בדיקה אוטומטית', 'neutral', '/'],
];

const shortMonths = [
  'ינו׳',
  'פבר׳',
  'מרץ',
  'אפר׳',
  'מאי',
  'יוני',
  'יולי',
  'אוג׳',
  'ספט׳',
  'אוק׳',
  'נוב׳',
  'דצמ׳',
];

function shortDate(value: string): string {
  const [, month, day] = value.split('-').map(Number);
  return `${day} ${shortMonths[(month ?? 1) - 1]}`;
}

export function TimelinePage({
  today,
  employmentStartDate,
}: { today?: Date; employmentStartDate?: string } = {}) {
  const path = useClientPath();
  const [profile] = useMvpProfile();
  const effectiveEmploymentStartDate = employmentStartDate ?? profile.employmentStartDate;
  const quarterlyInsurance = createQuarterlyInsuranceTask(today);
  const events: TimelineEvent[] = [
    ...(effectiveEmploymentStartDate
      ? ([
          [
            shortDate(effectiveEmploymentStartDate),
            'בדיקת ביטוח רפואי',
            'החל ממועד תחילת ההעסקה',
            'amber',
            '/documents',
          ],
        ] satisfies TimelineEvent[])
      : []),
    ...fixedEvents,
    [
      shortDate(
        quarterlyInsurance.preparationOnly
          ? quarterlyInsurance.periodEnd
          : quarterlyInsurance.deadlineDate,
      ),
      quarterlyInsurance.title,
      `${quarterlyInsurance.paymentWindow} · ${quarterlyInsurance.statusLabel}`,
      quarterlyInsurance.status === 'overdue' ? 'amber' : 'purple',
      '/tasks',
    ],
  ];

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
        {events.map(([date, title, description, tone, detailsPath]) => (
          <article key={title}>
            <div className="timeline-date">{date}</div>
            <span className={`timeline-dot ${tone}`} />
            <div className="timeline-content">
              <h3>{title}</h3>
              <p>{description}</p>
              <Link to={path(detailsPath)}>פרטים</Link>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
