import { describe, expect, it } from 'vitest';
import { detectDataLoss, isMaterialDrop } from './data-loss-detection.js';
import type { TenantCensus } from './ports/tenant-census-repository.js';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';

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

describe('isMaterialDrop', () => {
  it('treats everything going to zero as material even for a single row', () => {
    expect(isMaterialDrop(1, 0)).toBe(true);
  });

  it('ignores ordinary editing that removes a couple of items', () => {
    expect(isMaterialDrop(12, 10)).toBe(false);
  });

  it('fires once more than a quarter is gone', () => {
    expect(isMaterialDrop(12, 9)).toBe(false);
    expect(isMaterialDrop(12, 8)).toBe(true);
  });

  it('never fires on growth or on a tenant that had nothing', () => {
    expect(isMaterialDrop(5, 9)).toBe(false);
    expect(isMaterialDrop(0, 0)).toBe(false);
  });
});

describe('detectDataLoss', () => {
  it('reports the 2026-08-29 incident: a populated workspace replaced by blanks', () => {
    // The client published a snapshot of empty strings, the version check waved
    // it through, and nobody was told. This is the shape that must not be
    // silent again.
    const yesterday = census();
    const today = census({
      workspaceVersion: 13,
      workspacePopulatedEntries: 0,
      workspacePayloadBytes: 400,
      workspaceHistoryVersions: 12,
    });

    const codes = detectDataLoss(yesterday, today).map((signal) => signal.code);
    expect(codes).toContain('WORKSPACE_BLANKED');
    expect(codes).toContain('WORKSPACE_SHRANK');
  });

  it('reports a blanked workspace on the very first run, with no previous census', () => {
    // History proves the workspace once held something, so the detector does
    // not need a baseline to know this is wrong.
    const signals = detectDataLoss(null, census({ workspacePopulatedEntries: 0 }));
    expect(signals.map((signal) => signal.code)).toContain('WORKSPACE_BLANKED');
  });

  it('reports a workspace row that has disappeared while its history remains', () => {
    const signals = detectDataLoss(
      census(),
      census({
        workspaceVersion: null,
        workspacePayloadBytes: null,
        workspacePopulatedEntries: null,
      }),
    );
    expect(signals.map((signal) => signal.code)).toContain('WORKSPACE_ROW_MISSING');
  });

  it('reports an unreadable payload as the encryption-key alarm it is', () => {
    const signals = detectDataLoss(
      census(),
      census({ workspacePopulatedEntries: null, workspaceReadable: false }),
    );
    expect(signals.map((signal) => signal.code)).toContain('WORKSPACE_UNREADABLE');
  });

  it('detects a byte collapse even when the entry count cannot be read', () => {
    // The measure that survives losing the encryption key: AES-GCM preserves
    // plaintext length, so ciphertext size still tracks content size.
    const signals = detectDataLoss(
      census(),
      census({
        workspacePayloadBytes: 300,
        workspacePopulatedEntries: null,
        workspaceReadable: false,
      }),
    );
    const shrink = signals.find((signal) => signal.code === 'WORKSPACE_SHRANK');
    expect(shrink).toMatchObject({
      measure: 'workspace_payload_bytes',
      before: 17_000,
      after: 300,
    });
  });

  it('reports a canonical table collapsing, naming the measure', () => {
    const signals = detectDataLoss(census(), census({ documentRows: 0 }));
    expect(signals).toContainEqual({
      tenantId: TENANT_ID,
      code: 'TENANT_ROWS_COLLAPSED',
      measure: 'document_rows',
      before: 6,
      after: 0,
    });
  });

  it('stays silent on an unchanged tenant', () => {
    expect(detectDataLoss(census(), census())).toEqual([]);
  });

  it('stays silent on ordinary use: one case closed, a few tasks done and removed', () => {
    // The detector is worthless if it cries every morning. A tenant deleting
    // two tasks out of twelve and one document out of six must not page anyone.
    expect(detectDataLoss(census(), census({ taskRows: 10, documentRows: 5 }))).toEqual([]);
  });

  it('stays silent on a brand-new tenant that has never saved', () => {
    const empty = census({
      workspaceVersion: null,
      workspacePayloadBytes: null,
      workspacePopulatedEntries: null,
      workspaceHistoryVersions: 0,
      workspaceFileRows: 0,
      documentRows: 0,
      taskRows: 0,
      employmentCaseRows: 0,
      payrollEntryRows: 0,
    });
    expect(detectDataLoss(null, empty)).toEqual([]);
  });
});
