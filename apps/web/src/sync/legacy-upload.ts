/**
 * Background, idempotent upload of browser-only records (tasks, documents,
 * medications) to their canonical server tables, via the `/import` endpoints
 * added in migration 0046 (see database/migrations/0046 and
 * ImportCaseTask/ImportCaseDocument/ImportMedication in @caredesk/application).
 *
 * DATA SAFETY: nothing here ever deletes, mutates or "replaces" the local
 * copy in apps/web/src/storage/mvp-storage.ts. Import is a strictly additive
 * side effect that copies a record the browser already holds to the server;
 * the local record stays exactly as the user left it, forever, until a human
 * explicitly removes it in some later, separate change.
 */

export type LegacyUploadKind = 'tasks' | 'documents' | 'medications';

/**
 * "Already uploaded" bookkeeping: which local record ids this browser has
 * already sent, and which server id each became.
 *
 * This lives in plain (unencrypted) localStorage, deliberately separate from
 * the encrypted `caredesk.mvp.*` business keys in mvp-storage.ts, because it
 * is not customer data — it is a cache of ids the client already generated
 * itself (the same opaque ids already visible in the DOM and in outgoing
 * requests). If this key is lost (private browsing, a cleared cache, a
 * second device that never had it), the *worst* case is that a record gets
 * imported a second time — and the import endpoint is idempotent on
 * `legacyLocalId` (migration 0046's partial unique index is the enforcement,
 * not just the use case), so a repeat import returns the existing server row
 * rather than creating a duplicate. That idempotency is exactly what makes
 * this marker safe to treat as disposable rather than as its own thing that
 * would need the same durability guarantees as the data it tracks.
 */
function markerStorageKey(kind: LegacyUploadKind, caseId: string): string {
  return `caredesk.sync.uploaded.${kind}.${caseId}`;
}

type UploadMap = Record<string, string>;

function readUploadMap(kind: LegacyUploadKind, caseId: string): UploadMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(markerStorageKey(kind, caseId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
}

function writeUploadMap(kind: LegacyUploadKind, caseId: string, map: UploadMap): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(markerStorageKey(kind, caseId), JSON.stringify(map));
}

/** The server id a local record became, if this browser has ever uploaded it. */
export function getUploadedServerId(
  kind: LegacyUploadKind,
  caseId: string,
  localId: string,
): string | undefined {
  return readUploadMap(kind, caseId)[localId];
}

/**
 * Records that `localId` now has a canonical server row at `serverId`. Used
 * both after a successful import and, for records whose canonical origin is
 * the server itself (created on another device — see the `*Page` merge
 * logic), to pre-mark them as "already uploaded" so this browser never tries
 * to import a record it merely learned about by reading it.
 */
export function rememberUploadedServerId(
  kind: LegacyUploadKind,
  caseId: string,
  localId: string,
  serverId: string,
): void {
  const map = readUploadMap(kind, caseId);
  map[localId] = serverId;
  writeUploadMap(kind, caseId, map);
}

export interface UploadOutcome {
  attempted: number;
  succeeded: number;
  failedIds: string[];
}

/**
 * The banner state each of the three screens shows for the sync attempt.
 * `'offline'` and `'upload-failed'` are deliberately different messages: the
 * first means the whole attempt could not reach the server (the screen is
 * showing this device's local copy, full stop); the second means the server
 * was reachable and some records made it but at least one did not (the
 * screen is showing a mix, and the failed ones are individually retryable).
 */
export type SyncStatus =
  | { phase: 'no-case' }
  | { phase: 'checking' }
  | { phase: 'offline' }
  | { phase: 'synced' }
  | { phase: 'upload-failed'; failedCount: number };

/**
 * Uploads every record in `records` this browser has not already marked as
 * uploaded for this case. Never throws — a per-record failure (network,
 * validation, server error) is collected in `failedIds` so the rest of the
 * batch is still attempted and the caller can show a retryable failure
 * instead of losing the whole upload over one bad or offline record.
 *
 * Safe to call repeatedly: already-uploaded ids are skipped up front, and
 * the import endpoint itself is idempotent on `legacyLocalId`, so even a
 * record this function tries twice (e.g. the marker above was lost) cannot
 * become a duplicate on the server.
 */
export async function uploadUnsyncedRecords<T extends { id: string }>(
  kind: LegacyUploadKind,
  caseId: string,
  records: T[],
  importOne: (record: T) => Promise<{ id: string }>,
): Promise<UploadOutcome> {
  const uploaded = readUploadMap(kind, caseId);
  const pending = records.filter((record) => !(record.id in uploaded));
  const failedIds: string[] = [];
  let succeeded = 0;
  for (const record of pending) {
    try {
      const result = await importOne(record);
      rememberUploadedServerId(kind, caseId, record.id, result.id);
      succeeded += 1;
    } catch {
      failedIds.push(record.id);
    }
  }
  return { attempted: pending.length, succeeded, failedIds };
}

/** Test-only escape hatch; production code never deletes this marker. */
export function clearUploadMarkerForTests(kind: LegacyUploadKind, caseId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(markerStorageKey(kind, caseId));
}
