import type { DataLossSignal } from '../data-loss-detection.js';

/**
 * Where a suspected loss goes once it is found.
 *
 * THE HONEST LIMIT, WRITTEN DOWN SO IT IS NOT MISTAKEN FOR A SOLVED PROBLEM:
 * this repository has no notification channel outside the application. There is
 * no Sentry, no PagerDuty, no email transport for operations, and no rota. The
 * only implementation that exists today writes a structured line to the process
 * log, which on Vercel means a human has to go and look. A detector nobody
 * reads is not detection - it is a smaller version of the same failure, where
 * the record exists and no one is told.
 *
 * The port exists so that closing that gap is one adapter and one line in the
 * container, not a rewrite. The transport this should get, in order of value:
 *   1. Email or SMS to the named production operator - the pilot has one
 *      customer and one operator, so a mailbox is a sufficient pager.
 *   2. An error-monitoring service, once one is chosen, so the signal joins
 *      the same queue as unhandled exceptions.
 * Until (1) exists, `docs/governance/RESTORE-DRILL.md` requires the operator to
 * read the scan output as a daily task, and that manual step is the control.
 */
export interface DataLossAlertSink {
  raise(signal: DataLossSignal): Promise<void>;
}
