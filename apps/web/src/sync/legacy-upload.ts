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
/**
 * A one-time bump for `'documents'` only. This round adds file-bytes lookup
 * (IndexedDB / server workspace storage — see document-file-store.ts and
 * document-mapping.ts's `resolveDocumentImportFile`) on top of what an
 * earlier round already covered (metadata + inline `dataUrl` only). A browser
 * that already ran that earlier round has every document marked "uploaded"
 * under the un-suffixed key, and would otherwise never call `importOne`
 * again for them — so the file would never get a chance to attach, even
 * though this code can now find it.
 *
 * Changing the storage key forces exactly one extra import attempt per
 * previously-synced document, scoped to this kind alone (tasks and
 * medications are untouched and keep their original key). That attempt is
 * safe under the same idempotency the marker's own doc comment already
 * relies on: the import endpoint is keyed on `legacyLocalId`, so it cannot
 * create a duplicate — it can only, in the best case, attach a file that was
 * missing before.
 *
 * NOTE: as of this change attaching a file to a document that already exists
 * on the server *without* one is still a no-op server-side (see the PR
 * description / final report: `ImportCaseDocument.execute` returns the
 * existing row unchanged before ever looking at `input.file`). This epoch
 * bump is what makes the retry happen; a companion server-side fix is what
 * makes the retry actually attach the file. Once that ships, every browser
 * that visits this screen again self-heals with no further client change.
 */
const DOCUMENTS_MARKER_EPOCH = 'v2';

function markerStorageKey(kind: LegacyUploadKind, caseId: string): string {
  const epoch = kind === 'documents' ? `.${DOCUMENTS_MARKER_EPOCH}` : '';
  return `caredesk.sync.uploaded.${kind}${epoch}.${caseId}`;
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
 *
 * `'uploading'` exists because documents can now carry several-MB file
 * bodies (base64-inflated to ~4/3 their size) over what may be a slow mobile
 * link — a single record's `importOne` can take a meaningful number of
 * seconds, and `uploadUnsyncedRecords` sends them one at a time (see its own
 * comment for why). A multi-record batch can therefore run for minutes, and
 * silently leaving the screen on `'checking'` throughout — indistinguishable
 * from "nothing is happening" — is exactly the kind of silent freeze the
 * task that added this phase called out as unacceptable. Reusing the
 * existing banner (rather than a spinner or toast elsewhere) keeps the one
 * "here is what this screen knows about syncing" mechanism instead of adding
 * a second, competing one.
 *
 * `'update-failed'` is distinct from `'upload-failed'`: an upload failure
 * means a *new* record never reached the server at all; an update failure
 * means a record the server already knows about (this browser's own earlier
 * import, or one merged in from elsewhere) has since been edited locally and
 * that edit could not be pushed. Both are "some records are not what the
 * server has" states and both are retryable through the same button, but
 * they are worth telling apart in the message so a family reading the banner
 * knows roughly what is stuck.
 *
 * `'ambiguous'` covers the one case this sync layer refuses to guess at: see
 * `useCaseForLegacyClient`'s handling of `LEGACY_UNSCOPED_CLIENT_ID` for why
 * an account with more than one client cannot be synced from an unscoped
 * route at all, rather than picking a case and possibly writing one
 * household's edit into another's record.
 */
export type SyncStatus =
  | { phase: 'no-case' }
  | { phase: 'checking' }
  | { phase: 'offline' }
  | { phase: 'synced' }
  | { phase: 'uploading'; completed: number; total: number }
  | { phase: 'upload-failed'; failedCount: number }
  | { phase: 'update-failed'; failedCount: number }
  | { phase: 'ambiguous' };

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
 *
 * Records are sent one at a time, deliberately not `Promise.all`'d. Tasks
 * and medications are small JSON bodies where this barely matters, but a
 * document's `importOne` can carry several MB of base64 file content — with
 * no cap, a batch of a dozen large documents queued concurrently could try
 * to push tens of MB at once over a connection this product explicitly has
 * to support on a phone in the field. One at a time bounds memory and
 * bandwidth use to a single record regardless of batch size, at the cost of
 * total wall-clock time, which is exactly why `onProgress` exists below —
 * the caller can show "3 of 11" instead of a silent multi-minute wait.
 *
 * `onProgress`, when given, is called after every attempt (success or
 * failure) with the number of records attempted so far and the batch total,
 * so a caller can drive a `SyncStatus.uploading` banner. Optional and
 * additive so existing callers (tasks, medications) are unaffected.
 */
export async function uploadUnsyncedRecords<T extends { id: string }>(
  kind: LegacyUploadKind,
  caseId: string,
  records: T[],
  importOne: (record: T) => Promise<{ id: string }>,
  onProgress?: (completed: number, total: number) => void,
): Promise<UploadOutcome> {
  const uploaded = readUploadMap(kind, caseId);
  const pending = records.filter((record) => !(record.id in uploaded));
  const failedIds: string[] = [];
  let succeeded = 0;
  let completed = 0;
  for (const record of pending) {
    try {
      const result = await importOne(record);
      rememberUploadedServerId(kind, caseId, record.id, result.id);
      succeeded += 1;
    } catch {
      failedIds.push(record.id);
    } finally {
      completed += 1;
      onProgress?.(completed, pending.length);
    }
  }
  return { attempted: pending.length, succeeded, failedIds };
}

/** Test-only escape hatch; production code never deletes this marker. */
export function clearUploadMarkerForTests(kind: LegacyUploadKind, caseId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(markerStorageKey(kind, caseId));
}

/**
 * Defect 5 fix: a one-shot server action (complete a task, archive a task or
 * medication) used to be fired with `.catch(() => undefined)` at the moment
 * of the click and never tried again. Made offline, or against a server that
 * happened to be briefly unreachable, that action then simply never
 * happened — the local record kept its new status forever, but the server
 * (and every other device reading it) never found out, so the two disagreed
 * for good.
 *
 * The fix is to never let the action's own success or failure be the only
 * record of whether it is still owed. The moment the user acts (the local
 * status already changed — Constitution §13, local input is never rolled
 * back), the intended action is written here durably, *before* the network
 * call is attempted. It is cleared only on a confirmed server success. Every
 * later pass through the same sync path this module already drives for
 * uploads (mount, the existing retry button, a future automatic retry) can
 * therefore ask "is anything still owed for this record?" and re-attempt it,
 * exactly like `uploadUnsyncedRecords` re-attempts an import that previously
 * failed — the same idempotent-retry shape, extended to actions instead of
 * creates. The server-side endpoints this drives (`complete`/`archive`) are
 * themselves idempotent status transitions, so replaying one that actually
 * did land the first time is harmless.
 */
export type PendingLegacyAction = 'complete' | 'archive';

type PendingActionsMap = Record<string, PendingLegacyAction>;

function pendingActionsStorageKey(kind: LegacyUploadKind, caseId: string): string {
  return `caredesk.sync.pendingActions.${kind}.${caseId}`;
}

export function readPendingActions(kind: LegacyUploadKind, caseId: string): PendingActionsMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(pendingActionsStorageKey(kind, caseId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, PendingLegacyAction] =>
          entry[1] === 'complete' || entry[1] === 'archive',
      ),
    );
  } catch {
    return {};
  }
}

