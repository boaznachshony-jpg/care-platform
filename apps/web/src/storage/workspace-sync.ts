import { ApiRequestError, getWorkspace, saveWorkspace } from '../api/client.js';
import {
  captureMvpWorkspace,
  clearMvpWorkspace,
  MVP_PROFILE_CHANGED,
  replaceMvpWorkspace,
} from './mvp-storage.js';
import { clearLocalDocumentFileCache } from './document-file-store.js';

export type WorkspaceSyncState = 'disabled' | 'loading' | 'saved' | 'saving' | 'error';
export const WORKSPACE_SYNC_CHANGED = 'caredesk:workspace-sync-changed';

let state: WorkspaceSyncState = 'disabled';
let remoteVersion = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let listening = false;

function setState(next: WorkspaceSyncState): void {
  state = next;
  window.dispatchEvent(new CustomEvent(WORKSPACE_SYNC_CHANGED));
}

export function getWorkspaceSyncState(): WorkspaceSyncState {
  return state;
}

async function flush(): Promise<void> {
  setState('saving');
  try {
    const response = await saveWorkspace({
      expectedVersion: remoteVersion,
      snapshot: captureMvpWorkspace(),
    });
    remoteVersion = response.version;
    setState('saved');
  } catch (error) {
    // A stale tab must never overwrite a newer server version. The visible
    // error indicator tells the user to reload instead of pretending it saved.
    if (error instanceof ApiRequestError && error.code === 'VERSION_CONFLICT') {
      setState('error');
      return;
    }
    setState('error');
  }
}

function scheduleFlush(): void {
  if (!listening) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), 250);
}

export async function startWorkspaceSync(): Promise<void> {
  stopWorkspaceSync();
  setState('loading');
  // Clear first: data cached by a previous account must never appear while a
  // new account is being hydrated.
  clearMvpWorkspace();
  await clearLocalDocumentFileCache();
  const response = await getWorkspace();
  remoteVersion = response.version;
  replaceMvpWorkspace(response.snapshot);
  listening = true;
  window.addEventListener(MVP_PROFILE_CHANGED, scheduleFlush);
  setState('saved');
}

export function stopWorkspaceSync(): void {
  listening = false;
  window.removeEventListener(MVP_PROFILE_CHANGED, scheduleFlush);
  if (timer) clearTimeout(timer);
  timer = undefined;
  remoteVersion = 0;
  clearMvpWorkspace();
  void clearLocalDocumentFileCache();
  setState('disabled');
}
