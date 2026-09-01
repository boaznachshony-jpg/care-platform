import { describe, expect, it } from 'vitest';
import type { DataLossSignal } from '@caredesk/application';
import { EmailDataLossAlertSink, type DataLossAlertMailer } from './email-data-loss-alert-sink.js';

/**
 * The point of this sink is that a human hears about it. So the tests are about
 * two things only: that the message leaves, and that failing to send is itself
 * shouted rather than swallowed. A detector nobody is told about is the bug
 * being closed; a delivery failure nobody is told about is the same bug wearing
 * a different hat.
 */

const SIGNAL: DataLossSignal = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  code: 'WORKSPACE_BLANKED',
  measure: 'populatedEntries',
  before: 42,
  after: 0,
};

function mailer(result: { status: 'accepted' | 'failed'; failureCategory?: string }) {
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const impl: DataLossAlertMailer = {
    async send(message) {
      sent.push(message);
      return result;
    },
  };
  return { impl, sent };
}

function capture() {
  const lines: string[] = [];
  return { lines, emit: (line: string) => lines.push(line) };
}

describe('EmailDataLossAlertSink', () => {
  it('emails the operator when a signal is raised', async () => {
    const { impl, sent } = mailer({ status: 'accepted' });
    const log = capture();
    await new EmailDataLossAlertSink(impl, 'ops@caredesk-isr.com', log.emit).raise(SIGNAL);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('ops@caredesk-isr.com');
    expect(sent[0]!.subject).toContain('WORKSPACE_BLANKED');
  });

  it('writes the durable log line as well as sending, and writes it first', async () => {
    // Resend being up must never be what decides whether the finding was
    // recorded. The log is the record; the email is delivery.
    const { impl } = mailer({ status: 'accepted' });
    const log = capture();
    await new EmailDataLossAlertSink(impl, 'ops@caredesk-isr.com', log.emit).raise(SIGNAL);

    expect(log.lines[0]).toContain('DATA_LOSS_SUSPECTED');
    expect(log.lines[0]).toContain(SIGNAL.tenantId);
  });

  it('explains what the signal means and what to do next', async () => {
    const { impl, sent } = mailer({ status: 'accepted' });
    await new EmailDataLossAlertSink(impl, 'ops@caredesk-isr.com', capture().emit).raise(SIGNAL);

    const body = sent[0]!.text;
    expect(body).toContain('blank');
    expect(body).toContain('RESTORE-DRILL.md');
    // The seven-day cliff is the one fact that changes how fast someone moves.
    expect(body).toContain('seven days');
  });

  it('reports the measurement without any customer data', async () => {
    const { impl, sent } = mailer({ status: 'accepted' });
    await new EmailDataLossAlertSink(impl, 'ops@caredesk-isr.com', capture().emit).raise(SIGNAL);

    const body = sent[0]!.text;
    expect(body).toContain('populatedEntries: 42 → 0');
    expect(body).toContain(SIGNAL.tenantId);
  });

  it('shouts when the alert could not be delivered', async () => {
    const { impl } = mailer({ status: 'failed', failureCategory: 'provider_rejected' });
    const log = capture();
    await new EmailDataLossAlertSink(impl, 'ops@caredesk-isr.com', log.emit).raise(SIGNAL);

    expect(log.lines.some((line) => line.startsWith('DATA_LOSS_ALERT_UNDELIVERED'))).toBe(true);
    expect(log.lines.join('\n')).toContain('provider_rejected');
  });

  it('does not throw when the transport throws', async () => {
    // This runs inside the daily scan. A delivery problem must not become a
    // detection problem by aborting the loop before later tenants are measured.
    const throwing: DataLossAlertMailer = {
      async send() {
        throw new Error('socket hang up');
      },
    };
    const log = capture();
    await expect(
      new EmailDataLossAlertSink(throwing, 'ops@caredesk-isr.com', log.emit).raise(SIGNAL),
    ).resolves.toBeUndefined();

    expect(log.lines[0]).toContain('DATA_LOSS_SUSPECTED');
    expect(log.lines.some((line) => line.startsWith('DATA_LOSS_ALERT_UNDELIVERED'))).toBe(true);
  });

  it('says so plainly when nothing was comparable', async () => {
    const { impl, sent } = mailer({ status: 'accepted' });
    await new EmailDataLossAlertSink(impl, 'ops@caredesk-isr.com', capture().emit).raise({
      ...SIGNAL,
      code: 'WORKSPACE_ROW_MISSING',
      before: null,
      after: null,
    });

    expect(sent[0]!.text).toContain('No comparable measurement was recorded.');
  });
});
