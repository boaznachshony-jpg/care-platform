import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearUploadMarkerForTests,
  getUploadedServerId,
  rememberUploadedServerId,
  uploadUnsyncedRecords,
} from './legacy-upload.js';

const CASE_ID = 'case-demo-001';

describe('legacy-upload', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('imports every record on the first pass', async () => {
    const importOne = vi
      .fn()
      .mockImplementation((record: { id: string }) =>
        Promise.resolve({ id: `server-${record.id}` }),
      );

    const outcome = await uploadUnsyncedRecords(
      'tasks',
      CASE_ID,
      [{ id: 'local-1' }, { id: 'local-2' }],
      importOne,
    );

    expect(outcome).toEqual({ attempted: 2, succeeded: 2, failedIds: [] });
    expect(importOne).toHaveBeenCalledTimes(2);
  });

  it('does not import the same record twice, even across separate calls (the "runs once" requirement)', async () => {
    const importOne = vi.fn().mockResolvedValue({ id: 'server-1' });

    await uploadUnsyncedRecords('tasks', CASE_ID, [{ id: 'local-1' }], importOne);
    const second = await uploadUnsyncedRecords('tasks', CASE_ID, [{ id: 'local-1' }], importOne);

    expect(importOne).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ attempted: 0, succeeded: 0, failedIds: [] });
  });

  it('remembers the server id an upload became, for later lookups (e.g. completing/archiving)', async () => {
    const importOne = vi.fn().mockResolvedValue({ id: 'server-99' });

    await uploadUnsyncedRecords('tasks', CASE_ID, [{ id: 'local-1' }], importOne);

    expect(getUploadedServerId('tasks', CASE_ID, 'local-1')).toBe('server-99');
  });

  it('surfaces a failed record without losing the rest of the batch — visible, not silently dropped', async () => {
    const importOne = vi
      .fn()
      .mockImplementation((record: { id: string }) =>
        record.id === 'local-bad'
          ? Promise.reject(new Error('network error'))
          : Promise.resolve({ id: `server-${record.id}` }),
      );

    const outcome = await uploadUnsyncedRecords(
      'tasks',
      CASE_ID,
      [{ id: 'local-good' }, { id: 'local-bad' }],
      importOne,
    );

    expect(outcome.succeeded).toBe(1);
    expect(outcome.failedIds).toEqual(['local-bad']);
    // The successful one is not retried on the next pass...
    await uploadUnsyncedRecords('tasks', CASE_ID, [{ id: 'local-good' }], importOne);
    expect(importOne).toHaveBeenCalledTimes(2);
  });

  it('retries a failed record — a failure is retryable, not permanent', async () => {
    const importOne = vi
      .fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ id: 'server-1' });

    const first = await uploadUnsyncedRecords('tasks', CASE_ID, [{ id: 'local-1' }], importOne);
    expect(first.failedIds).toEqual(['local-1']);

    const retry = await uploadUnsyncedRecords('tasks', CASE_ID, [{ id: 'local-1' }], importOne);
    expect(retry).toEqual({ attempted: 1, succeeded: 1, failedIds: [] });
    expect(importOne).toHaveBeenCalledTimes(2);
  });

  it('keeps tracking separate by kind and by case (a task and a document never collide)', async () => {
    const importOne = vi.fn().mockResolvedValue({ id: 'server-shared-id' });

    await uploadUnsyncedRecords('tasks', CASE_ID, [{ id: 'same-id' }], importOne);
    const documentsOutcome = await uploadUnsyncedRecords(
      'documents',
      CASE_ID,
      [{ id: 'same-id' }],
      importOne,
    );
    const otherCaseOutcome = await uploadUnsyncedRecords(
      'tasks',
      'case-other-002',
      [{ id: 'same-id' }],
      importOne,
    );

    expect(documentsOutcome.succeeded).toBe(1);
    expect(otherCaseOutcome.succeeded).toBe(1);
    expect(importOne).toHaveBeenCalledTimes(3);
  });

  it('pre-marking a server-only record as uploaded (rememberUploadedServerId) keeps it from ever being "imported" as new', async () => {
    rememberUploadedServerId('tasks', CASE_ID, 'server-origin-1', 'server-origin-1');
    const importOne = vi.fn().mockResolvedValue({ id: 'should-not-be-called' });

    const outcome = await uploadUnsyncedRecords(
      'tasks',
      CASE_ID,
      [{ id: 'server-origin-1' }],
      importOne,
    );

    expect(importOne).not.toHaveBeenCalled();
    expect(outcome).toEqual({ attempted: 0, succeeded: 0, failedIds: [] });
  });

  it('losing the marker only causes a harmless re-upload, never data loss (documented safety property)', async () => {
    const importOne = vi.fn().mockResolvedValue({ id: 'server-1' });
    await uploadUnsyncedRecords('tasks', CASE_ID, [{ id: 'local-1' }], importOne);

    clearUploadMarkerForTests('tasks', CASE_ID);
    await uploadUnsyncedRecords('tasks', CASE_ID, [{ id: 'local-1' }], importOne);

    // Calling the import endpoint twice for the same legacyLocalId is safe
    // because the server itself is idempotent on it (migration 0046) — this
    // test only documents that the client-side marker being lost degrades to
    // "upload attempted again", never to "record forgotten".
    expect(importOne).toHaveBeenCalledTimes(2);
  });
});
