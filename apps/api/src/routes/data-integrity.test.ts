import { describe, expect, it } from 'vitest';
import { ScanForSilentDataLoss, type TenantCensus } from '@caredesk/application';
import {
  InMemoryTenantCensusRepository,
  LoggingDataLossAlertSink,
  SystemClock,
  UuidIdGenerator,
} from '@caredesk/infrastructure';
import { buildContainer } from '../container.js';
import { buildServer } from '../create-server.js';
import { loadEnv } from '../env.js';

const CRON_SECRET = 'test-cron-secret-at-least-24-characters';
const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const URL = '/internal/jobs/data-integrity-scan';

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

function buildScannerApp(options: { previous?: TenantCensus; today: TenantCensus }) {
  const env = loadEnv({ CRON_SECRET });
  const container = buildContainer(env);
  const repository = new InMemoryTenantCensusRepository();
  if (options.previous) repository.seedPrevious(options.previous);
  repository.seedObservations([options.today]);
  const emitted: string[] = [];
  container.scanForSilentDataLoss = new ScanForSilentDataLoss({
    census: repository,
    alerts: new LoggingDataLossAlertSink((line) => emitted.push(line)),
    audit: container.audit,
    clock: new SystemClock(),
    ids: new UuidIdGenerator(),
  });
  return { app: buildServer(env, container), emitted };
}

describe('GET /internal/jobs/data-integrity-scan', () => {
  it('refuses without the scheduler secret', async () => {
    const { app } = buildScannerApp({ today: census() });
    const response = await app.inject({ method: 'GET', url: URL });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
  });

  it('refuses a wrong secret', async () => {
    const { app } = buildScannerApp({ today: census() });
    const response = await app.inject({
      method: 'GET',
      url: URL,
      headers: { authorization: 'Bearer not-the-cron-secret-value-here' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('refuses when no secret is configured at all', async () => {
    // Without the explicit unset check, `Bearer undefined` would authenticate
    // an unconfigured deployment.
    const app = buildServer(loadEnv({}));
    const response = await app.inject({
      method: 'GET',
      url: URL,
      headers: { authorization: 'Bearer undefined' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('reports the tenant whose data collapsed overnight', async () => {
    const { app, emitted } = buildScannerApp({
      previous: census(),
      today: census({ workspacePopulatedEntries: 0, workspacePayloadBytes: 400, documentRows: 0 }),
    });

    const response = await app.inject({
      method: 'GET',
      url: URL,
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.tenantsScanned).toBe(1);
    const codes = body.signals.map((signal: { code: string }) => signal.code);
    expect(codes).toContain('WORKSPACE_BLANKED');
    expect(codes).toContain('TENANT_ROWS_COLLAPSED');
    // The alert line is the only thing that reaches outside the process today.
    expect(emitted.join('\n')).toContain('DATA_LOSS_SUSPECTED');
  });

  it('says nothing when nothing is wrong', async () => {
    const { app, emitted } = buildScannerApp({ previous: census(), today: census() });

    const response = await app.inject({
      method: 'GET',
      url: URL,
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().signals).toEqual([]);
    expect(emitted).toEqual([]);
  });

  it('keeps the signal free of anything that could identify a person', async () => {
    const { app, emitted } = buildScannerApp({
      previous: census(),
      today: census({ documentRows: 0 }),
    });
    await app.inject({
      method: 'GET',
      url: URL,
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });

    const line = emitted.join('\n');
    expect(line).toContain(TENANT_ID);
    expect(line).toMatch(/"before":6,"after":0/);
    expect(line).not.toMatch(/name|email|payload|storage/i);
  });
});