function writePendingActions(kind: LegacyUploadKind, caseId: string, map: PendingActionsMap): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(pendingActionsStorageKey(kind, caseId), JSON.stringify(map));
}

/** Records that `localId` still owes the server this action, until it is confirmed done. */
export function markPendingAction(
  kind: LegacyUploadKind,
  caseId: string,
  localId: string,
  action: PendingLegacyAction,
): void {
  const map = readPendingActions(kind, caseId);
  map[localId] = action;
  writePendingActions(kind, caseId, map);
}

/** Clears the marker once the server has confirmed the action landed. */
export function clearPendingAction(kind: LegacyUploadKind, caseId: string, localId: string): void {
  const map = readPendingActions(kind, caseId);
  if (!(localId in map)) return;
  delete map[localId];
  writePendingActions(kind, caseId, map);
}

/**
 * Replays every action this browser still owes the server for `kind`,
 * skipping any local id this browser has not (yet) uploaded — nothing to
 * archive/complete server-side until the record itself exists there; the
 * marker stays put and is retried on the next pass once the upload lands.
 * Never throws: a per-record failure is collected in `failedIds`, mirroring
 * `uploadUnsyncedRecords`, so one stuck action does not block the others or
 * crash the calling sync effect.
 */
export async function replayPendingActions(
  kind: LegacyUploadKind,
  caseId: string,
  perform: (action: PendingLegacyAction, serverId: string) => Promise<unknown>,
): Promise<{ failedIds: string[] }> {
  const pending = readPendingActions(kind, caseId);
  const failedIds: string[] = [];
  for (const [localId, action] of Object.entries(pending)) {
    const serverId = getUploadedServerId(kind, caseId, localId);
    if (!serverId) continue;
    try {
      await perform(action, serverId);
      clearPendingAction(kind, caseId, localId);
    } catch {
      failedIds.push(localId);
    }
  }
  return { failedIds };
}
