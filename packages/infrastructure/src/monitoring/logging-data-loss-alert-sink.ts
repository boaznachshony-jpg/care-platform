import type { DataLossAlertSink, DataLossSignal } from '@caredesk/application';

/**
 * The only alert transport that exists today: one structured line per signal.
 *
 * This is not a monitoring system and must not be counted as one. There is no
 * paging, no delivery guarantee, no acknowledgement, and no one is subscribed.
 * On Vercel it means a human has to open the function logs and look. The value
 * it does have is real but narrow: the finding is now written down, in a
 * greppable shape, at the moment it is found, instead of being discovered by
 * the customer days later.
 *
 * `DATA_LOSS_SUSPECTED` is the token to alert on when a real destination
 * arrives. The line carries a tenant id and numbers only - no names, no
 * payload, no storage keys - because it goes to a log aggregator that is not
 * inside the product's privacy boundary.
 */
export class LoggingDataLossAlertSink implements DataLossAlertSink {
  constructor(
    // Injectable so a test can assert what was raised, and so the day a real
    // destination exists it replaces one argument rather than this class.
    private readonly emit: (line: string) => void = (line) => console.error(line),
  ) {}

  async raise(signal: DataLossSignal): Promise<void> {
    this.emit(
      `DATA_LOSS_SUSPECTED ${JSON.stringify({
        code: signal.code,
        tenantId: signal.tenantId,
        measure: signal.measure,
        before: signal.before,
        after: signal.after,
      })}`,
    );
  }
}
