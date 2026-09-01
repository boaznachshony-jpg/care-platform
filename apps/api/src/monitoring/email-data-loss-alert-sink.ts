import type { DataLossAlertSink, DataLossSignal } from '@caredesk/application';

/**
 * The destination the port was written for: a signal that reaches a person.
 *
 * WHY THIS EXISTS
 * ---------------
 * `LoggingDataLossAlertSink` writes one structured line per signal and stops
 * there. On Vercel that means a human has to open the function logs and look,
 * and `RESTORE-DRILL.md` therefore names "read the scan output daily" as the
 * control. A control that depends on someone remembering to look is the same
 * failure in a smaller box: the record exists and nobody is told.
 *
 * The pilot has one customer and one operator, so a mailbox is a sufficient
 * pager. Resend is already the only email boundary in the product, so this adds
 * a destination, not a dependency.
 *
 * WHY IT WRAPS RATHER THAN REPLACES
 * ---------------------------------
 * The log line stays, always, and is written FIRST. The log is the durable
 * record and the thing `DATA_LOSS_SUSPECTED` greps for; email is delivery, and
 * delivery is the part that fails. If this class replaced the log, an outage at
 * Resend would erase the evidence as well as the notification.
 *
 * WHY A FAILED SEND IS LOUD BUT NOT THROWN
 * ----------------------------------------
 * This runs inside the daily scan job. Throwing would abort the scan and leave
 * later tenants unmeasured — a delivery problem would become a detection
 * problem. So a failure is swallowed for control flow and shouted in the log
 * under its own token, `DATA_LOSS_ALERT_UNDELIVERED`, because "we detected it
 * and could not tell you" is itself an operational event and must not be the
 * quiet path.
 *
 * WHAT THE EMAIL CONTAINS
 * -----------------------
 * A tenant id, a measure name, and two numbers — exactly what the log line
 * carries. No customer name, no payload, no storage key, no decrypted value.
 * The mailbox is outside the product's privacy boundary and is treated as such.
 * The email says what to do next, because an alert that does not name the next
 * action gets read once and then filtered.
 */

export interface DataLossAlertMailer {
  send(message: {
    to: string;
    subject: string;
    text: string;
  }): Promise<{ status: 'accepted' | 'failed'; failureCategory?: string }>;
}

/** Human-readable meaning per code. The reader is an operator, not the author. */
const CODE_MEANING: Record<DataLossSignal['code'], string> = {
  WORKSPACE_ROW_MISSING: 'The tenant has history but no live workspace row.',
  WORKSPACE_UNREADABLE: 'The workspace row exists and the encryption key no longer opens it.',
  WORKSPACE_BLANKED: 'Every value in the workspace is blank while the keys remain.',
  WORKSPACE_SHRANK: 'Populated entries or stored bytes fell materially since the last census.',
  TENANT_ROWS_COLLAPSED: 'A canonical table lost a material share of this tenant rows.',
};

export class EmailDataLossAlertSink implements DataLossAlertSink {
  constructor(
    private readonly mailer: DataLossAlertMailer,
    private readonly destination: string,
    /**
     * Injected so the log half is testable and so this class never owns the
     * decision of where the durable record goes.
     */
    private readonly emit: (line: string) => void = (line) => console.error(line),
  ) {}

  async raise(signal: DataLossSignal): Promise<void> {
    // First, always, and independent of delivery.
    const record = {
      code: signal.code,
      tenantId: signal.tenantId,
      measure: signal.measure,
      before: signal.before,
      after: signal.after,
    };
    this.emit(`DATA_LOSS_SUSPECTED ${JSON.stringify(record)}`);

    let outcome: { status: 'accepted' | 'failed'; failureCategory?: string };
    try {
      outcome = await this.mailer.send({
        to: this.destination,
        subject: `CareDesk — suspected data loss (${signal.code})`,
        text: this.body(signal),
      });
    } catch (error) {
      // A transport that throws is a failed delivery, not a failed scan.
      outcome = {
        status: 'failed',
        failureCategory: error instanceof Error ? error.name : 'unknown',
      };
    }

    if (outcome.status !== 'accepted') {
      this.emit(
        `DATA_LOSS_ALERT_UNDELIVERED ${JSON.stringify({
          ...record,
          failureCategory: outcome.failureCategory ?? 'unknown',
        })}`,
      );
    }
  }

  private body(signal: DataLossSignal): string {
    const movement =
      signal.before === null && signal.after === null
        ? 'No comparable measurement was recorded.'
        : `${signal.measure}: ${signal.before ?? 'unknown'} → ${signal.after ?? 'unknown'}`;
    return [
      'The daily data-integrity scan raised a signal.',
      '',
      `Signal:  ${signal.code}`,
      `Meaning: ${CODE_MEANING[signal.code]}`,
      `Tenant:  ${signal.tenantId}`,
      `Change:  ${movement}`,
      '',
      'This is a suspicion, not a confirmed loss. The scan is deliberately more',
      'sensitive than the write-time guard, because detection that waits for',
      'certainty arrives after the seven-day backup window has closed.',
      '',
      'What to do next:',
      '  1. Open docs/governance/RESTORE-DRILL.md.',
      '  2. Compare the tenant against yesterday, per section B.1.',
      '  3. If the drop is real, restore from tenant_workspace_history BEFORE',
      '     the seven-day window closes. Point-in-time recovery is not enabled,',
      '     so a loss older than seven days cannot be recovered by any means.',
      '',
      'No customer data appears in this message by design.',
    ].join('\n');
  }
}
