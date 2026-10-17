/**
 * R5-09, stage 3 - the measurement that gates the cutover (migration 0050).
 *
 * Compares what the workspace snapshot holds with what the canonical table
 * holds, for one tenant: every saved National Insurance payment that carries
 * report lines must have a report in `national_insurance_report`, for the same
 * client, with the same due date and exactly the same lines. Anything else is
 * "unreconciled" - not copied yet, copied before a correction, refused by the
 * server, or belonging to a client with no canonical case. Stage 3's cutover
 * waits for zero.
 *
 * Pure on purpose: the nightly scan reads the two sides, and everything that
 * decides the answer is here, where a test can reach it.
 */

/** The workspace key of the periodic payments, with or without a client suffix. */
const EXPENSES_KEY = /^caredesk\.mvp\.employment-expenses\.v1(?:\.client\.(.+))?$/;

/**
 * The client an unsuffixed key belongs to - `LEGACY_UNSCOPED_CLIENT_ID` in
 * apps/web/src/canonical-case.ts, the value `employment_case.legacy_client_id`
 * carries for such a client (migration 0042).
 */
const UNSCOPED_CLIENT_ID = 'legacy:unscoped';

export interface ReportLine {
  month: string;
  employed: boolean;
  wage: number;
  ratePercent: number;
  amount: number;
}

export interface StoredReport {
  /** `employment_case.legacy_client_id` of the report's case. */
  legacyClientId: string | null;
  legacyExpenseId: string | null;
  dueDate: string;
  months: readonly ReportLine[];
}

export interface NationalInsuranceMeasurement {
  workspaceReports: number;
  unreconciledReports: number;
}

interface WorkspacePayment {
  clientId: string;
  id: string;
  dueDate: string;
  /** null where a stored line is malformed: it can never match, so it is never skipped. */
  lines: Array<ReportLine | null>;
}

function isLine(value: unknown): value is ReportLine {
  const line = value as Partial<ReportLine> | null;
  return (
    typeof line === 'object' &&
    line !== null &&
    typeof line.month === 'string' &&
    typeof line.employed === 'boolean' &&
    typeof line.wage === 'number' &&
    typeof line.ratePercent === 'number' &&
    typeof line.amount === 'number'
  );
}

/** Payments with report lines, from every client's expense list in the snapshot. */
function workspacePayments(entries: Record<string, string>): WorkspacePayment[] {
  const payments: WorkspacePayment[] = [];
  for (const [key, value] of Object.entries(entries)) {
    const match = EXPENSES_KEY.exec(key);
    if (!match) continue;
    const clientId = match[1] ?? UNSCOPED_CLIENT_ID;
    let list: unknown;
    try {
      list = JSON.parse(value);
    } catch {
      continue;
    }
    if (!Array.isArray(list)) continue;
    for (const item of list as Array<Record<string, unknown> | null>) {
      const lines = item?.nationalInsuranceMonths;
      if (!item || !Array.isArray(lines) || lines.length === 0) continue;
      payments.push({
        clientId,
        id: String(item.id ?? ''),
        dueDate: String(item.dueDate ?? ''),
        lines: lines.map((line: unknown) => (isLine(line) ? line : null)),
      });
    }
  }
  return payments;
}

const agorot = (shekels: number) => Math.round(shekels * 100);

function sameLine(left: ReportLine, right: ReportLine | undefined): boolean {
  return (
    right !== undefined &&
    left.employed === right.employed &&
    left.wage === right.wage &&
    agorot(left.ratePercent) === agorot(right.ratePercent) &&
    agorot(left.amount) === agorot(right.amount)
  );
}

function reconciled(payment: WorkspacePayment, report: StoredReport | undefined): boolean {
  if (!report || report.dueDate !== payment.dueDate) return false;
  if (report.months.length !== payment.lines.length) return false;
  const stored = new Map(report.months.map((line) => [line.month, line]));
  return payment.lines.every((line) => line !== null && sameLine(line, stored.get(line.month)));
}

export function measureNationalInsuranceReports(
  entries: Record<string, string>,
  reports: readonly StoredReport[],
): NationalInsuranceMeasurement {
  // Keyed by client AND payment: the automatic National Insurance payment's id
  // is built from the quarter alone (`expense-<schedule id>`, PayrollPage), so
  // two clients of one account can each hold a payment with the same id. A key
  // on the id alone could match one client's payment to the other's report and
  // count it as copied - a false zero, which is the one wrong answer this
  // measurement must never give.
  const key = (clientId: string, expenseId: string) => JSON.stringify([clientId, expenseId]);
  const byPayment = new Map<string, StoredReport>();
  for (const report of reports) {
    if (report.legacyClientId === null || report.legacyExpenseId === null) continue;
    byPayment.set(key(report.legacyClientId, report.legacyExpenseId), report);
  }
  const payments = workspacePayments(entries);
  return {
    workspaceReports: payments.length,
    unreconciledReports: payments.filter(
      (payment) => !reconciled(payment, byPayment.get(key(payment.clientId, payment.id))),
    ).length,
  };
}
