import { describe, expect, it } from 'vitest';
import type { DataLossSignal } from '../data-loss-detection.js';
import type { AuditEventInput, AuditService } from '../ports/audit-service.js';
import type { DataLossAlertSink } from '../ports/data-loss-alert-sink.js';
import type { TenantCensus, TenantCensusRepository } from '../ports/tenant-census-repository.js';
import { ScanForSilentDataLoss } from './scan-for-data-loss.js';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const OTHER_TENANT_ID = '10000000-0000-4000-8000-000000000002';

function census(overrides: Partial<TenantCensus> = {}): TenantCensus {
  return {
    tenantId: TENANT_ID,
    observedAt: '2026-08-30T03:42:00.000Z',
    workspaceVersion: 12,
    workspacePayloadBytes: 17_000,
    workspacePopulatedEntries: 29,
    workspaceReadable: true,
    workspaceHistoryVersions: 11,
    workspaceFileRows: 4,
    documentRows: 6,
    taskRows: 12,
    employmentCaseRows: 1,
    payrollEntryRows: 8,
    ...overrides,
  };
}

class FakeCensusRepository implements TenantCensusRepository {
  readonly recorded: TenantCensus[] = [];
  readonly comparedAgainst: (TenantCensus | null)[] = [];

  constructor(
    private readonly observations: TenantCensus[],
    private readonly previous: TenantCensus[] = [],
  ) {}

  async collect() {
    return this.observations;
  }

  async findPrevious(tenantId: string) {
    // Reads the seeded baseline and whatever this run has already written, so
    // a scan that records before comparing shows up as comparing a tenant
    // against itself.
    const rows = [...this.previous, ...this.recorded].filter((row) => row.tenantId === tenantId);
    this.comparedAgainst.push(rows[rows.length - 1] ?? null);
    return rows[rows.length - 1] ?? null;
  }

  async record(row: TenantCensus) {
    this.recorded.push(row);
  }
}

class RecordingAudit implements AuditService {
  readonly events: AuditEventInput[] = [];
  async record(event: AuditEventInput) {
    this.events.push(event);
  }
}

class RecordingAlerts implements DataLossAlertSink {
  readonly raised: DataLossSignal[] = [];
  async raise(signal: DataLossSignal) {
    this.raised.push(signal);
  }
}

function build(
  repository: TenantCensusRepository,
  alerts: DataLossAlertSink = new RecordingAlerts(),
) {
  const audit = new RecordingAudit();
  const scan = new ScanForSilentDataLoss({
    census: repository,
    alerts,
    audit,
    clock: { now: () => new Date('2026-08-30T03:42:00.000Z') },
    ids: { next: () => 'correlation-1' },
  });
  return { scan, audit, alerts };
}

describe('ScanForSilentDataLoss', () => {
  it('raises an alert and an audit record when a tenant collapses', async () => {
    const repository = new FakeCensusRepository(
      [census({ documentRows: 0, taskRows: 0 })],
      [census()],
    );
    const alerts = new RecordingAlerts();
    const { scan, audit } = build(repository, alerts);

    const result = await scan.execute();

    expect(result.tenantsScanned).toBe(1);
    expect(alerts.raised.map((signal) => signal.measure)).toEqual(['document_rows', 'task_rows']);
    expect(audit.events).toHaveLength(2);
    expect(audit.events[0]).toMatchObject({
      tenantId: TENANT_ID,
      // No human ran this. The audit table's actor_id is nullable for exactly
      // this case and an invented actor would be a false statement of fact.
      actorId: null,
      action: 'integrity.data_loss_suspected',
      resourceType: 'tenant',
    });
  });

  it('compares against the previous census before writing the new one', async () => {
    // If the write came first, the second night would compare a collapsed
    // tenant against its own collapsed state and report nothing wrong - the
    // way a monitor silently adopts a disaster as its new baseline.
    const repository = new FakeCensusRepository([census({ documentRows: 0 })], [census()]);
    const { scan } = build(repository);

    await scan.execute();

    expect(repository.comparedAgainst[0]).toMatchObject({ documentRows: 6 });
    expect(repository.recorded).toHaveLength(1);
  });

  it('records the census for a healthy tenant so tomorrow has a baseline', async () => {
    const repository = new FakeCensusRepository([census()]);
    const { scan, audit } = build(repository);

    const result = await scan.execute();

    expect(result.signals).toEqual([]);
    expect(audit.events).toEqual([]);
    expect(repository.recorded).toHaveLength(1);
  });

  it('keeps scanning the remaining tenants when the alert transport fails', async () => {
    // The tenant whose alert throws is the tenant in trouble. Letting that end
    // the scan would mean the worst incident is also the one that hides the
    // others.
    const failing: DataLossAlertSink = {
      async raise() {
        throw new Error('no alert transport configured');
      },
    };
    const repository = new FakeCensusRepository(
      [census({ documentRows: 0 }), census({ tenantId: OTHER_TENANT_ID, documentRows: 0 })],
      [census(), census({ tenantId: OTHER_TENANT_ID })],
    );
    const { scan, audit } = build(repository, failing);

    const result = await scan.execute();

    expect(result.signals).toHaveLength(2);
    expect(audit.events).toHaveLength(2);
    expect(repository.recorded).toHaveLength(2);
  });

  it('stamps every observation with one scan time rather than per-tenant clocks', async () => {
    const repository = new FakeCensusRepository([
      census({ observedAt: 'stale' }),
      census({ tenantId: OTHER_TENANT_ID, observedAt: 'stale' }),
    ]);
    const { scan } = build(repository);

    const result = await scan.execute();

    expect(repository.recorded.map((row) => row.observedAt)).toEqual([
      result.scannedAt,
      result.scannedAt,
    ]);
  });
});
