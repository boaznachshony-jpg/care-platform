import { detectDataLoss, type DataLossSignal } from '../data-loss-detection.js';
import type { AuditService } from '../ports/audit-service.js';
import type { Clock } from '../ports/clock.js';
import type { DataLossAlertSink } from '../ports/data-loss-alert-sink.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { TenantCensus, TenantCensusRepository } from '../ports/tenant-census-repository.js';

export interface DataLossScanResult {
  scannedAt: string;
  tenantsScanned: number;
  signals: DataLossSignal[];
}

interface ScanDeps {
  census: TenantCensusRepository;
  alerts: DataLossAlertSink;
  audit: AuditService;
  clock: Clock;
  ids: IdGenerator;
}

/**
 * The nightly question nobody was asking: is anyone's data smaller than it was?
 *
 * There is no actor. This runs from the scheduler, which is why every audit row
 * it writes carries a null `actorId` - the column is nullable for exactly this
 * case (see AuditEventInput).
 *
 * Ordering inside the loop matters. The census is compared against the previous
 * one and only then stored, so a tenant that lost data yesterday is measured
 * against the healthy figure rather than against its own collapsed state. If
 * the write came first, the second night's run would compare empty to empty and
 * report nothing wrong - the classic way a monitor learns to accept a disaster
 * as the new baseline.
 *
 * A failure on one tenant must not end the scan. The tenant most likely to
 * throw - unreadable payload, missing row - is the tenant most likely to be the
 * one in trouble.
 */
export class ScanForSilentDataLoss {
  constructor(private readonly deps: ScanDeps) {}

  async execute(): Promise<DataLossScanResult> {
    const scannedAt = this.deps.clock.now().toISOString();
    const observations = await this.deps.census.collect();
    const signals: DataLossSignal[] = [];

    for (const observation of observations) {
      const current: TenantCensus = { ...observation, observedAt: scannedAt };
      const previous = await this.deps.census.findPrevious(current.tenantId);
      const found = detectDataLoss(previous, current);
      for (const signal of found) {
        signals.push(signal);
        await this.raise(signal, scannedAt);
      }
      await this.deps.census.record(current);
    }

    return { scannedAt, tenantsScanned: observations.length, signals };
  }

  private async raise(signal: DataLossSignal, occurredAt: string): Promise<void> {
    // The alert is attempted first and independently of the audit write. They
    // fail for different reasons, and losing the audit row must not also lose
    // the only thing that reaches a person.
    try {
      await this.deps.alerts.raise(signal);
    } catch {
      // Swallowed on purpose: an alert transport that is down cannot be allowed
      // to abort the scan of the remaining tenants.
    }
    try {
      await this.deps.audit.record({
        tenantId: signal.tenantId,
        actorId: null,
        action: 'integrity.data_loss_suspected',
        resourceType: 'tenant',
        resourceId: signal.tenantId,
        correlationId: this.deps.ids.next(),
        occurredAt,
        // Counts only. The audit table's length caps and privacy contract
        // (0009) forbid anything richer, and nothing richer is needed to decide
        // whether to open an incident.
        changeSummary: `${signal.code}: ${signal.measure} moved from ${signal.before ?? 'none'} to ${signal.after ?? 'none'}.`,
        sensitivity: 'general',
      });
    } catch {
      // Same reasoning as authorizeOrThrow: the finding still stands, and a
      // missing audit row is not worth losing the rest of the scan over.
    }
  }
}
