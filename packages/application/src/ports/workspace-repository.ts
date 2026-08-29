/**
 * Thrown when a save would wipe out most of a workspace that currently holds
 * real data.
 *
 * The browser is not trustworthy on this question. Its device cache is
 * encrypted with a key that lives in sessionStorage, so a key that survives in
 * localStorage but can no longer be decrypted reads as "empty" rather than as
 * "unreadable" - which is exactly how a failed read turns into a deletion. The
 * server is the only place that can see both what is stored and what is being
 * proposed, so the last-resort check belongs here.
 *
 * A customer who really is clearing their account sends `allowShrink`, which
 * the UI sets only on an explicit, confirmed deletion.
 */
export class WorkspaceShrinkRejectedError extends Error {
  readonly code = 'WORKSPACE_SHRINK_REJECTED';
  constructor(
    readonly currentEntries: number,
    readonly incomingEntries: number,
  ) {
    super(
      `Refusing to reduce workspace from ${currentEntries} to ${incomingEntries} populated entries without an explicit confirmation.`,
    );
  }
}

/**
 * Counts entries that actually carry data. Empty strings are not evidence of
 * content: `captureMvpWorkspace` used to emit one for every key it failed to
 * decrypt, which is the failure mode this guard exists to catch.
 */
export function populatedEntryCount(payload: Record<string, string>): number {
  return Object.values(payload).filter((value) => value.trim() !== '').length;
}

/**
 * The rule, deliberately narrow so that ordinary editing never trips it:
 * a save is refused only when the stored workspace holds at least three
 * populated entries and the incoming one keeps fewer than a third of them.
 * Deleting one case out of several stays well inside the threshold; losing an
 * entire account's contents does not.
 */
export function isDestructiveShrink(
  current: Record<string, string>,
  incoming: Record<string, string>,
): boolean {
  const before = populatedEntryCount(current);
  if (before < 3) return false;
  return populatedEntryCount(incoming) * 3 < before;
}

export interface WorkspaceRecord {
  tenantId: string;
  schemaVersion: number;
  payload: Record<string, string>;
  version: number;
  updatedAt: string;
}

export interface SaveWorkspaceRecord {
  tenantId: string;
  schemaVersion: number;
  payload: Record<string, string>;
  expectedVersion: number;
  updatedBy: string;
  updatedAt: string;
  /** Set only by an explicit, confirmed deletion in the UI. */
  allowShrink?: boolean;
}

export interface WorkspaceRepository {
  find(tenantId: string): Promise<WorkspaceRecord | null>;
  /** Returns null when optimistic concurrency detects a stale version. */
  save(input: SaveWorkspaceRecord): Promise<WorkspaceRecord | null>;
}
