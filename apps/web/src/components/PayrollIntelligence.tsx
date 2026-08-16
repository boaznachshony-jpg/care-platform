/* eslint-disable no-restricted-syntax -- legacy MVP Hebrew-first surface; localization extraction is tracked */
import { useEffect, useRef, useState } from 'react';
import { payrollIntelligence } from '../product-intelligence.js';
import {
  type MvpEmploymentExpense,
  type MvpMonthlyClose,
  type MvpPayrollRecord,
} from '../storage/mvp-storage.js';
import { closeCanonicalPayrollMonth, listCanonicalPayrollCloses } from '../api/client.js';

const money = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  maximumFractionDigits: 0,
});
export function PayrollIntelligence({
  records,
  expenses,
  baseSalary,
  caseId,
}: {
  records: MvpPayrollRecord[];
  expenses: MvpEmploymentExpense[];
  baseSalary: number | null;
  caseId?: string;
}) {
  const [closes, setCloses] = useState<MvpMonthlyClose[]>([]);
  const closeKey = useRef(crypto.randomUUID());
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState<'bank_transfer' | 'cash' | 'check' | 'other'>(
    'bank_transfer',
  );
  const year = new Date().getUTCFullYear().toString();
  const startMonth = new Date().toISOString().slice(0, 7);
  const refreshCloses = () => {
    if (!caseId) return Promise.resolve();
    return listCanonicalPayrollCloses(caseId).then((rows) =>
      setCloses(
        rows.map((row) => ({
          id: row.id,
          payrollRecordId: row.payrollReference,
          month: row.month,
          status: 'closed',
          paymentDate: row.paymentDate,
          paymentMethod: row.paymentMethod,
          closedAt: row.closedAt,
          workerAcknowledgement: 'not_supported',
        })),
      ),
    );
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void refreshCloses(), [caseId]);
  const { analytics, forecast } = payrollIntelligence(
    records,
    closes,
    expenses,
    year,
    startMonth,
    baseSalary,
  );
  const max = Math.max(...analytics.trend.map((record) => record.total), 1);
  const open = [...records]
    .sort((a, b) => b.month.localeCompare(a.month))
    .find((r) => !closes.some((c) => c.month === r.month));
  async function closeMonth() {
    if (!caseId || !open || !paymentDate || open.total <= 0) return;
    const deductions =
      (open.medicalInsuranceDeduction ?? 0) +
      (open.housingDeduction ?? 0) +
      open.advances +
      open.agreedDeduction;
    const actualBase = open.baseSalary;
    await closeCanonicalPayrollMonth(
      caseId,
      {
        payrollReference: open.id,
        month: open.month,
        paymentDate,
        paymentMethod,
        total: open.total,
        baseSalary: actualBase,
        additions: Math.max(0, open.total - actualBase + deductions),
        deductions,
      },
      closeKey.current,
    );
    await refreshCloses();
  }
  return (
    <>
      <section className="card payroll-intelligence" aria-labelledby="analytics-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">תובנות שכר</p>
            <h2 id="analytics-title">עלות ההעסקה לאורך זמן</h2>
          </div>
        </div>
        {analytics.trend.length === 0 ? (
          <p>עדיין אין נתוני שכר שמורים להצגה.</p>
        ) : (
          <>
            <div className="metric-grid">
              <div>
                <span>מצטבר מתחילת השנה</span>
                <strong>{money.format(analytics.total)}</strong>
              </div>
              <div>
                <span>ממוצע חודשי</span>
                <strong>{money.format(analytics.average)}</strong>
              </div>
              <div>
                <span>שינוי מהחודש הקודם</span>
                <strong>
                  {analytics.previousMonthChange === null
                    ? 'אין השוואה'
                    : money.format(analytics.previousMonthChange)}
                </strong>
              </div>
            </div>
            <div className="bar-chart" role="img" aria-label="מגמת עלות חודשית">
              <h3>מגמת עלות חודשית</h3>
              {analytics.trend.map((record) => (
                <div className="bar-row" key={record.month}>
                  <span aria-label={record.month}>{record.month.replace('-', ' / ')}</span>
                  <div>
                    <i style={{ width: `${Math.max(3, (record.total / max) * 100)}%` }} />
                  </div>
                  <strong>{money.format(record.total)}</strong>
                  <small>{record.closed ? 'סגור ✓' : 'פתוח !'}</small>
                </div>
              ))}
            </div>
            <details>
              <summary>הרכב עלות ומצטבר — חלופה טקסטואלית לתרשים</summary>
              <table>
                <thead>
                  <tr>
                    <th>חודש</th>
                    <th>בסיס</th>
                    <th>תוספות</th>
                    <th>קיזוזים</th>
                    <th>סה״כ</th>
                    <th>מצטבר</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.trend.map((r) => (
                    <tr key={r.month}>
                      <td aria-label={r.month}>{r.month.replace('-', ' / ')}</td>
                      <td>{money.format(r.baseSalary)}</td>
                      <td>{money.format(r.additions)}</td>
                      <td>{money.format(r.deductions)}</td>
                      <td>{money.format(r.total)}</td>
                      <td>{money.format(r.cumulative)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
      </section>
      <section className="card forecast-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">הערכה בלבד</p>
            <h2>תחזית 12 חודשים</h2>
            <p>
              התחזית חוזרת רק על שכר בסיס והוצאות חודשיות שהוזנו. היא אינה ייעוץ פיננסי ואינה מניחה
              שיעורים או זכויות עתידיים.
            </p>
          </div>
        </div>
        <div className="metric-grid">
          <div>
            <span>סה״כ מוערך</span>
            <strong>{money.format(forecast.total)}</strong>
          </div>
          <div>
            <span>ממוצע צפוי</span>
            <strong>{money.format(forecast.average)}</strong>
          </div>
          <div>
            <span>שלושת החודשים הקרובים</span>
            <strong>{money.format(forecast.next3MonthsTotal)}</strong>
          </div>
          <div>
            <span>מומלץ לשמור בצד בכל חודש</span>
            <strong>{money.format(forecast.reserveRecommendation)}</strong>
            <small>הכוונת תכנון בלבד — לא ייעוץ פיננסי</small>
          </div>
        </div>
        {forecast.assumptions.length ? (
          <details>
            <summary>הנחות התחזית</summary>
            <ul>
              {forecast.assumptions.map((a) => (
                <li key={a.id}>
                  {a.label}: {money.format(a.amount)}
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <p>אין די נתונים ליצירת תחזית. לא נוספו סכומים משוערים.</p>
        )}
        <div className="forecast-strip" aria-label="תחזית חודשית">
          {forecast.months.map((m) => (
            <details key={m.month}>
              <summary>
                <small>{m.month}</small> <strong>{money.format(m.total)}</strong>{' '}
                <span>{m.status === 'ACTUAL' ? 'בפועל' : 'תחזית'}</span>
              </summary>
              <ul>
                {m.components.map((component) => (
                  <li key={component.id}>
                    <strong>{component.label}</strong> —{' '}
                    {component.amount === null ? 'לא ידוע' : money.format(component.amount)}
                    <small>
                      {' '}
                      · {component.explanation} · {component.status}
                    </small>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </section>
      <section className="card monthly-close" id="monthly-close">
        <div className="section-heading">
          <div>
            <p className="eyebrow">סגירת חודש</p>
            <h2>{open ? `סגירת ${open.month}` : 'כל החודשים הושלמו'}</h2>
          </div>
        </div>
        {open ? (
          <>
            <p>
              רישום השכר נשמר. בדקו את ימי העבודה, ההיעדרויות, התוספות והקיזוזים ברישום לעיל לפני
              הסגירה.
            </p>
            <div className="form-grid">
              <label>
                תאריך תשלום
                <input
                  type="date"
                  required
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                />
              </label>
              <label>
                אמצעי תשלום
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}
                >
                  <option value="bank_transfer">העברה בנקאית</option>
                  <option value="cash">מזומן</option>
                  <option value="check">המחאה</option>
                  <option value="other">אחר</option>
                </select>
              </label>
            </div>
            <p>
              סכום ששמור לתשלום: <strong>{money.format(open.total)}</strong>
            </p>
            <button
              className="primary-button"
              type="button"
              disabled={!paymentDate || open.total <= 0}
              onClick={() => void closeMonth()}
            >
              אישור שהחודש מוכן וסגירה
            </button>
            <small>אישור עובד אינו נתמך עדיין ולא יירשם כאילו התקבל.</small>
          </>
        ) : (
          <p className="success-box">אין חודש שכר שמור שממתין לסגירה.</p>
        )}
        <h3>היסטוריית סגירות</h3>
        {closes.length ? (
          <ul>
            {[...closes]
              .sort((a, b) => b.month.localeCompare(a.month))
              .map((c) => (
                <li key={c.id}>
                  {c.month} — הושלם · שולם {c.paymentDate}
                </li>
              ))}
          </ul>
        ) : (
          <p>עדיין לא נסגרו חודשים.</p>
        )}
      </section>
    </>
  );
}
